# metro-tree-shaking

Tree shaking for React Native CLI apps.

```sh
npm install -D metro-tree-shaking
```

```js
// metro.config.js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withTreeShaking } = require('metro-tree-shaking');

const config = {};

module.exports = withTreeShaking(mergeConfig(getDefaultConfig(__dirname), config));
```

```js
// babel.config.js: keep the RN preset, but leave `import`/`export` to Metro
module.exports = {
  presets: [
    ['module:@react-native/babel-preset', { disableImportExportTransform: true }],
  ],
};
```

Release builds are now tree-shaken. For example, `import { get } from 'lodash-es'` bundles 53 of lodash-es's ~640 modules.

## Implementation: based on Expo

This package reuses [Expo's Metro tree shaking](https://docs.expo.dev/guides/tree-shaking/), without Expo CLI or Expo Modules (Expo's native code is not linked). It turns on the options Expo CLI normally passes for production builds and swaps in Expo's transformer and serializer. It adds the two Babel plugins Expo's tree shaking normally gets from `babel-preset-expo`: CommonJS export detection, and `Platform.OS` / `__DEV__` inlining. It also adds one extra step that drops modules nothing imports any more.

## Alternatives

- [Re.Pack](https://re-pack.dev/): Rspack/webpack bundler for React Native
- [@rnx-kit/metro-serializer-esbuild](https://microsoft.github.io/rnx-kit/docs/tools/metro-serializer-esbuild): esbuild-based Metro serializer
- [react-native-esbuild](https://github.com/oblador/react-native-esbuild): esbuild instead of Metro

## Limitations

- Only applies to production bundles (`--dev false`). Turn it off with `TREE_SHAKING=0`.
- Expo's tree shaking is experimental, and this package uses Expo internals. It's pinned to Expo SDK 57, which matches React Native 0.86.
- Works only with ES modules. CommonJS code is not shaken.
- Not yet tested in a real app on a device. Tests only bundle a fixture and run it in Node.
