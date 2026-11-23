//! Thumbnails and camera RAW files read in Rust, for Windows and Linux,
//! which have no sips. The Mac app does not use any of this: lib.rs keeps
//! sips there, and only the thumbnail test builds this file on a Mac.

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageReader};
use std::io::Cursor;
use std::path::Path;

/// Files read as they are. Anything else the filmstrip shows is camera RAW.
pub fn is_plain_image(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    ["jpg", "jpeg", "png", "tif", "tiff", "webp", "bmp", "gif"].contains(&ext.as_str())
}

/// `img` at most `size` pixels on its long side. Never made larger.
pub fn shrink(img: DynamicImage, size: u32) -> DynamicImage {
    if img.width().max(img.height()) > size {
        img.thumbnail(size, size)
    } else {
        img
    }
}

/// `img` as an 8-bit JPEG, carrying a colour profile and EXIF (TIFF bytes)
/// when given.
pub fn encode_jpeg(img: &DynamicImage, quality: u8, icc: Option<Vec<u8>>, exif: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, quality);
    if let Some(icc) = icc {
        let _ = encoder.set_icc_profile(icc);
    }
    if let Some(exif) = exif {
        let _ = encoder.set_exif_metadata(exif);
    }
    encoder
        .write_image(rgb.as_raw(), rgb.width(), rgb.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

/// A JPEG, PNG, TIFF, WebP, BMP or GIF photo, upright, `size` pixels on its long
/// side, as a JPEG. Its colour profile goes with it, so it shows in the
/// photo's own colours.
pub fn plain_thumbnail(path: &Path, size: u32) -> Result<Vec<u8>, String> {
    if let Some((img, icc, orientation)) = small_jpeg(path, size) {
        let icc = if img.color().has_color() { icc } else { None };
        let mut small = shrink(img, size);
        small.apply_orientation(orientation);
        return encode_jpeg(&small, 80, icc, None);
    }
    let mut decoder = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let icc = decoder.icc_profile().ok().flatten();
    let img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    // A grey photo's profile is for one channel; the JPEG has three.
    let icc = if img.color().has_color() { icc } else { None };
    let mut small = shrink(img, size);
    small.apply_orientation(orientation);
    encode_jpeg(&small, 80, icc, None)
}

/// A JPEG read at a half, a quarter or an eighth of its size, the smallest
/// still at least `size` on its long side: the JPEG's own blocks give those
/// nearly for free, where reading it whole and shrinking it took 150-300 ms
/// for a 24-megapixel photo (every thumbnail of a folder, the first time).
/// None for anything else, or a JPEG this can't read (CMYK, 16-bit), which is
/// then read whole.
fn small_jpeg(path: &Path, size: u32) -> Option<(DynamicImage, Option<Vec<u8>>, Orientation)> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext != "jpg" && ext != "jpeg" {
        return None;
    }
    let file = std::fs::File::open(path).ok()?;
    let mut decoder = jpeg_decoder::Decoder::new(std::io::BufReader::new(file));
    decoder.read_info().ok()?;
    let info = decoder.info()?;
    let long = u32::from(info.width.max(info.height));
    // Little to gain under twice the size asked for.
    if long < size * 2 {
        return None;
    }
    let k = size as f64 / long as f64;
    let want_w = ((f64::from(info.width) * k).ceil() as u16).max(1);
    let want_h = ((f64::from(info.height) * k).ceil() as u16).max(1);
    let (w, h) = decoder.scale(want_w, want_h).ok()?;
    let pixels = decoder.decode().ok()?;
    let img = match decoder.info()?.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => DynamicImage::ImageRgb8(image::RgbImage::from_raw(u32::from(w), u32::from(h), pixels)?),
        jpeg_decoder::PixelFormat::L8 => DynamicImage::ImageLuma8(image::GrayImage::from_raw(u32::from(w), u32::from(h), pixels)?),
        _ => return None,
    };
    let orientation = decoder.exif_data().and_then(Orientation::from_exif_chunk).unwrap_or(Orientation::NoTransforms);
    Some((img, decoder.icc_profile(), orientation))
}

