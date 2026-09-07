# Qaltion

Qaltion is a local-first calculation notebook. Paragraphs are expressions by default; a paragraph beginning with `--` is an explicit comment.

## Development

```sh
npm install
npm run dev
```

The app uses the Worker bridge interface even when a native libqalculate build is not present. The development fallback is intentionally isolated in `src/calculation/fallback.ts`; a generated `public/wasm/qaltion.js` and `qaltion.wasm` take precedence automatically.

## libqalculate PoC

The reproducible build entry point is `wasm/Makefile`. It targets libqalculate `v5.12.0`, the latest official release confirmed during initial research. Install and activate the Emscripten SDK so `em++`, `emconfigure`, and `emmake` are available on `PATH`, then run:

```sh
npm run build:wasm
```

The PoC verifies `1 + 2 -> 3` and `5 km to m -> 5000 m` through the same wrapper used by the app. Definition data and a bundled exchange-rate snapshot are compiled into libqalculate; network retrieval is disabled during the build. Browser-side rate refresh is not implemented yet.

## Licensing

Qaltion is licensed under GPL-3.0-or-later. See `LICENSE` for the full terms.

libqalculate v5.12.0 is GPL-2.0-or-later according to its official `COPYING` file. Any distribution containing the generated WASM must also provide the corresponding libqalculate source, this wrapper, required dependency sources, and the build scripts.
