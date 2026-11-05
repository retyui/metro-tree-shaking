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

## How it works

`withTreeShaking(config)`:

1. **Transform worker**: `transformerPath` points to a worker that, for production JS modules, keeps them as ES modules and stores their AST and import/export information (Expo's "optimize" mode). Everything else (dev builds, JSON, assets, scripts) is delegated to the original `metro-transform-worker`.
2. **Serializer**: before the bundle is written, Expo's graph tree shaker removes unused exports and imports across the whole graph, honoring `package.json#sideEffects`. The deferred transform steps then run (import/export → `require`, dependency collection, module wrapping, minification), and modules that are no longer imported are dropped.
3. **`experimentalImportSupport: true`** is forced, since Babel no longer converts `import`/`export`.

An existing `serializer.customSerializer` is kept: it receives the tree-shaken graph.

The tree-shaking logic is copied from [`@expo/metro-config`](https://github.com/expo/expo/tree/main/packages/@expo/metro-config) (SDK 58) and kept as local files; see the header of each file in `src/` for what was changed. The final `import`/`export` transform uses Metro's own `importExportPlugin` (the same one Metro uses in development with `experimentalImportSupport`) instead of Expo's fork.

One improvement over Expo: an export referenced only from inside its own declaration (a recursive function) or through a local binding that shadows it is treated as unused. This matters for React Native because `@react-native/babel-preset` compiles classes to functions with the `default` transform profile (`var A = function () { function A() {} … }()`), which made every exported class look used.

## Tips & limitations

- **Production only.** Like Expo, nothing is removed when `dev: true`.
- **Mark packages as side-effect free.** Unused imports of modules are only dropped when the package declares `"sideEffects": false` (or a list) in its `package.json`. Unknown modules are assumed to have side effects.
- **CommonJS isn't shaken.** Modules using `module.exports`/`exports` or `require()` keep all their exports.
- **Dev server.** Requests with `dev=false` to the dev server are tree-shaken on a copy of the graph. The source map served separately for such a request (`.map` URL) is not tree-shaken.

## Tests

```sh
yarn test
```

The suites in `src/__tests__` are ported from Expo's tree shaking tests.

## License

MIT. Contains code from Expo (650 Industries) and Meta, both MIT licensed. See [LICENSE](LICENSE).
