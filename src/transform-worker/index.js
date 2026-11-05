'use strict';
/**
 * Copyright 2023-present 650 Industries (Expo). All rights reserved.
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Metro transform worker used by `withTreeShaking`.
 *
 * - Development builds, scripts, assets and JSON are delegated untouched to the upstream
 *   `metro-transform-worker`.
 * - Production JS modules take the "optimize" path from Expo's fork of the transform worker
 *   (`@expo/metro-config/src/transform-worker/metro-transform-worker.ts`, SDK 58): the module is
 *   kept as ESM, its AST is stored in the output, and the final steps (import/export transform,
 *   dependency collection, wrapping, minification) are deferred to the serializer, after
 *   tree shaking ran over the whole graph.
 */
const { parse, transformFromAstSync, template, types: t } = require('@babel/core');
const generate = require('@babel/generator').default;
const assert = require('node:assert');

const compat = require('../compat');
const {
  requireFromMetro,
  requireMetroPrivate,
  resolveFromMetro,
  interopDefault,
} = require('../metro');
const collectDependencies = require('./collect-dependencies');
const { detectDynamicExports } = require('./detect-dynamic-exports');

/** Key on `config.transformer` holding the transformer we delegate to. */
const UPSTREAM_TRANSFORMER_KEY = 'metroTreeShaking_upstreamTransformerPath';

// NOTE: Increment when the shape of the cached optimize output changes.
const CACHE_VERSION = '1';

const metroTransformPlugins = requireFromMetro('metro-transform-plugins');
const { functionMapBabelPlugin } = requireFromMetro('metro-source-map');
const { importLocationsPlugin, locToKey } = requireMetroPrivate(
  'ModuleGraph/worker/importLocationsPlugin'
);
const generateImportNames = interopDefault(
  requireMetroPrivate('ModuleGraph/worker/generateImportNames')
);

function nullthrows(x, message) {
  assert(x != null, message);
  return x;
}

function getUpstreamTransformer(config) {
  const upstreamPath =
    config[UPSTREAM_TRANSFORMER_KEY] ?? resolveFromMetro('metro-transform-worker');
  return interopDefault(require(upstreamPath));
}

/** Production (`dev: false`) JS modules are tree-shaken, like `expo export` does. */
function shouldOptimize(filename, options) {
  return (
    options.dev === false &&
    options.type === 'module' &&
    // Disable tree shaking on JSON and style files.
    !/\.(json|s?css|sass)$/.test(filename)
  );
}

function shouldMinify(options) {
  return (
    options.minify &&
    options.unstable_transformProfile !== 'hermes-canary' &&
    options.unstable_transformProfile !== 'hermes-stable'
  );
}

function getDynamicDepsBehavior(inPackages, filename) {
  switch (inPackages) {
    case 'reject':
      return 'reject';
    case 'throwAtRuntime':
      return /(?:^|[/\\])node_modules[/\\]/.test(filename) ? inPackages : 'reject';
    default:
      throw new Error(`invalid value for dynamic deps behavior: \`${inPackages}\``);
  }
}

class InvalidRequireCallError extends Error {
  constructor(innerError, filename) {
    super(`${filename}:${innerError.message}`);
    this.innerError = innerError;
    this.filename = filename;
  }
}

function applyUseStrictDirective(ast) {
  // Add "use strict" if the file was parsed as a module, and the directive did not exist yet.
  const { directives } = ast.program;
  if (
    ast.program.sourceType === 'module' &&
    directives != null &&
    directives.findIndex((d) => d.value.value === 'use strict') === -1
  ) {
    directives.push(t.directive(t.directiveLiteral('use strict')));
  }
}

function runPlugins(ast, filename, plugins) {
  return nullthrows(
    transformFromAstSync(ast, '', {
      ast: true,
      babelrc: false,
      cloneInputAst: false,
      code: false,
      comments: true,
      configFile: false,
      filename,
      plugins,
      sourceMaps: false,
    }).ast
  );
}

