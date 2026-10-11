/**
 * Resolves Expo internals through the `expo` package, so this package only
 * depends on `expo`.
 */
const path = require('path');

const expoRoot = path.dirname(require.resolve('expo/package.json'));
const expoMetroConfigRoot = path.dirname(
  require.resolve('@expo/metro-config/package.json', { paths: [expoRoot] }),
);

/** `require()` a module as if from inside `expo`. */
const expoRequire = request =>
  require(require.resolve(request, { paths: [expoRoot, expoMetroConfigRoot] }));

/** Absolute path of a file in `@expo/metro-config/build`. */
const expoMetroConfigPath = file =>
  require.resolve(path.join(expoMetroConfigRoot, 'build', file));

module.exports = { expoRequire, expoMetroConfigPath };
