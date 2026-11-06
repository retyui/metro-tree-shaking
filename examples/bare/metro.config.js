const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withTreeShaking } = require('metro-tree-shaking');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // The app source lives in `../shared`, used by every example; `../entries` holds the
  // per-library entry points built by `../bench-entries.js`.
  watchFolders: [path.resolve(__dirname, '../shared'), path.resolve(__dirname, '../entries')],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  },
};

const merged = mergeConfig(getDefaultConfig(__dirname), config);

if (process.env.RNX_KIT) {
  // `RNX_KIT=1` builds the same app with rnx-kit's tree shaking (esbuild) instead, to compare.
  const { MetroSerializer, esbuildTransformerConfig } = require('@rnx-kit/metro-serializer-esbuild');
  module.exports = mergeConfig(merged, {
    serializer: { customSerializer: MetroSerializer() },
    transformer: esbuildTransformerConfig,
  });
} else {
  // `NO_TREE_SHAKING=1` builds the same app without metro-tree-shaking, as a baseline.
  module.exports = process.env.NO_TREE_SHAKING ? merged : withTreeShaking(merged);
}
