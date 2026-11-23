# Third-party software and models

copyshop includes or depends on the following, each under its own license.

## Subject-selection model

`public/models/onnx-community/EdgeTAM-ONNX` is an ONNX export of
[EdgeTAM](https://github.com/facebookresearch/EdgeTAM) by Meta, used to select
subjects on the photo. EdgeTAM is released under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

## Precise selection's models (downloaded on request)

Not in the app: downloaded when chosen (the welcome sheet or Settings ›
Selection), from Hugging Face, each file pinned and checked
(`src/ml/precise/models.ts`).

- [Segment Anything 2.1](https://github.com/facebookresearch/sam2) (hiera
  small, as `onnx-community/sam2.1-hiera-small-ONNX`) by Meta, under the
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) (as
  `onnx-community/BiRefNet-ONNX`) by Zheng Peng et al., under the
  [MIT License](https://opensource.org/licenses/MIT).

## Libraries

The JavaScript packages listed in `package.json` (resolved in
`package-lock.json`) and the Rust crates listed in `src-tauri/Cargo.toml`
(resolved in `src-tauri/Cargo.lock`) are used under their own licenses, which
ship with each package. They include:

- [Tauri](https://tauri.app) (MIT or Apache 2.0): the desktop app.
- [React](https://react.dev) (MIT): the interface.
- [Transformers.js](https://github.com/huggingface/transformers.js) (Apache 2.0)
  and [ONNX Runtime Web](https://onnxruntime.ai) (MIT): running the selection
  model.
- [Sentry](https://sentry.io) (MIT): crash reports from official builds.
- [jSquash](https://github.com/jamsinclair/jSquash) (Apache 2.0): WebP export.
- [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT): timelapse video.
- [ONNX Runtime](https://onnxruntime.ai) (MIT), through
  [ort](https://github.com/pykeio/ort) (MIT or Apache 2.0): running precise
  selection's models in the app, with
  [DirectML](https://github.com/microsoft/DirectML) (its redistributable
  `DirectML.dll`, under Microsoft's license for it) on Windows.
- [image](https://github.com/image-rs/image) (MIT or Apache 2.0) and
  [jpeg-decoder](https://github.com/image-rs/jpeg-decoder) (MIT or Apache 2.0):
  reading photos on Windows and Linux.
- [rawler](https://github.com/dnglab/dnglab) (LGPL 2.1): reading camera RAW
  files on Windows and Linux. Its source is at the link; since copyshop's own
  source is published, a build can be made with a changed version of it.
