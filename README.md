# metro-tree-shaking

[Expo's tree shaking](https://docs.expo.dev/guides/tree-shaking/) for **bare React Native** projects: one function, no Expo dependencies.

Unused exports, re-exports and modules are removed from **production** bundles (`dev: false`), the same way `expo export` does it.

## Setup

```sh
yarn add -D metro-tree-shaking
```

**metro.config.js**

```js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withTreeShaking } = require('metro-tree-shaking');

const config = {};

module.exports = withTreeShaking(mergeConfig(getDefaultConfig(__dirname), config));
```

**babel.config.js**: keep `import`/`export` so Metro can analyze them:

```js
module.exports = {
  presets: [['module:@react-native/babel-preset', { disableImportExportTransform: true }]],
};
```

That's it. `react-native bundle`, `react-native run-android --mode release`, Xcode Release builds, etc. now produce tree-shaken bundles. Development builds behave as before.

## Compatibility

| React Native | Metro |
| ------------ | ----- |
| 0.86         | 0.84  |
| 0.87         | 0.87  |
| 0.88         | 0.87  |

Metro 0.84 can't transform `export * as ns from`; on that version it's rewritten automatically (`import * as ns` + `export { ns }`).

## Report

Production builds print which modules could not be fully tree-shaken, and why:

```
metro-tree-shaking: 14 modules could not be fully tree-shaken
  8 CommonJS, exports can not be removed: react-native-svg, lodash, +3 more
  3 "sideEffects": true in package.json, kept whenever imported: react-native-reanimated
  2 ES modules used as a namespace, all exports kept: src/utils/index.js
  1 ES modules loaded with require(), all exports kept: src/api.js
  Set METRO_TREE_SHAKING_REPORT=1 for details, or 0 to hide this report.
```

| `METRO_TREE_SHAKING_REPORT` | Output |
| --- | --- |
| not set | short summary |
| `1` | every file (app files one by one, `node_modules` grouped by package) and who imports it |
| `0` | nothing |

```sh
METRO_TREE_SHAKING_REPORT=1 npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output /tmp/main.jsbundle
```

App files in the report are the ones you can fix: use named imports instead of `import * as` / `require()`, and ES modules instead of `module.exports`.

## How it works

`withTreeShaking(config)`:

1. **Transform worker**: `transformerPath` points to a worker that, for production JS modules, keeps them as ES modules and stores their AST and import/export information (Expo's "optimize" mode). Everything else (dev builds, JSON, assets, scripts) is delegated to the original `metro-transform-worker`.
2. **Serializer**: before the bundle is written, Expo's graph tree shaker removes unused exports and imports across the whole graph, honoring `package.json#sideEffects`. The deferred transform steps then run (import/export → `require`, dependency collection, module wrapping, minification), and modules that are no longer imported are dropped.
3. **`experimentalImportSupport: true`** is forced, since Babel no longer converts `import`/`export`.

An existing `serializer.customSerializer` is kept: it receives the tree-shaken graph.

The tree-shaking logic is copied from [`@expo/metro-config`](https://github.com/expo/expo/tree/main/packages/@expo/metro-config) (SDK 58) and kept as local files; see the header of each file in `src/` for what was changed. To pull in upstream changes, follow [SYNCING.md](SYNCING.md). The final `import`/`export` transform uses Metro's own `importExportPlugin` (the same one Metro uses in development with `experimentalImportSupport`) instead of Expo's fork.

Improvements over Expo:

- An export referenced only from inside its own declaration (a recursive function) or through a local binding that shadows it is treated as unused. This matters for React Native because `@react-native/babel-preset` compiles classes to functions with the `default` transform profile (`var A = function () { function A() {} … }()`), which made every exported class look used.
- Import order doesn't matter. In Expo, every import of a file is treated like the file's first one, so a side-effect import (`import 'lib/polyfill'`) after a named import could be removed.
- `export * as ns from` is supported. `babel-preset-expo` rewrites it before tree shaking, but `@react-native/babel-preset` keeps it, and Expo's logic then removed exports used through `ns`.

## Tips & limitations

- **Production only.** Like Expo, nothing is removed when `dev: true`.
- **`package.json#sideEffects`.** Unused exports are removed in every case. Whether a whole imported module can be dropped depends on the field (a list of globs is matched per file):

  | | no field | `false` | `true` |
  | --- | --- | --- | --- |
  | Module imported only for names that are never used (`import { x } from 'lib'`) | removed, including its top-level code | removed | kept |
  | Module imported for its side effects (`import 'lib/polyfill'`) | kept | removed | kept |

  A module counts as `true` if it, or anything it imports, is marked `true`. Modules without any code are always removed (a module that only becomes empty after tree shaking is still bundled when marked `true`). If a package without the field relies on top-level code that runs on import, import it for side effects (`import 'lib'`) or mark it `"sideEffects": true`.
- **CommonJS isn't shaken.** Modules using `module.exports`/`exports` or `require()` keep all their exports, and so does `export * from` a CommonJS module.
- **Namespaces keep the whole module.** `import * as ns` and `export * as ns from` keep every export of the module once `ns` is used, since any property may be read; an unused `ns` is removed. Prefer named imports. `export * from` an ES module is shaken like named re-exports.
- **Dev server.** Requests with `dev=false` to the dev server are tree-shaken on a copy of the graph. The source map served separately for such a request (`.map` URL) is not tree-shaken.

## Tests

```sh
yarn test
```

The suites in `src/__tests__` are ported from Expo's tree shaking tests.

## License

MIT. Contains code from Expo (650 Industries) and Meta, both MIT licensed. See [LICENSE](LICENSE).