// Same as `getBabelTransformArgs` in `metro-transform-worker`.
function getBabelTransformArgs(file, { options, config, projectRoot }, plugins = []) {
  const { inlineRequires: _, ...babelTransformerOptions } = options;
  return {
    filename: file.filename,
    options: {
      ...babelTransformerOptions,
      ...compat.getBabelRuntimeOptions(config),
      supportsInlineModules: config.unstable_supportsInlineModules === true,
      enableBabelRCLookup: config.enableBabelRCLookup,
      enableBabelRuntime: config.enableBabelRuntime,
      globalPrefix: config.globalPrefix,
      hermesParser: config.hermesParser,
      projectRoot,
      publicPath: config.publicPath,
    },
    plugins,
    src: file.code,
  };
}

async function transformOptimized(config, projectRoot, filename, data, options) {
  const context = { config, options, projectRoot };
  const file = {
    code: data.toString('utf8'),
    filename,
    inputFileSize: data.length,
  };

  if (config.unstable_dependencyMapReservedName != null) {
    const position = file.code.indexOf(config.unstable_dependencyMapReservedName);
    if (position > -1) {
      throw new SyntaxError(
        'Source code contains the reserved string `' +
          config.unstable_dependencyMapReservedName +
          '` at character offset ' +
          position
      );
    }
  }

  const babelTransformer = interopDefault(require(config.babelTransformerPath));
  const transformResult = await babelTransformer.transform(
    getBabelTransformArgs(file, context, [
      // populates metadata.metro.functionMap
      functionMapBabelPlugin,
      // populates metadata.metro.unstable_importDeclarationLocs
      importLocationsPlugin,
      // populates metadata.hasCjsExports (normally added by `babel-preset-expo`)
      detectDynamicExports,
    ])
  );
  const metadata = transformResult.metadata;

  // Transformers can output null ASTs (if they ignore the file). In that case
  // we need to parse the module source code to get their AST.
  let ast = transformResult.ast ?? nullthrows(parse(file.code, { sourceType: 'unambiguous' }));

  const { importDefault, importAll } = generateImportNames(ast);

  applyUseStrictDirective(ast);

  // Metro's own inlining (`Platform.OS`, `__DEV__`, `process.env.NODE_ENV`), then constant folding
  // so dead branches are gone before the graph is analyzed.
  ast = runPlugins(ast, file.filename, [
    [
      metroTransformPlugins.inlinePlugin,
      {
        dev: options.dev,
        inlinePlatform: options.inlinePlatform,
        isWrapped: false,
        platform: options.platform,
      },
    ],
  ]);
  ast = runPlugins(ast, file.filename, [metroTransformPlugins.constantFoldingPlugin]);

  // These values must be serializable to JSON as they're stored in the transform cache.
  let collectDependenciesOptions = {
    asyncRequireModulePath: config.asyncRequireModulePath,
    dynamicRequires: getDynamicDepsBehavior(config.dynamicDepsInPackages, file.filename),
    inlineableCalls: [importDefault, importAll],
    keepRequireNames: options.dev,
    allowOptionalDependencies: config.allowOptionalDependencies,
    dependencyMapName: config.unstable_dependencyMapReservedName,
    unstable_allowRequireContext: config.unstable_allowRequireContext,
    unstable_isESMImportAtSource: null,
  };

  let dependencies;
  try {
    const importDeclarationLocs = metadata?.metro?.unstable_importDeclarationLocs ?? null;
    const collected = collectDependenciesForShaking(ast, {
      ...collectDependenciesOptions,
      unstable_isESMImportAtSource:
        importDeclarationLocs != null
          ? (loc) => importDeclarationLocs.has(locToKey(loc))
          : null,
    });
    ast = collected.ast;
    dependencies = collected.dependencies;
    // Ensure we use the same name for the second pass of the dependency collection in the serializer.
    collectDependenciesOptions = {
      ...collectDependenciesOptions,
      dependencyMapName: collected.dependencyMapName,
    };
  } catch (error) {
    if (error instanceof collectDependencies.InvalidRequireCallError) {
      throw new InvalidRequireCallError(error, file.filename);
    }
    throw error;
  }

  const minify = shouldMinify(options);

  // Settings used by the serializer to finish the transformation after tree shaking.
  const reconcile = {
    inlineRequires: options.inlineRequires,
    nonInlinedRequires: options.nonInlinedRequires,
    importDefault,
    importAll,
    globalPrefix: config.globalPrefix,
    unstable_compactOutput: config.unstable_compactOutput,
    collectDependenciesOptions,
    minify: minify
      ? { minifierPath: config.minifierPath, minifierConfig: config.minifierConfig }
      : undefined,
    normalizePseudoGlobals:
      minify &&
      file.inputFileSize <= config.optimizationSizeLimit &&
      !config.unstable_disableNormalizePseudoGlobals,
    unstable_dependencyMapReservedName: config.unstable_dependencyMapReservedName,
    unstable_renameRequire: config.unstable_renameRequire,
    unstable_useStaticHermesModuleFactory: Boolean(
      options.customTransformOptions?.unstable_staticHermesOptimizedRequire
    ),
  };

  // The code is only a placeholder: the serializer regenerates it from the AST. Unlike Expo,
  // we skip minification here since the result is thrown away.
  const code = generate(ast, { comments: true, filename: file.filename }, file.code).code;

  const output = [
    {
      data: {
        code,
        lineCount: compat.countLines(code).lineCount,
        map: compat.usesVlqMaps ? { mappings: '', names: [] } : [],
        functionMap: metadata?.metro?.functionMap ?? transformResult.functionMap ?? null,
        hasCjsExports: metadata?.hasCjsExports,
        ast,
        reconcile,
      },
      type: 'js/module',
    },
  ];

  return {
    dependencies,
    // Babel plugins (e.g. React Compiler) can leave non-serializable values (Symbols, functions)
    // in the AST, which break passing the result between worker threads and the transform cache.
    output: JSON.parse(JSON.stringify(output)),
  };
}