/// A photo the webview can't decode (a TIFF, in WebView2 and WebKitGTK),
/// read here and given back as a PNG it can: the first page or frame,
/// upright, 8 bits a channel (16-bit TIFFs too), its colour profile carried
/// for the webview to apply, unless `keep_values` (grain plates, whose values
/// are used as they are). Quick to write rather than small: it never leaves
/// the computer.
pub fn convert_image(bytes: &[u8], keep_values: bool) -> Result<Vec<u8>, String> {
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let icc = if keep_values { None } else { decoder.icc_profile().ok().flatten() };
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    let color = img.color();
    // A grey photo's profile is for one channel: kept on a grey PNG only.
    let (data, width, height, kind) = if color.has_alpha() {
        let px = img.to_rgba8();
        let (w, h) = px.dimensions();
        (px.into_raw(), w, h, image::ExtendedColorType::Rgba8)
    } else if color.has_color() {
        let px = img.to_rgb8();
        let (w, h) = px.dimensions();
        (px.into_raw(), w, h, image::ExtendedColorType::Rgb8)
    } else {
        let px = img.to_luma8();
        let (w, h) = px.dimensions();
        (px.into_raw(), w, h, image::ExtendedColorType::L8)
    };
    let mut out = Vec::new();
    let mut encoder = PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::Adaptive);
    if let Some(icc) = icc {
        let _ = encoder.set_icc_profile(icc);
    }
    encoder.write_image(&data, width, height, kind).map_err(|e| e.to_string())?;
    Ok(out)
}

/// The largest preview JPEG inside a camera RAW file, found by its markers:
/// for files whose preview rawler does not read (ORF keeps it in the maker
/// notes). Only ordinary JPEGs count, not the lossless ones some cameras
/// store the sensor data in, nor any under 160 pixels.
pub fn largest_embedded_jpeg(bytes: &[u8]) -> Option<DynamicImage> {
    let mut best: Option<(usize, u64)> = None;
    let mut at = 0;
    while let Some(found) = bytes[at..].windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) {
        let start = at + found;
        at = start + 3;
        if let Some((w, h)) = jpeg_size(&bytes[start..]) {
            let area = w as u64 * h as u64;
            if w.min(h) >= 160 && best.is_none_or(|(_, a)| area > a) {
                best = Some((start, area));
            }
        }
    }
    let (start, _) = best?;
    image::load_from_memory_with_format(&bytes[start..], image::ImageFormat::Jpeg).ok()
}

/// A baseline or progressive JPEG's size, from its frame header.
fn jpeg_size(jpeg: &[u8]) -> Option<(u32, u32)> {
    let be16 = |at: usize| jpeg.get(at..at + 2).map(|b| u16::from_be_bytes([b[0], b[1]]) as usize);
    let mut at = 2;
    for _ in 0..64 {
        if *jpeg.get(at)? != 0xFF {
            return None;
        }
        match *jpeg.get(at + 1)? {
            0xC0..=0xC2 => return Some((be16(at + 7)? as u32, be16(at + 5)? as u32)),
            // Other frame types (lossless, arithmetic), or the data begins.
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF | 0xDA => return None,
            0xFF => at += 1,
            _ => at += 2 + be16(at + 2)?,
        }
    }
    None
}

/// Linear light made brighter so that only the brightest 1% of the photo is
/// white (as dcraw does), then put in sRGB tone. A RAW's data is darker than
/// the photo the camera showed; this brings it to about there.
pub fn tone_linear(pixels: &mut [[f32; 3]]) {
    let step = (pixels.len() / 400_000).max(1);
    let mut sample: Vec<f32> = pixels.iter().step_by(step).map(|p| p[0].max(p[1]).max(p[2])).collect();
    if sample.is_empty() {
        return;
    }
    let at = sample.len() * 99 / 100;
    let (_, white, _) = sample.select_nth_unstable_by(at, f32::total_cmp);
    let gain = if *white > 0.0 { (1.0 / *white).clamp(1.0, 8.0) } else { 1.0 };
    let srgb = |v: f32| {
        let v = (v * gain).clamp(0.0, 1.0);
        if v <= 0.003_130_8 {
            v * 12.92
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        }
    };
    for p in pixels.iter_mut() {
        *p = [srgb(p[0]), srgb(p[1]), srgb(p[2])];
    }
}

