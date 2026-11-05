'use strict';
const { requireMetroPrivate, interopDefault } = require('../metro');
const { isResolvedDependency } = require('../utils/isResolvedDependency');
const { reconcileTransformSerializerPlugin } = require('./reconcileTransformSerializerPlugin');
const { treeShakeSerializer } = require('./treeShakeSerializerPlugin');

function getDefaultSerializer() {
  const baseJSBundle = interopDefault(
    requireMetroPrivate('DeltaBundler/Serializers/baseJSBundle')
  );
  const bundleToString = interopDefault(requireMetroPrivate('lib/bundleToString'));
  return (entryPoint, preModules, graph, options) =>
    bundleToString(baseJSBundle(entryPoint, preModules, graph, options)).code;
}

/**
 * Copy the parts of the graph that tree shaking and reconciliation mutate, so the graph cached
 * by the Metro dev server isn't modified.
 */
function cloneGraph(graph) {
  const CountingSet = interopDefault(requireMetroPrivate('lib/CountingSet'));
  const dependencies = new Map();
  for (const [modulePath, module] of graph.dependencies) {
    const inverseDependencies = new CountingSet();
    for (const inverse of module.inverseDependencies) {
      for (let i = 0; i < module.inverseDependencies.count(inverse); i++) {
        inverseDependencies.add(inverse);
      }
    }
    dependencies.set(modulePath, {
      ...module,
      dependencies: new Map(
        [...module.dependencies].map(([key, dep]) => [
          key,
          { ...dep, data: { ...dep.data, data: { ...dep.data.data } } },
        ])
      ),
      inverseDependencies,
      output: module.output.map((output) =>
        output.data?.ast
          ? { ...output, data: { ...output.data, ast: structuredClone(output.data.ast) } }
          : output
      ),
    });
  }
  return Object.assign(Object.create(Object.getPrototypeOf(graph)), graph, { dependencies });
}

/**
 * Remove modules that are no longer imported after tree shaking.
 *
 * Expo serializes exports by walking the graph from the entry point (see its chunking), so
 * modules orphaned by tree shaking are never emitted. Metro's `baseJSBundle` emits every module
 * of the graph, so the orphans are removed from the graph instead.
 */
function pruneUnreachableModules(graph, roots) {
  const reachable = new Set();
  const queue = [...graph.entryPoints, ...roots].filter((p) => graph.dependencies.has(p));
  while (queue.length) {
    const modulePath = queue.pop();
    if (reachable.has(modulePath)) continue;
    reachable.add(modulePath);
    const module = graph.dependencies.get(modulePath);
    if (!module) continue;
    for (const dep of module.dependencies.values()) {
      if (isResolvedDependency(dep)) queue.push(dep.absolutePath);
    }
  }
  for (const modulePath of [...graph.dependencies.keys()]) {
    if (!reachable.has(modulePath)) {
      graph.dependencies.delete(modulePath);
    }
  }
}

/**
 * Wrap a Metro serializer so production graphs are tree-shaken before being serialized.
 *
 * @param originalSerializer The user's `customSerializer`, or `null` for Metro's default one.
 */
function createTreeShakingSerializer(originalSerializer) {
  const serializer = originalSerializer ?? getDefaultSerializer();

  return async function treeShakingSerializer(entryPoint, preModules, graph, options) {
    // The transform worker only produces optimizable output for production builds.
    if (graph.transformOptions?.dev !== false) {
      return serializer(entryPoint, preModules, graph, options);
    }

    // One-shot builds (`react-native bundle`, `metro build`) don't set `sourceUrl` and use a
    // throwaway graph that can be modified in place. Dev server requests set the request URL
    // and keep the graph around for incremental updates, so it's copied first.
    const isOneShotBuild = options.sourceUrl == null;
    let props = [
      entryPoint,
      preModules,
      isOneShotBuild ? graph : cloneGraph(graph),
      {
        ...options,
        serializerOptions: { ...options.serializerOptions, usedExports: true },
      },
    ];

    props = await treeShakeSerializer(...props);
    props = await reconcileTransformSerializerPlugin(...props);
    pruneUnreachableModules(props[2], [entryPoint, ...(options.runBeforeMainModule ?? [])]);

    return serializer(props[0], props[1], props[2], options);
  };
}

module.exports = { createTreeShakingSerializer, cloneGraph };
