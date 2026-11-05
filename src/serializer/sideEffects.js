/**
 * Copyright © 2024 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Copied from `@expo/metro-config/src/serializer/sideEffects.ts` (SDK 58). Changes: TS -> JS,
 * added `getPackageJsonSideEffect` (used by the report).
 */

'use strict';
const fs = require('fs');
const path = require('path');
const picomatch = require('picomatch');

const { isResolvedDependency } = require('../utils/isResolvedDependency');
const { toPosixPath } = require('../utils/filePath');
const { findUpPackageJsonPath } = require('../utils/findUpPackageJsonPath');
function hasSideEffectWithDebugTrace(
  options,
  graph,
  value,
  parentTrace = [value.path],
  checked = new Set(),
) {
  const currentModuleHasSideEffect = getShallowSideEffect(options, value);
  if (currentModuleHasSideEffect) {
    return [true, parentTrace];
  }
  // Recursively check if any of the dependencies have side effects.
  for (const depReference of value.dependencies.values()) {
    if (!isResolvedDependency(depReference) || checked.has(depReference.absolutePath)) {
      continue;
    }
    checked.add(depReference.absolutePath);
    const dep = graph.dependencies.get(depReference.absolutePath);
    if (!dep) {
      continue;
    }
    const [hasSideEffect, trace] = hasSideEffectWithDebugTrace(
      options,
      graph,
      dep,
      [...parentTrace, depReference.absolutePath],
      checked,
    );
    if (hasSideEffect) {
      // Propagate the side effect to the parent.
      value.sideEffects = true;
      return [true, trace];
    }
  }
  return [currentModuleHasSideEffect, []];
}
const pkgJsonCache = new Map();
const getPackageJsonMatcher = (options, dir) => {
  let packageJson;
  let packageJsonPath = null;
  if (typeof options._test_getPackageJson === 'function') {
    [packageJson, packageJsonPath] = options._test_getPackageJson(dir);
  } else {
    const cached = pkgJsonCache.get(dir);
    if (cached) {
      return cached;
    }
    packageJsonPath = findUpPackageJsonPath(dir);
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  }
  if (!packageJsonPath) {
    return null;
  }

  // TODO: Split out and unit test.
  const dirRoot = path.dirname(packageJsonPath);
  const isSideEffect = _createSideEffectMatcher(dirRoot, packageJson, packageJsonPath);
  pkgJsonCache.set(dir, isSideEffect);
  return isSideEffect;
};
function _createSideEffectMatcher(dirRoot, packageJson, packageJsonPath = '') {
  let sideEffectMatcher;
  if (Array.isArray(packageJson.sideEffects)) {
    const sideEffects = packageJson.sideEffects
      .filter((sideEffect) => typeof sideEffect === 'string')
      .map((sideEffect) => {
        const pattern = sideEffect.replace(/^\.\//, '');
        return pattern.includes('/') ? pattern : `**/${pattern}`;
      });
    sideEffectMatcher = picomatch(sideEffects);
  } else if (typeof packageJson.sideEffects === 'boolean' || !packageJson.sideEffects) {
    sideEffectMatcher = packageJson.sideEffects;
  } else {
    event('side_effects:invalid_field', {
      path: packageJsonPath,
    });
  }
  return (fp) => {
    // Default is that everything is a side-effect unless explicitly marked as not.
    if (sideEffectMatcher == null) {
      return null;
    } else if (typeof sideEffectMatcher === 'boolean') {
      return sideEffectMatcher;
    } else {
      const relativeName = path.isAbsolute(fp) ? path.relative(dirRoot, fp) : path.normalize(fp);
      return sideEffectMatcher(toPosixPath(relativeName));
    }
  };
}
function getShallowSideEffect(options, value) {
  if (value?.sideEffects !== undefined) {
    return value.sideEffects;
  }
  const isSideEffect = detectHasSideEffectInPackageJson(options, value);
  value.sideEffects = isSideEffect;
  return isSideEffect;
}
function detectHasSideEffectInPackageJson(options, value) {
  if (value.sideEffects !== undefined) {
    return value.sideEffects;
  }
  // Don't perform lookup on virtual modules.
  if (isVirtualModule(value.path)) {
    return false;
  }
  if (value.output.some((output) => output.type === 'js/module')) {
    const isSideEffect = getPackageJsonMatcher(options, value.path);
    if (isSideEffect == null) {
      return null;
    }
    return isSideEffect(value.path);
  }
  return null;
}
function isVirtualModule(path) {
  return path.startsWith('\0');
}

// Not from Expo: the module's own `package.json#sideEffects` value, ignoring its dependencies.
// `null` when the package doesn't declare it.
function getPackageJsonSideEffect(options, modulePath) {
  if (isVirtualModule(modulePath)) {
    return false;
  }
  const isSideEffect = getPackageJsonMatcher(options, modulePath);
  return isSideEffect == null ? null : isSideEffect(modulePath);
}

module.exports = {
  hasSideEffectWithDebugTrace,
  _createSideEffectMatcher,
  isVirtualModule,
  getPackageJsonSideEffect,
};
