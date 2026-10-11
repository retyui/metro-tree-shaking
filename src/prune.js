/**
 * Serializer step that runs after Expo's tree shaking + reconcile: removes
 * modules that are no longer reachable from the entry point.
 *
 * Expo removes unused re-exports such as `export { default as add } from './add.js'`
 * but keeps the target module in the graph when it has a default export.
 * Barrel files like `lodash-es` do this for every function, so all of them
 * would stay in the bundle as dead code. Reconcile re-collects each module's
 * dependencies from its final code, so anything not reachable now is unused.
 */
function pruneUnreachableModules(entryPoint, preModules, graph, options) {
  const roots = [
    entryPoint,
    ...graph.entryPoints,
    ...(options.runBeforeMainModule ?? []),
  ];
  const reachable = new Set();

  while (roots.length > 0) {
    const modulePath = roots.pop();
    const module = graph.dependencies.get(modulePath);
    if (!module || reachable.has(modulePath)) {
      continue;
    }
    reachable.add(modulePath);
    for (const dependency of module.dependencies.values()) {
      if (dependency.absolutePath) {
        roots.push(dependency.absolutePath);
      }
    }
  }

  for (const [modulePath, module] of graph.dependencies) {
    if (!reachable.has(modulePath)) {
      graph.dependencies.delete(modulePath);
      continue;
    }
    for (const inverse of module.inverseDependencies) {
      if (!reachable.has(inverse)) {
        module.inverseDependencies.delete(inverse);
      }
    }
  }

  return [entryPoint, preModules, graph, options];
}

module.exports = { pruneUnreachableModules };
