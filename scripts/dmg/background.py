"""
The Mac installer window's background (src-tauri/dmg/background.tiff, 1x and 2x).

The copyshop icon sits on the left and Applications on the right. Between them,
the icon's gold bands are streaked toward Applications, the way the app's
Streaks effect stretches a photo's edge: that is the "drag it here" arrow.
The positions here must match bundle.macOS.dmg in src-tauri/tauri.macos.conf.json.

Run: python3 scripts/dmg/background.py   (needs Pillow and numpy)
"""
import subprocess, tempfile, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W, H = 660, 400                 # the window's content size
APP, APPS = (170, 180), (490, 180)  # icon centres
ICON = 128                      # icon size in the window
PAPER = np.array([244, 239, 230], np.float32)
INK = (138, 128, 115)


def icon_column(scale):
    """The icon's bands, one row per pixel: its colour a little left of the light bar."""
    tmp = tempfile.mkdtemp()
    subprocess.run(['iconutil', '-c', 'iconset', os.path.join(ROOT, 'src-tauri/icons/icon.icns'), '-o', f'{tmp}/i.iconset'], check=True)
    im = Image.open(f'{tmp}/i.iconset/icon_512x512@2x.png').convert('RGB')
    n = round(ICON * scale)
    im = im.resize((n, n), Image.LANCZOS)
    a = np.asarray(im, np.float32)
    # Average a few columns inside the bands so the icon's grain doesn't stripe the streaks.
    x0, x1 = round(n * 0.58), round(n * 0.64)
    return a[:, x0:x1].mean(axis=1)


def render(scale):
    w, h = round(W * scale), round(H * scale)
    img = np.ones((h, w, 3), np.float32) * PAPER
    col = icon_column(scale)
    n = len(col)
    top = round((APP[1] - ICON / 2) * scale)
    # The icon's visible square is ~80% of its 128 px (the rest is the icon's own margin).
    start = (APP[0] + ICON * 0.36) * scale
    end = (APPS[0] - ICON * 0.48) * scale
    x = np.arange(w, dtype=np.float32)
    t = np.clip((x - start) / (end - start), 0, 1)
    fade = ((1 - t) ** 1.35) * (x >= APP[0] * scale)
    lum = col.mean(axis=1) / 255
    # Only the lit bands streak: the icon's dark ground and lines would be a black block on paper.
    alpha = np.clip((lum - 0.16) / 0.30, 0, 1)
    for r in range(n):
        y = top + r
        if 0 <= y < h and alpha[r] > 0:
            k = (alpha[r] * fade)[:, None]
            img[y] = img[y] * (1 - k) + col[r][None, :] * k
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    # A soft fall-off where the bars meet the paper above and below, like the app's streak edges.
    blur = out.filter(ImageFilter.GaussianBlur(0.6 * scale))
    out = Image.blend(out, blur, 0.5)
    d = ImageDraw.Draw(out)
    font = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', round(13 * scale))
    text = 'Drag copyshop to Applications'
    tw = d.textlength(text, font=font)
    d.text(((w - tw) / 2, 318 * scale), text, font=font, fill=INK)
    return out


def main():
    out_dir = os.path.join(ROOT, 'src-tauri/dmg')
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.mkdtemp()
    render(1).save(f'{tmp}/background.png')
    render(2).save(f'{tmp}/background@2x.png')
    # One TIFF holding both sizes: Finder picks the sharp one on a Retina screen.
    subprocess.run(['tiffutil', '-cathidpicheck', f'{tmp}/background.png', f'{tmp}/background@2x.png', '-out', f'{out_dir}/background.tiff'], check=True)
    print('wrote', f'{out_dir}/background.tiff')


if __name__ == '__main__':
    main()
