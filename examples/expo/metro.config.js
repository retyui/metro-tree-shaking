const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The app source lives in `../shared`, used by every example; `../entries` holds the
// per-library entry points built by `../bench-entries.js`.
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, '../shared'),
  path.resolve(__dirname, '../entries'),
];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