async function transform(config, projectRoot, filename, data, options, ...rest) {
  if (!shouldOptimize(filename, options)) {
    return getUpstreamTransformer(config).transform(
      config,
      projectRoot,
      filename,
      data,
      options,
      ...rest
    );
  }
  return transformOptimized(config, projectRoot, filename, data, options);
}

function getCacheKey(config, opts) {
  const { getCacheKey: getFilesCacheKey } = requireFromMetro('metro-cache-key');
  const filesKey = getFilesCacheKey([
    __filename,
    require.resolve('../compat'),
    require.resolve('./collect-dependencies'),
    require.resolve('./detect-dynamic-exports'),
  ]);
  return [
    getUpstreamTransformer(config).getCacheKey(config, opts),
    CACHE_VERSION,
    filesKey,
  ].join('$');
}

/**
 * Produces a Babel template that transforms an "import(...)" call into a
 * "require(...)" call to the asyncRequire specified.
 */
const makeShimAsyncRequireTemplate = template.expression(`require(ASYNC_REQUIRE_MODULE_PATH)`);

const disabledDependencyTransformer = {
  transformSyncRequire: () => {},
  transformImportMaybeSyncCall: () => {},
  transformImportCall: (path, dependency, state) => {
    // HACK: Ensure the async import code is included in the bundle when an import() call is found.
    let topParent = path;
    while (topParent.parentPath) {
      topParent = topParent.parentPath;
    }
    if (topParent._handled) {
      return;
    }
    path.insertAfter(
      makeShimAsyncRequireTemplate({
        ASYNC_REQUIRE_MODULE_PATH: nullthrows(state.asyncRequireModulePathStringLiteral),
      })
    );
    topParent._handled = true;
  },
  transformPrefetch: () => {},
  transformIllegalDynamicRequire: () => {},
};

function collectDependenciesForShaking(ast, options) {
  return collectDependencies(ast, {
    ...options,
    // Preserve the original require calls. This ensures require.context calls are not broken.
    collectOnly: true,
    dependencyTransformer: disabledDependencyTransformer,
  });
}

module.exports = {
  transform,
  getCacheKey,
  // Used by the serializer
  UPSTREAM_TRANSFORMER_KEY,
  InvalidRequireCallError,
  collectDependenciesForShaking,
};