#[cfg(not(target_os = "macos"))]
pub use raw::{develop_raw, raw_thumbnail};

#[cfg(not(target_os = "macos"))]
mod raw {
    use super::{encode_jpeg, largest_embedded_jpeg, shrink, tone_linear};
    use image::metadata::Orientation;
    use image::{DynamicImage, ImageBuffer};
    use rawler::decoders::{RawDecodeParams, RawMetadata};
    use rawler::formats::tiff::{DirectoryWriter, TiffWriter};
    use rawler::imgop::develop::{Intermediate, ProcessingStep, RawDevelop};
    use rawler::rawsource::RawSource;
    use rawler::tags::{ExifTag, TiffCommonTag};
    use std::path::Path;

    fn orientation(code: Option<u16>) -> Orientation {
        code.and_then(|c| u8::try_from(c).ok()).and_then(Orientation::from_exif).unwrap_or(Orientation::NoTransforms)
    }

    /// Some of rawler's paths panic on files they do not expect. That is an
    /// error for this file, not the app going down.
    fn guarded<T>(work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).unwrap_or_else(|_| Err("could not read this RAW file".into()))
    }

    /// The preview JPEG the camera put in a RAW file, upright and small:
    /// rawler's, or else the largest JPEG in the file. An error when there is
    /// none.
    pub fn raw_thumbnail(path: &Path, size: u32) -> Result<Vec<u8>, String> {
        guarded(|| {
            let source = RawSource::new(path).map_err(|e| e.to_string())?;
            let params = RawDecodeParams::default();
            let decoder = rawler::get_decoder(&source).ok();
            let preview = decoder
                .as_ref()
                .and_then(|d| d.preview_image(&source, &params).ok().flatten())
                .or_else(|| largest_embedded_jpeg(source.buf()))
                .or_else(|| decoder.as_ref().and_then(|d| d.thumbnail_image(&source, &params).ok().flatten()))
                .ok_or("this RAW file has no preview that can be read")?;
            let turn = decoder.as_ref().and_then(|d| d.raw_metadata(&source, &params).ok()).and_then(|m| m.exif.orientation);
            let mut small = shrink(preview, size);
            small.apply_orientation(orientation(turn));
            encode_jpeg(&small, 80, None, None)
        })
    }

    /// A camera RAW file developed as the camera set it: white balance as
    /// shot, the camera's colour matrix, brightened so the brightest 1% is
    /// white, sRGB tone; no other adjustment. Back as a full-quality sRGB
    /// JPEG, turned upright, with the RAW's EXIF (date, exposure, lens, GPS)
    /// where rawler reads it.
    pub fn develop_raw(bytes: &[u8]) -> Result<Vec<u8>, String> {
        guarded(|| {
            let source = RawSource::new_from_slice(bytes);
            let decoder = rawler::get_decoder(&source).map_err(|e| format!("this RAW file is not supported: {e}"))?;
            let params = RawDecodeParams::default();
            let raw = decoder.raw_image(&source, &params, false).map_err(|e| e.to_string())?;
            let meta = decoder.raw_metadata(&source, &params).ok();
            // Every step but the last, sRGB tone: tone_linear does that.
            let linear = RawDevelop::new_with(&[
                ProcessingStep::Rescale,
                ProcessingStep::Demosaic,
                ProcessingStep::FujiRotate,
                ProcessingStep::CropActiveArea,
                ProcessingStep::WhiteBalance,
                ProcessingStep::Calibrate,
                ProcessingStep::CropDefault,
            ])
            .develop_intermediate(&raw)
            .map_err(|e| e.to_string())?;
            let to_byte = |v: f32| (v * 255.0 + 0.5) as u8;
            let mut img = match linear {
                Intermediate::ThreeColor(mut rgb) => {
                    tone_linear(&mut rgb.data);
                    let bytes = rgb.data.iter().flat_map(|p| p.map(to_byte)).collect();
                    let buf = ImageBuffer::from_raw(rgb.width as u32, rgb.height as u32, bytes);
                    DynamicImage::ImageRgb8(buf.ok_or("could not develop this RAW file")?)
                }
                Intermediate::Monochrome(grey) => {
                    let mut rgb: Vec<[f32; 3]> = grey.data.iter().map(|&v| [v, v, v]).collect();
                    tone_linear(&mut rgb);
                    let bytes = rgb.iter().map(|p| to_byte(p[0])).collect();
                    let buf = ImageBuffer::from_raw(grey.width as u32, grey.height as u32, bytes);
                    DynamicImage::ImageLuma8(buf.ok_or("could not develop this RAW file")?)
                }
                Intermediate::FourColor(_) => return Err("this RAW file's colours cannot be read".into()),
            };
            // The EXIF's orientation where rawler read one, else the
            // decoder's (which is upright for ORF, wrongly).
            let turn = meta.as_ref().and_then(|m| m.exif.orientation).unwrap_or(raw.orientation.to_u16());
            img.apply_orientation(orientation(Some(turn)));
            let exif = meta.as_ref().and_then(exif_of);
            encode_jpeg(&img, 100, None, exif)
        })
    }

    /// The RAW's EXIF as TIFF bytes for the JPEG, upright (the pixels are
    /// turned already). None if it cannot be written or is too big for a
    /// JPEG segment.
    fn exif_of(meta: &RawMetadata) -> Option<Vec<u8>> {
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut tiff = TiffWriter::new(&mut buf).ok()?;
        let mut root = DirectoryWriter::new();
        let mut exif = DirectoryWriter::new();
        exif.add_tag_undefined(ExifTag::ExifVersion, vec![48, 50, 50, 48]);
        meta.write_exif_tags(&mut tiff, &mut root, &mut exif).ok()?;
        root.add_tag(TiffCommonTag::Make, meta.make.as_str());
        root.add_tag(TiffCommonTag::Model, meta.model.as_str());
        root.add_tag(TiffCommonTag::Orientation, 1_u16);
        let exif_offset = exif.build(&mut tiff).ok()?;
        root.add_tag(TiffCommonTag::ExifIFDPointer, exif_offset);
        tiff.build(root).ok()?;
        let bytes = buf.into_inner();
        (bytes.len() < 60_000).then_some(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    #[test]
    fn thumbnail_is_a_small_upright_jpeg() {
        let dir = std::env::temp_dir().join(format!("grain-thumb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // 400 x 200, red on the left half, blue on the right.
        let img = RgbImage::from_fn(400, 200, |x, _| if x < 200 { Rgb([255, 0, 0]) } else { Rgb([0, 0, 255]) });
        let png = dir.join("wide.png");
        img.save(&png).unwrap();

        let jpeg = plain_thumbnail(&png, 100).unwrap();
        let small = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        assert_eq!((small.width(), small.height()), (100, 50));
        assert!(small.get_pixel(10, 25)[0] > 200 && small.get_pixel(90, 25)[2] > 200);

        // Never enlarged.
        let same = image::load_from_memory(&plain_thumbnail(&png, 1000).unwrap()).unwrap();
        assert_eq!((same.width(), same.height()), (400, 200));

        // A JPEG whose EXIF says to turn it a quarter clockwise comes out turned.
        let exif: Vec<u8> = [
            &b"II*\0"[..],
            &8u32.to_le_bytes(),
            &1u16.to_le_bytes(),
            &[0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0],
            &0u32.to_le_bytes(),
        ]
        .concat();
        let turned = dir.join("turned.jpg");
        std::fs::write(&turned, encode_jpeg(&DynamicImage::ImageRgb8(img), 90, None, Some(exif)).unwrap()).unwrap();
        let upright = image::load_from_memory(&plain_thumbnail(&turned, 100).unwrap()).unwrap().to_rgb8();
        assert_eq!((upright.width(), upright.height()), (50, 100));
        assert!(upright.get_pixel(25, 10)[0] > 200 && upright.get_pixel(25, 90)[2] > 200);

        assert!(plain_thumbnail(&dir.join("missing.jpg"), 100).is_err());
        assert!(is_plain_image(Path::new("a/B.JPG")) && !is_plain_image(Path::new("a/b.orf")));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn converts_a_16_bit_tiff_to_an_upright_png() {
        use image::codecs::tiff::TiffEncoder;
        use image::{ImageBuffer, Rgb as Px};
        // 300 x 100, 16 bits a channel: red on the left third, blue elsewhere.
        let img: ImageBuffer<Px<u16>, Vec<u16>> =
            ImageBuffer::from_fn(300, 100, |x, _| if x < 100 { Px([65535, 0, 0]) } else { Px([0, 0, 65535]) });
        let mut tiff = Vec::new();
        TiffEncoder::new(Cursor::new(&mut tiff))
            .write_image(bytemuck_u16(img.as_raw()), 300, 100, image::ExtendedColorType::Rgb16)
            .unwrap();
        let png = convert_image(&tiff, false).unwrap();
        assert_eq!(image::guess_format(&png).unwrap(), image::ImageFormat::Png);
        let back = image::load_from_memory(&png).unwrap().to_rgb8();
        assert_eq!((back.width(), back.height()), (300, 100));
        assert_eq!(back.get_pixel(10, 50).0, [255, 0, 0]);
        assert_eq!(back.get_pixel(200, 50).0, [0, 0, 255]);
        assert!(convert_image(b"not a picture", false).is_err());
    }

    fn bytemuck_u16(v: &[u16]) -> &[u8] {
        // Native order, as the encoder expects.
        unsafe { std::slice::from_raw_parts(v.as_ptr() as *const u8, v.len() * 2) }
    }

    #[test]
    fn finds_the_largest_preview_in_a_raw_file() {
        let jpeg = |w, h| encode_jpeg(&DynamicImage::ImageRgb8(RgbImage::new(w, h)), 80, None, None).unwrap();
        let mut file = b"II*\0 sensor data \xFF\xD8\xFF\x00 not a picture".to_vec();
        file.extend(jpeg(120, 90)); // too small to count
        file.extend([0x55; 64]);
        file.extend(jpeg(640, 480));
        file.extend([0xAA; 64]);
        file.extend(jpeg(320, 240));
        let found = largest_embedded_jpeg(&file).unwrap();
        assert_eq!((found.width(), found.height()), (640, 480));
        assert!(largest_embedded_jpeg(b"no pictures here").is_none());
    }

    #[test]
    fn tone_brightens_until_the_top_percent_is_white() {
        // 99% of the photo at a quarter, the brightest 1% at a half: twice as bright.
        let mut pixels = vec![[0.25_f32; 3]; 990];
        pixels.extend(vec![[0.5_f32, 0.4, 0.3]; 10]);
        tone_linear(&mut pixels);
        let srgb_half = 1.055 * 0.5_f32.powf(1.0 / 2.4) - 0.055;
        assert!((pixels[0][0] - srgb_half).abs() < 1e-4);
        assert!((pixels[999][0] - 1.0).abs() < 1e-4);
        // Never darker than as shot.
        let mut bright = vec![[0.9_f32; 3]; 99];
        bright.push([2.0; 3]);
        tone_linear(&mut bright);
        let srgb_09 = 1.055 * 0.9_f32.powf(1.0 / 2.4) - 0.055;
        assert!((bright[0][0] - srgb_09).abs() < 1e-4);
    }
}
