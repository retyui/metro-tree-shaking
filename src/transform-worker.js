/**
 * Thin wrapper around Expo's Metro transform worker that makes it work with
 * the React Native CLI (plain Metro instead of Expo CLI):
 *
 * 1. Expo CLI passes `customTransformOptions.optimize = true` for production
 *    builds; the React Native CLI doesn't, so we inject it for every non-dev
 *    transform. This keeps ES modules intact until serialization, where the
 *    whole graph can be tree-shaken (`liveBindings` matches index.js).
 * 2. Expo emits source maps in a compact "packed" format that only Expo CLI
 *    knows how to read. We convert them back to Metro's standard format.
 */
const { expoMetroConfigPath } = require('./expo');
const { isTreeShakingEnabled } = require('./env');

const worker = require(expoMetroConfigPath(
  'transform-worker/transform-worker',
));
const { isSerializableSourceMap, materializeMap } = require(expoMetroConfigPath(
  'serializer/packedMap',
));

const CACHE_VERSION = 'rn-tree-shaking-2';

module.exports = {
  ...worker,
  getCacheKey(...args) {
    return `${worker.getCacheKey(...args)}-${CACHE_VERSION}`;
  },
  async transform(config, projectRoot, filename, data, options) {
    if (!options.dev && isTreeShakingEnabled()) {
      options = {
        ...options,
        customTransformOptions: {
          ...options.customTransformOptions,
          optimize: true,
          liveBindings: false,
        },
      };
    }
    const result = await worker.transform(
      config,
      projectRoot,
      filename,
      data,
      options,
    );
    for (const output of result.output) {
      if (isSerializableSourceMap(output.data?.map)) {
        output.data.map = materializeMap(output.data.map);
      }
    }
    return result;
  },
};
