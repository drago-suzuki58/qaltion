# Qaltion

Qaltion is a local-first, plain-text calculation notebook powered by libqalculate. It evaluates logical lines from top to bottom and shows each result in a separate lane on the right of the editor.

```text
# Monthly VPS cost

server = 1200 JPY / month
storage = 0.02 USD / GB
storage_usage = 500 GB

server + storage * storage_usage
```

Empty lines are not evaluated. A `#` starts a comment, including at the end of an expression. The document remains plain text: results, syntax highlighting, and diagnostics are runtime UI and are never copied into or persisted with the note.

## Architecture

```text
React
  -> CodeMirror 6 plain text
  -> Calculation Worker
  -> libqalculate WebAssembly
```

- `src/editor/` configures only the CodeMirror extensions Qaltion needs, exact-range semantic decorations, diagnostics, and the non-editable result lane.
- `src/calculation/` owns the Worker protocol, logical-line evaluation, semantic lexer, and development fallback.
- `src/storage/` stores `StoredNote.content` in IndexedDB. Database version 2 performs a one-time best-effort conversion of earlier BlockNote PoC records to plain text.
- `wasm/` contains the existing libqalculate C++ bridge and reproducible Emscripten build.

The Worker bridge is used even when a native build is absent. The mathjs fallback is isolated in `src/calculation/fallback.ts`; generated `public/wasm/qaltion.js` and `qaltion.wasm` take precedence automatically.

## Development

```sh
npm install
npm run dev
```

Run automated checks with:

```sh
npm test
npm run build
```

## libqalculate WASM

The reproducible build entry point is `wasm/Makefile`. It targets libqalculate `v5.12.0`. Install and activate the Emscripten SDK so `em++`, `emconfigure`, and `emmake` are available on `PATH`, then run:

```sh
npm run build:wasm
```

The PoC verifies `1 + 2 -> 3` and `5 km to m -> 5000 m` through the same wrapper used by the app. Definition data and a bundled exchange-rate snapshot are compiled into libqalculate; network retrieval is disabled during the build. Browser-side rate refresh is not implemented.

## Licensing

Qaltion is licensed under GPL-3.0-or-later. See `LICENSE` for the full terms.

libqalculate v5.12.0 is GPL-2.0-or-later according to its official `COPYING` file. Any distribution containing the generated WASM must also provide the corresponding libqalculate source, this wrapper, required dependency sources, and the build scripts.
