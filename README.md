# copyshop

A photo editor for the step after colour correction. Streak a subject, lay a
sky into the gaps between wires, repeat a building, and finish the photo with
film grain, dither, glow and a paper border. Each effect is a module you switch
on, adjust, and keep to part of the photo with a mask.

![copyshop with the Tide recipe on a street photo](.github/screenshot.jpg)

copyshop runs on macOS, Windows and Linux. Official builds are sold at
[getcopyshop.com](https://getcopyshop.com/buy) for a one-time price and update
themselves. There is also a free [browser playground](https://getcopyshop.com/app/)
with a few of the effects.

This repository is the full source of the desktop app. You can read it, change
it and build copyshop for your own use. See [License](#license).

## Building

You need [Node.js](https://nodejs.org) 20 or newer and
[Rust](https://www.rust-lang.org/tools/install).

On Linux, install the WebKit libraries Tauri needs first:

```sh
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

Then:

```sh
npm ci
npm run app:native     # run the app with hot reloading
npm run build:app      # build it into src-tauri/target/release/bundle
```

`npm run dev` runs the editor in a browser instead, at http://localhost:5178.

A build from this source asks for no license key. It never checks for updates
and sends no crash reports or usage data. Settings says it was built from
source, with a link to buy copyshop if it's useful to you.

## Tests

```sh
npm test               # unit tests (Vitest)
npx tsc -b             # type check
```

`selftest.html` (open it from `npm run dev`) checks the renderer in the browser:
blends, the preview matching the export, and the grain's statistics.

## Layout

| Folder | What's in it |
| --- | --- |
| `src/engine` | The renderer: WebGL shaders for every effect, and what places them on the photo. |
| `src/ui` | The interface: the module stack, the Library, panels and on-photo tools. |
| `src/storage` | Edits, recipes, presets and the library, on disk in the app and in the browser otherwise. |
| `src/ml` | Subject selection, with the EdgeTAM model in `public/models`. |
| `src/pipeline` | Opening and exporting photos. |
| `src-tauri` | The desktop app (Tauri). |
| `presets` | The built-in recipes. |

## Contributing

Bug reports and ideas are welcome in
[Issues](https://github.com/IttsKK/copyshop/issues). For anything larger than a
small fix, open an issue first so we can agree on it before you spend time on
a pull request. Contributions are accepted under the terms in
[LICENSE](LICENSE), section 3.

## License

copyshop is source-available, not open source. You may read and modify the
source and build copyshop for yourself, and use your build for any work. You
may not share or sell builds, or use the code in another product. The full
terms are in [LICENSE](LICENSE). Third-party parts are listed in
[THIRD_PARTY.md](THIRD_PARTY.md).
