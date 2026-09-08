# libqalculate WASM PoC

This directory is the first technical boundary for Qaltion's calculation engine. It exposes only:

- `QaltionEngine::evaluate(expression)`
- `QaltionEngine::resetContext()`
- `QaltionEngine::getSymbolRegistry()`

The wrapper does not expose C++ objects to the browser. `Calculator::calculateAndPrint()` is used for the formatted result and libqalculate's own parser/evaluator remains responsible for expression semantics. `getSymbolRegistry()` returns a small JSON object containing active names and aliases for functions, variables, units, currencies, and prefixes; Qaltion requests it once through the Calculation Worker for local highlighting.

## Build

The Makefile downloads the pinned official libqalculate, GMP, MPFR and libxml2 sources. Install and activate the Emscripten SDK first so `em++`, `emconfigure`, and `emmake` are available on `PATH`.

```sh
make
```

The output is copied to `../public/wasm/`. The generated module is an ES module named `qaltion.js` and uses `qaltion.wasm` next to it.

## Manual PoC check

Once built, open `poc/index.html` through a local HTTP server. It calls the bridge without React and prints the two required checks:

```text
1 + 2 = 3
5 km to m = 5000 m
```
