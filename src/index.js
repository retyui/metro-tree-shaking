/**
 * Adds Expo's Metro tree shaking to a standard React Native Metro config.
 *
 * Usage (metro.config.js):
 *
 *   const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
 *   const { withTreeShaking } = require('metro-tree-shaking');
 *
 *   const config = {};
 *
 *   module.exports = withTreeShaking(mergeConfig(getDefaultConfig(__dirname), config));
 *
 * Only the transformer, Babel transformer and serializer are swapped for Expo's;
 * everything else stays React Native's default (or yours).
 *
 * Tree shaking only runs for production bundles (`--dev false`): release
 * builds and `react-native bundle --dev false`. Set `TREE_SHAKING=0` to turn it off.
 */
const { expoMetroConfigPath } = require('./expo');
const { isTreeShakingEnabled } = require('./env');

const { pruneUnreachableModules } = require('./prune');

const { createSerializerFromSerialProcessors } = require(expoMetroConfigPath(
  'serializer/withExpoSerializers',
));
const { treeShakeSerializer } = require(expoMetroConfigPath(
  'serializer/treeShakeSerializerPlugin',
));
const { reconcileTransformSerializerPlugin } = require(expoMetroConfigPath(
  'serializer/reconcileTransformSerializerPlugin',
));

function withTreeShaking(config) {
  const getTransformOptions = config.transformer.getTransformOptions;

  const nextConfig = {
    ...config,
    transformerPath: require.resolve('./transform-worker'),
    transformer: {
      ...config.transformer,
      babelTransformerPath: require.resolve('./babel-transformer'),
      // Expo's Babel transformer loads babel.config.js itself; lookup would apply it twice.
      enableBabelRCLookup: undefined,
      async getTransformOptions(entryPoints, options, getDependenciesOf) {
        const result = await getTransformOptions(
          entryPoints,
          options,
          getDependenciesOf,
        );
        // `import`/`export` are kept by Babel (`disableImportExportTransform`)
        // and compiled by Metro instead, so tree shaking can analyze them.
        return {
          ...result,
          transform: { ...result?.transform, experimentalImportSupport: true },
        };
      },
    },
    serializer: { ...config.serializer },
  };

  // Same steps as Expo's default serializer, plus pruning of unreachable modules.
  const expoSerializer = createSerializerFromSerialProcessors(
    nextConfig,
    [treeShakeSerializer, reconcileTransformSerializerPlugin, pruneIfShaken],
    config.serializer.customSerializer ?? null,
  );

  nextConfig.serializer.customSerializer = (
    entryPoint,
    preModules,
    graph,
    options,
  ) => {
    if (graph.transformOptions.dev || !isTreeShakingEnabled()) {
      return expoSerializer(entryPoint, preModules, graph, options);
    }
    // Mirror the options Expo CLI passes for `expo export:embed`. Live bindings
    // are off so exports compile like stock RN (no getter per export), which is
    // much smaller.
    graph.transformOptions.customTransformOptions = {
      ...graph.transformOptions.customTransformOptions,
      optimize: 'true',
      liveBindings: 'false',
    };
    return expoSerializer(entryPoint, preModules, graph, {
      ...options,
      serializerOptions: { ...options.serializerOptions, usedExports: true },
    });
  };

  return nextConfig;
}

function pruneIfShaken(entryPoint, preModules, graph, options) {
  return options.serializerOptions?.usedExports
    ? pruneUnreachableModules(entryPoint, preModules, graph, options)
    : [entryPoint, preModules, graph, options];
}

module.exports = { withTreeShaking };
