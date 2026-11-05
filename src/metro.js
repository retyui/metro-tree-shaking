'use strict';
/**
 * Resolves Metro internals from the `metro` installed in the host project.
 *
 * Packages like `metro-transform-worker` or `metro-source-map` are dependencies of `metro`, so
 * they're resolved relative to `metro` itself to ensure they match the project's Metro version.
 */
const path = require('path');

let metroRoot;
function getMetroRoot() {
  if (!metroRoot) {
    metroRoot = path.dirname(require.resolve('metro/package.json'));
  }
  return metroRoot;
}

/** Resolve a module from the perspective of the installed `metro` package. */
function resolveFromMetro(request) {
  return require.resolve(request, { paths: [getMetroRoot()] });
}

function requireFromMetro(request) {
  return require(resolveFromMetro(request));
}

/** `require('metro/private/<subpath>')` */
function requireMetroPrivate(subpath) {
  return requireFromMetro(`metro/private/${subpath}`);
}

function interopDefault(mod) {
  return mod && mod.__esModule && 'default' in mod ? mod.default : mod;
}

module.exports = {
  resolveFromMetro,
  requireFromMetro,
  requireMetroPrivate,
  interopDefault,
};
