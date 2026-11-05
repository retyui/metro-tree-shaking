'use strict';
/**
 * Copyright © 2024 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `sortDependencies` copied from `@expo/metro-config/src/serializer/reconcileTransformSerializerPlugin.ts` (SDK 58).
 * Changes: TS -> JS.
 */
const { getKeyForDependency, hashKey } = require('../transform-worker/collect-dependencies');

// Some imports may change order during the transform, so we need to resort them.
// Resort the dependencies to match the current order of the AST.
function sortDependencies(dependencies, accordingTo) {
  // Some imports may change order during the transform, so we need to resort them.
  // Resort the dependencies to match the current order of the AST.
  const nextDependencies = new Map();
  const findDependency = (dep) => {
    const original = accordingTo.get(dep.data.key);

    // We can do a quick check first but this may not always work.
    //
    // In cases where the original import was ESM but mutated during tree-shaking (such as `export * from "./"`) then the
    // key will always be based on CJS because we need to transform before collecting a second time.
    //
    // In this case, we'll create the inverse key based on ESM to try and find the original dependency.
    if (original) {
      return original;
    }

    // Only perform the hacky inverse key check if it's this specific case that we know about, otherwise throw an error.
    if (dep.data.isESMImport === false) {
      const inverseKey = hashKey(
        getKeyForDependency({
          asyncType: dep.data.asyncType,
          isESMImport: !dep.data.isESMImport,
          name: dep.name,
          contextParams: dep.data.contextParams,
        }),
      );
      if (accordingTo.has(inverseKey)) {
        return accordingTo.get(inverseKey);
      }
    }

    // If the dependency was optional, then we can skip throwing the error.
    if (dep.data.isOptional) {
      return null;
    }
    throw new Error(
      `Dependency ${dep.data.key} (${dep.name}) not found in the original module during optimization pass. Available keys: ${Array.from(
        accordingTo.entries(),
      )
        .map(([key, dep]) => `${key} (${dep.data.name})`)
        .join(', ')}`,
    );
  };

  // Metro uses this Map hack so we need to create a new map and add the items in the expected order.
  dependencies.forEach((dep) => {
    const original = findDependency(dep);

    // In the case of missing optional dependencies, the absolutePath will not be defined.
    if (!original) {
      nextDependencies.set(dep.data.key, {
        // @ts-expect-error: Missing async types. This could be a problem for bundle splitting.
        data: dep,
      });
    }
    nextDependencies.set(dep.data.key, {
      ...original,
      // @ts-expect-error: Missing async types. This could be a problem for bundle splitting.
      data: dep,
    });
  });
  return nextDependencies;
}

module.exports = { sortDependencies };
