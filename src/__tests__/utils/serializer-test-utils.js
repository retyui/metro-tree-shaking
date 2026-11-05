'use strict';
/**
 * Based on `@expo/metro-config/src/serializer/fork/__tests__/serializer-test-utils.ts` (SDK 58).
 *
 * Changes: serializes through this package's serializer and returns the bundle as
 * `[{ source }]`, matching the `artifacts` shape used by Expo's tests.
 */
const { createTreeShakingSerializer } = require('../../serializer');
const {
  reconcileTransformSerializerPlugin,
} = require('../../serializer/reconcileTransformSerializerPlugin');
const { microBundle } = require('./mini-metro');

// Babel installs its own `Error.prepareStackTrace` on first use, which prevents Jest from
// locating `toMatchInlineSnapshot()` call sites. Restore Jest's after each bundle.
const jestPrepareStackTrace = Error.prepareStackTrace;

// Don't print the tree shaking report in tests, unless a test sets it.
process.env.METRO_TREE_SHAKING_REPORT ??= '0';

async function serializeOptimizeAsync(fs, options = {}) {
  const { treeshake = false, ...bundleOptions } = options;
  const serial = await microBundle({
    fs,
    options: {
      platform: 'ios',
      dev: false,
      minify: false,
      inlineRequires: true,
      ...bundleOptions,
    },
    preModulesFs: options.mockRuntime ? { 'mock-runtime': `{ /* "runtime" */ }` } : undefined,
  });

  let code;
  if (treeshake) {
    code = await createTreeShakingSerializer(null)(...serial);
  } else {
    // Only finish the transformation, without tree shaking.
    code = defaultSerialize(...(await reconcileTransformSerializerPlugin(...serial)));
  }
  Error.prepareStackTrace = jestPrepareStackTrace;
  return [serial, [{ source: code }]];
}

function defaultSerialize(entryPoint, preModules, graph, options) {
  const baseJSBundle = require('metro/private/DeltaBundler/Serializers/baseJSBundle').default;
  const bundleToString = require('metro/private/lib/bundleToString').default;
  return bundleToString(baseJSBundle(entryPoint, preModules, graph, options)).code;
}

async function serializeShakingAsync(fs, options = {}) {
  return serializeOptimizeAsync(fs, { treeshake: true, ...options });
}

function expectImports(graph, name) {
  if (!graph.dependencies.has(name)) throw new Error(`Module not found: ${name}`);
  return expect([...graph.dependencies.get(name).dependencies.values()]);
}

module.exports = { serializeOptimizeAsync, serializeShakingAsync, expectImports };
