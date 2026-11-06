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

That's it. `react-native bundle`, release builds and Xcode Release builds now produce tree-shaken bundles. Development builds behave as before.

## Compatibility

| React Native | Metro |
| ------------ | ----- |
| 0.86         | 0.84  |
| 0.87         | 0.87  |
| 0.88         | 0.87  |

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

Set `METRO_TREE_SHAKING_REPORT=1` to list every file and who imports it, or `0` to hide the report. `react` and `react-native` are left out. App files in the report are the ones you can fix: use named imports instead of `import * as` / `require()`, and ES modules instead of `module.exports`.

## How it works

1. **Transform worker:** production JS modules are kept as ES modules, with their AST and import/export information (Expo's "optimize" mode). Everything else goes to the original `metro-transform-worker`.
2. **Serializer:** Expo's graph tree shaker removes unused exports and imports, honoring `package.json#sideEffects`. The deferred transform steps then run (import/export → `require`, module wrapping, minification), and modules no longer imported are dropped. An existing `customSerializer` receives the tree-shaken graph.

The code is copied from [`@expo/metro-config`](https://github.com/expo/expo/tree/main/packages/@expo/metro-config) (SDK 58) into `src/`. [SYNCING.md](SYNCING.md) explains how to pull in upstream changes.

## Tips & limitations

- **Production only.** Like Expo, nothing is removed when `dev: true`.
- **`package.json#sideEffects`.** Unused exports are always removed. Whether a whole module can be dropped depends on the field (globs are matched per file):

  | | no field | `false` | `true` |
  | --- | --- | --- | --- |
  | Imported only for unused names (`import { x } from 'lib'`) | removed | removed | kept |
  | Imported for side effects (`import 'lib/polyfill'`) | kept | removed | kept |

  A module counts as `true` if anything it imports is `true`. If a package without the field relies on code that runs on import, import it for side effects or mark it `"sideEffects": true`.
- **CommonJS isn't shaken.** `module.exports` / `require()` modules keep all their exports, and so does `export * from` a CommonJS module.
- **Namespaces keep the whole module.** `import * as ns` and `export * as ns from` keep every export once `ns` is used. Prefer named imports.
- **Dev server.** `dev=false` requests are tree-shaken, but their separately served `.map` is not.

## Differences from Expo

- **No Expo needed:** works with plain `react-native bundle` and `@react-native/babel-preset`.
- **On by default** in production builds. Expo needs `EXPO_UNSTABLE_TREE_SHAKING=1` and `EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH=1`.
- **Fixes on top of Expo's code:**
  - Unused classes are removed. `@react-native/babel-preset` compiles classes to functions that reference themselves, which Expo counts as usage. The same applies to recursive functions.
  - A side-effect import (`import 'lib/polyfill'`) after a named import of the same file is no longer dropped.
  - `export * as ns from` works. `babel-preset-expo` rewrites it before tree shaking, `@react-native/babel-preset` doesn't, and Expo's logic then removed exports used through `ns`. On Metro 0.84 it's rewritten automatically.
- **A report** of what couldn't be tree-shaken.
- **Tree shaking only:** no `Platform.OS` / `process.env` inlining from `babel-preset-expo`. Metro's own `inlinePlugin` handles `Platform.OS` and `__DEV__`.

See [SYNCING.md](SYNCING.md#local-deviations-keep-these) for every change from Expo's code.

## Examples

[`examples/`](examples) builds the same app with this package, rnx-kit, Expo and Re.Pack, using `react-native-reanimated`, `react-native-svg`, `lucide-react-native`, `date-fns` and `lodash-es`. The production bundle goes from 4243 KB to 1349 KB (Expo's is 1582 KB, mostly because of the Expo runtime). It also measures each import style per library, in JavaScript and Hermes bytecode. See [examples/README.md](examples/README.md).

## Tests

```sh
yarn test
```

The suites in `src/__tests__` are ported from Expo's tree shaking tests.

## License

MIT. Contains code from Expo (650 Industries) and Meta, both MIT licensed. See [LICENSE](LICENSE).
