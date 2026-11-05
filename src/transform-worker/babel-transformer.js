'use strict';
/**
 * Babel transformer wrapper used on Metro 0.84 only: adds the `export * as ns from` rewrite (see
 * `./export-namespace-from`) in front of the project's Babel transformer.
 *
 * The transform worker points `babelTransformerPath` here and registers the project's transformer
 * with `setUpstreamBabelTransformerPath` (same worker process, shared module cache).
 */
const { interopDefault } = require('../metro');
const { exportNamespaceFromPlugin } = require('./export-namespace-from');

let upstreamPath = null;

function setUpstreamBabelTransformerPath(babelTransformerPath) {
  upstreamPath = babelTransformerPath;
}

function getUpstream() {
  if (upstreamPath == null) {
    throw new Error('metro-tree-shaking: the upstream Babel transformer was not registered.');
  }
  return interopDefault(require(upstreamPath));
}

function transform(args) {
  return getUpstream().transform({
    ...args,
    plugins: [exportNamespaceFromPlugin, ...(args.plugins ?? [])],
  });
}

function getCacheKey(...args) {
  const upstream = getUpstream();
  return upstream.getCacheKey ? upstream.getCacheKey(...args) : '';
}

module.exports = { transform, getCacheKey, setUpstreamBabelTransformerPath };
