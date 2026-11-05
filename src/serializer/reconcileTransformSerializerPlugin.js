'use strict';
/**
 * Copyright © 2024 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Based on `@expo/metro-config/src/serializer/reconcileTransformSerializerPlugin.ts` (SDK 58).
 * Changes: TS -> JS, uses Metro's own `importExportPlugin` / `inlineRequiresPlugin` (the same
 * plugins `metro-transform-worker` uses with `experimentalImportSupport`) instead of Expo's forks,
 * and supports the source map formats of every supported Metro version.
 *
 * Finishes the transformation that the transform worker deferred (import/export transform,
 * dependency collection, module wrapping, minification) once tree shaking is done.
 */
const { transformFromAstSync } = require('@babel/core');
const generate = require('@babel/generator').default;
const assert = require('assert');

const compat = require('../compat');
const { requireFromMetro, requireMetroPrivate } = require('../metro');
const collectDependencies = require('../transform-worker/collect-dependencies');
const { InvalidRequireCallError } = require('../transform-worker');
const { isResolvedDependency } = require('../utils/isResolvedDependency');
const { isExpoJsOutput } = require('./jsOutput');
const { hasSideEffectWithDebugTrace } = require('./sideEffects');
const { sortDependencies } = require('./sortDependencies');

const metroTransformPlugins = requireFromMetro('metro-transform-plugins');
const { importLocationsPlugin, locToKey } = requireMetroPrivate(
  'ModuleGraph/worker/importLocationsPlugin'
);

function applyImportSupport(ast, { filename, importDefault, importAll, inlineRequires }) {
  const plugins = [
    // Collect the locations of ESM imports before they're converted to requires.
    importLocationsPlugin,
    [metroTransformPlugins.importExportPlugin, { importAll, importDefault, resolve: false }],
  ];
  if (inlineRequires) {
    plugins.push([
      metroTransformPlugins.inlineRequiresPlugin,
      {
        ignoredRequires: inlineRequires.ignoredRequires,
        inlineableCalls: [importDefault, importAll],
        memoizeCalls: inlineRequires.memoizeCalls,
        nonMemoizedModules: inlineRequires.nonMemoizedModules,
      },
    ]);
  }
  const result = transformFromAstSync(ast, '', {
    ast: true,
    babelrc: false,
    code: false,
    configFile: false,
    comments: true,
    filename,
    plugins,
    sourceMaps: false,
    cloneInputAst: false,
  });
  return { ast: result.ast, metadata: result.metadata };
}

async function reconcileTransformSerializerPlugin(entryPoint, preModules, graph, options) {
  // Convert all remaining AST and dependencies to standard output that Metro expects.
  // This is normally done in the transformer, but we skipped it so we could perform graph analysis (tree-shake).
  for (const value of graph.dependencies.values()) {
    for (const index in value.output) {
      const output = value.output[index];
      if (isExpoJsOutput(output)) {
        value.output[index] = await transformDependencyOutput(value, output);
      }
    }
  }

  return [entryPoint, preModules, graph, options];

  async function transformDependencyOutput(value, outputItem) {
    // This should be cached by the transform worker for use here to ensure close to consistent
    // results between the tree-shake and the final transform.
    const reconcile = outputItem.data.reconcile;

    if (outputItem.type !== 'js/module' || !reconcile) {
      return outputItem;
    }

    let ast = outputItem.data.ast;
    assert(ast, 'Missing AST for module: ' + value.path);

    const { importDefault, importAll } = reconcile;

    const sideEffectReferences = () =>
      [...value.dependencies.values()]
        .filter((dep) => {
          const fullDep = isResolvedDependency(dep)
            ? graph.dependencies.get(dep.absolutePath)
            : undefined;
          return fullDep && hasSideEffectWithDebugTrace(options, graph, fullDep)[0];
        })
        .map((dep) => dep.data.name);

    const transformOptions = graph.transformOptions;
    const file = applyImportSupport(ast, {
      filename: value.path,
      importAll,
      importDefault,
      inlineRequires: reconcile.inlineRequires
        ? {
            // Add side-effects to the ignore list.
            ignoredRequires: sideEffectReferences().concat(reconcile.nonInlinedRequires ?? []),
            memoizeCalls:
              transformOptions.customTransformOptions?.unstable_memoizeInlineRequires ??
              transformOptions.unstable_memoizeInlineRequires,
            nonMemoizedModules: transformOptions.unstable_nonMemoizedInlineRequires,
          }
        : null,
    });

    ast = file.ast;

    let dependencyMapName = '';
    let dependencies;

    const importDeclarationLocs = file.metadata?.metro?.unstable_importDeclarationLocs ?? null;
    // This pass converts the modules to use the generated import names.
    try {
      // Rewrite the deps to use Metro runtime, collect the new dep positions.
      ({ ast, dependencies, dependencyMapName } = collectDependencies(ast, {
        ...reconcile.collectDependenciesOptions,
        unstable_isESMImportAtSource:
          importDeclarationLocs != null
            ? (loc) => importDeclarationLocs.has(locToKey(loc))
            : null,
        collectOnly: false,
        keepRequireNames: false,
        // This setting shouldn't be shared + it can't be serialized and cached anyways.
        dependencyTransformer: undefined,
      }));
    } catch (error) {
      if (error instanceof collectDependencies.InvalidRequireCallError) {
        throw new InvalidRequireCallError(error, value.path);
      }
      throw error;
    }

    value.dependencies = sortDependencies(dependencies, value.dependencies);

    const { ast: wrappedAst } = compat.wrapModule(
      ast,
      importDefault,
      importAll,
      dependencyMapName,
      reconcile.globalPrefix,
      {
        skipRequireRename: reconcile.unstable_renameRequire === false,
        unstable_useStaticHermesModuleFactory: reconcile.unstable_useStaticHermesModuleFactory,
      }
    );

    const reserved = [];
    if (reconcile.unstable_dependencyMapReservedName != null) {
      reserved.push(reconcile.unstable_dependencyMapReservedName);
    }
    if (reconcile.normalizePseudoGlobals) {
      // This MUST run before `generate` as it mutates the ast out of place.
      reserved.push(
        ...metroTransformPlugins.normalizePseudoGlobals(wrappedAst, { reservedNames: reserved })
      );
    }

    const source = value.getSource().toString('utf-8');
    const result = generate(
      wrappedAst,
      {
        comments: true,
        compact: reconcile.unstable_compactOutput,
        filename: value.path,
        retainLines: false,
        sourceFileName: value.path,
        sourceMaps: true,
      },
      source
    );

    let code;
    let lineCount;
    let map;
    if (reconcile.minify) {
      ({ code, lineCount, map } = await compat.minifyCode(
        reconcile.minify,
        value.path,
        result,
        source,
        reserved
      ));
    } else {
      code = result.code;
      ({ lineCount, map } = compat.mapFromGeneratorResult(result));
    }

    // Drop the AST and reconcile settings, only keep what Metro expects in a JS output.
    const { ast: _ast, reconcile: _reconcile, hasCjsExports: _cjs, ...data } = outputItem.data;
    return {
      ...outputItem,
      data: { ...data, code, lineCount, map },
    };
  }
}

module.exports = { reconcileTransformSerializerPlugin };
