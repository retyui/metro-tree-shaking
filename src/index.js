'use strict';
const path = require('path');

const { resolveFromMetro } = require('./metro');
const { createTreeShakingSerializer } = require('./serializer');
const { UPSTREAM_TRANSFORMER_KEY } = require('./transform-worker');

const TRANSFORMER_PATH = require.resolve('./transform-worker');

function resolveTransformerPath(transformerPath, projectRoot) {
  if (!transformerPath) {
    return resolveFromMetro('metro-transform-worker');
  }
  if (path.isAbsolute(transformerPath)) {
    return transformerPath;
  }
  try {
    return require.resolve(transformerPath, { paths: [projectRoot ?? process.cwd()] });
  } catch {
    return resolveFromMetro(transformerPath);
  }
}

/**
 * Enable Expo's tree shaking for production (`dev: false`) bundles.
 *
 * Requires `disableImportExportTransform: true` for `@react-native/babel-preset`, so modules
 * reach Metro as ES modules.
 *
 * @example
 * // metro.config.js
 * const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
 * const { withTreeShaking } = require('metro-tree-shaking');
 *
 * module.exports = withTreeShaking(mergeConfig(getDefaultConfig(__dirname), {}));
 */
function withTreeShaking(config) {
  if (config.transformerPath === TRANSFORMER_PATH) {
    // Already applied.
    return config;
  }

  const transformer = config.transformer ?? {};
  const serializer = config.serializer ?? {};
  const getTransformOptions = transformer.getTransformOptions;

  return {
    ...config,
    transformerPath: TRANSFORMER_PATH,
    transformer: {
      ...transformer,
      [UPSTREAM_TRANSFORMER_KEY]: resolveTransformerPath(
        config.transformerPath,
        config.projectRoot
      ),
      // `import`/`export` are kept by Babel, so Metro must transform them (in development too).
      async getTransformOptions(...args) {
        const options = getTransformOptions ? await getTransformOptions(...args) : {};
        return {
          ...options,
          transform: { ...options?.transform, experimentalImportSupport: true },
        };
      },
    },
    serializer: {
      ...serializer,
      customSerializer: createTreeShakingSerializer(serializer.customSerializer ?? null),
    },
  };
}

module.exports = { withTreeShaking };
