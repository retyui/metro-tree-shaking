/**
 * Resolves files inside `@expo/metro-config` through the `expo` package, so the
 * package can depend on `expo` alone.
 */
const path = require('path');

const expoMetroConfigRoot = path.dirname(
  require.resolve('@expo/metro-config/package.json', {
    paths: [path.dirname(require.resolve('expo/package.json'))],
  }),
);

const expoMetroConfigPath = file =>
  require.resolve(path.join(expoMetroConfigRoot, 'build', file));

module.exports = { expoMetroConfigPath };
