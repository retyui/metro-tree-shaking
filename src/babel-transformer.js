/**
 * Wraps Expo's Babel transformer so apps can keep `@react-native/babel-preset`.
 * It adds the two Babel plugins Expo's tree shaking would otherwise get from
 * `babel-preset-expo`:
 *
 * - `detectDynamicExports`: marks modules that use `module.exports`/`exports`,
 *   so they are never tree-shaken.
 * - Metro's `inlinePlugin` (production only): inlines `Platform.OS`,
 *   `Platform.select()`, `__DEV__` and `process.env.NODE_ENV`, so dead
 *   branches can be removed. Stock Metro does this too, but Expo's transform
 *   worker leaves it to `babel-preset-expo`.
 */
const { expoMetroConfigPath, expoRequire } = require('./expo');

const transformer = require(expoMetroConfigPath('babel-transformer'));
const { detectDynamicExports } = expoRequire(
  'babel-preset-expo/build/plugins/detect-dynamic-exports',
);
const { inlinePlugin } = expoRequire('@expo/metro/metro-transform-plugins');

const CACHE_VERSION = 'metro-tree-shaking-babel-1';

module.exports = {
  ...transformer,
  getCacheKey(...args) {
    return `${transformer.getCacheKey(...args)}-${CACHE_VERSION}`;
  },
  transform(args) {
    const { options } = args;
    const plugins = [...(args.plugins ?? []), detectDynamicExports];
    if (!options.dev) {
      plugins.push([
        inlinePlugin,
        {
          dev: options.dev,
          inlinePlatform: options.inlinePlatform ?? true,
          isWrapped: false,
          platform: options.platform,
        },
      ]);
    }
    return transformer.transform({ ...args, plugins });
  },
};
