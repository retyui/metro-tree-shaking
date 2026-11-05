# Syncing with Expo's tree shaking

How to pull upstream changes from Expo's tree shaking into this package. Written for humans and AI agents. Read it fully before changing any file listed in [File map](#file-map).

## Ground rules

- **No Expo packages as dependencies.** Upstream code is copied into `src/` as plain CommonJS JavaScript (no TypeScript, no build step).
- **Every copied file has a header** naming its upstream file, the SDK it was copied from, and what was changed. Keep it accurate when syncing.
- **Scope is tree shaking only**, for production (`dev: false`) bundles. Don't port web features, CSS, React Server Components, chunk splitting, environment variables or Hermes bytecode.
- **Keep [local deviations](#local-deviations-keep-these) when syncing.** Don't overwrite a file with a fresh upstream copy.

## Upstream baseline

Update this table after every sync.

| | Value |
| --- | --- |
| Repository | https://github.com/expo/expo |
| Commit | `3b09fcffe5eb554c2f4b7d815ef260aaf7019af3` (2026-11-05) |
| `@expo/metro-config` | 58.0.17 (SDK 58) |
| `babel-preset-expo` | 58.0.20 (SDK 58) |

## File map

`port`: logic copied 1:1 (TS → JS, ESM → CJS). `adapted`: copied with changes listed in the file header. `mirrors`: our own code that reproduces part of an upstream file; compare by hand.

Upstream paths are relative to `packages/@expo/metro-config/src/` unless they start with `babel-preset-expo/`.

| Local file | Upstream | Mode |
| --- | --- | --- |
| `src/serializer/treeShakeSerializerPlugin.js` | `serializer/treeShakeSerializerPlugin.ts` | adapted |
| `src/serializer/sideEffects.js` | `serializer/sideEffects.ts` | port |
| `src/serializer/sortDependencies.js` | `serializer/reconcileTransformSerializerPlugin.ts` (`sortDependencies` only) | port |
| `src/serializer/reconcileTransformSerializerPlugin.js` | `serializer/reconcileTransformSerializerPlugin.ts` | adapted |
| `src/serializer/jsOutput.js` | `serializer/jsOutput.ts` (`isExpoJsOutput` only) | port |
| `src/serializer/index.js` | `serializer/withExpoSerializers.ts` (processor chain only) | mirrors |
| `src/transform-worker/collect-dependencies.js` | `transform-worker/collect-dependencies.ts` | adapted |
| `src/transform-worker/index.js` | `transform-worker/metro-transform-worker.ts` (optimize path, `collectDependenciesForShaking`, `disabledDependencyTransformer`) | mirrors |
| `src/transform-worker/detect-dynamic-exports.js` | `babel-preset-expo/src/plugins/detect-dynamic-exports.ts` | adapted |
| `src/utils/filePath.js` | `utils/filePath.ts` | port |
| `src/utils/findUpPackageJsonPath.js` | `utils/findUpPackageJsonPath.ts` | port |
| `src/__tests__/tree-shaking.test.js` | `serializer/__tests__/tree-shaking.test.ts` | adapted |
| `src/__tests__/optimize-graph.test.js` | `serializer/__tests__/optimize-graph.test.ts` | adapted |
| `src/__tests__/sideEffects.test.js` | `serializer/__tests__/sideEffects.test.ts` | port |
| `src/__tests__/utils/mini-metro.js` | `serializer/fork/__tests__/mini-metro.ts` | adapted |
| `src/__tests__/utils/serializer-test-utils.js` | `serializer/fork/__tests__/serializer-test-utils.ts` | adapted |

Local only (no upstream counterpart): `src/index.js`, `src/compat.js`, `src/metro.js`, `src/utils/isResolvedDependency.js`, `src/serializer/report.js`, `src/transform-worker/export-namespace-from.js`, `src/transform-worker/babel-transformer.js`, `src/__tests__/report.test.js`, `src/__tests__/self-reference.test.js`, `src/__tests__/side-effects-field.test.js`, `src/__tests__/namespace-exports.test.js`.

## Local deviations (keep these)

These differ from Expo on purpose. Re-apply them if a sync touches the surrounding code.

1. **Enabled by `dev: false`, not `customTransformOptions.optimize`.** Plain `react-native bundle` can't pass custom transform options. See `shouldOptimize()` in `src/transform-worker/index.js`. The serializer sets `serializerOptions.usedExports` itself.
2. **Metro's own import/export plugins.** Reconcile uses `metro-transform-plugins`' `importExportPlugin` and `inlineRequiresPlugin`, and the worker uses Metro's `generateImportNames`. Expo's `transform-plugins/` (live bindings fork) is not ported, so production output follows the same rules as development with `experimentalImportSupport`.
3. **Metro's `inlinePlugin` + `constantFoldingPlugin` run in the worker** before dependencies are collected. Expo does `Platform.OS`/`__DEV__` inlining in `babel-preset-expo` instead.
4. **`hasCjsExports`** comes from `detect-dynamic-exports.js`, passed as an extra plugin to the user's Babel transformer (normally added by `babel-preset-expo`).
5. **Worker output:** the placeholder `code` isn't minified (it's thrown away during reconcile), and the output is always JSON round-tripped so ASTs with Symbols (e.g. React Compiler) survive worker threads and the cache. Expo only does the round-trip when the React Compiler is enabled.
6. **Unreachable modules are pruned** after reconcile (`pruneUnreachableModules` in `src/serializer/index.js`). Expo gets this for free from its chunk serializer, while Metro's `baseJSBundle` emits every module in the graph.
7. **The dev server graph is copied** before shaking (`cloneGraph`). One-shot builds (`sourceUrl == null`) shake in place like Expo.
8. **Self references don't count as usage** (`isUsageOfModuleBinding` in `treeShakeSerializerPlugin.js`). Without it, classes lowered by `@react-native/babel-preset` (default transform profile) and recursive functions are never removed. Covered by `src/__tests__/self-reference.test.js`.
9. **`collect-dependencies.js`**: web worker support (`new Worker(new URL())`, `require.unstable_resolveWorker`) and debug events were removed. Metro has no `'worker'` dependency type.
10. **Original import specifier counts are stored per node** (`originalImportSpecifierCounts` WeakMap in `treeShakeSerializerPlugin.js`). Expo uses `path.opts.originalSpecifiers`, but `path.opts` is shared by all nodes of a Babel traversal, so every import got the first import's count and side-effect imports after a named import were removed. Covered by the "import order" tests in `src/__tests__/side-effects-field.test.js`.
11. **`export * as ns from` is handled** (`babel-preset-expo` rewrites it into `import * as ns` + `export { ns }`, `@react-native/babel-preset` keeps it). `getExportNamesFromPath` in `collect-dependencies.js` records `'*'` for it, and `removeUnusedExports` in `treeShakeSerializerPlugin.js` removes unused namespace specifiers. Covered by `src/__tests__/namespace-exports.test.js`.
12. **Metro 0.84 only: `export * as ns from` is rewritten** into `import * as ns` + `export { ns }` by `src/transform-worker/export-namespace-from.js`, because Metro 0.84's `importExportPlugin` crashes on it (dev builds too). The worker adds the plugin to its own Babel call in production, and wraps the project's Babel transformer (`src/transform-worker/babel-transformer.js`) for everything it delegates to `metro-transform-worker`. Remove both when Metro 0.84 is no longer supported.
13. **Report** (`src/serializer/report.js`): collected after tree shaking and before reconcile (it needs the ASTs and `hasCjsExports`), printed after unreachable modules are pruned. Uses `getPackageJsonSideEffect`, added to `sideEffects.js`. The test harness sets `METRO_TREE_SHAKING_REPORT=0`.
14. **Tests:** inline snapshots are our own, since output differs from Expo's live bindings. Tests for chunk splitting, CSS and React Compiler were removed. The weak-import test lost its "separate chunk" assertions. The harness uses `@react-native/metro-babel-transformer`, the `hermes-stable` profile, `enableBabelRuntime: false`, and restores Jest's `Error.prepareStackTrace` after every bundle (Babel replaces it, which breaks inline snapshot writing).

## Not ported (ignore upstream changes here)

`serializer/chunking/*`, `serializeChunks.ts`, `fork/*` (except test utils), `environmentVariableSerializerPlugin.ts`, `exportHermes.ts`, `hermesArtifacts.ts`, `getCssDeps.ts`, `debugId.ts`, `sourceMap.ts`, `transform-plugins/*`, `transform-worker/{css,css-modules,postcss,sass,asset-transformer,noxcturnal/*}`, `babel-transformer.ts`, the `cache-*` stores, and the rest of `babel-preset-expo`.

Exception: if a change in one of these is needed for tree-shaking correctness (for example, Expo's chunk serializer starts filtering modules differently), reproduce the *effect* in `src/serializer/index.js`.

## Sync procedure

### 1. See what changed upstream

```bash
BASE=3b09fcffe5eb554c2f4b7d815ef260aaf7019af3   # "Commit" from the baseline table
mkdir -p /tmp/expo-sync && cd /tmp/expo-sync && git init -q
git remote add origin https://github.com/expo/expo.git 2>/dev/null
git fetch -q --depth 1 --filter=blob:none origin $BASE
git fetch -q --depth 1 --filter=blob:none origin main && HEAD_SHA=$(git rev-parse FETCH_HEAD)
M=packages/@expo/metro-config/src
git diff $BASE $HEAD_SHA -- \
  $M/serializer/treeShakeSerializerPlugin.ts \
  $M/serializer/reconcileTransformSerializerPlugin.ts \
  $M/serializer/sideEffects.ts \
  $M/serializer/jsOutput.ts \
  $M/serializer/withExpoSerializers.ts \
  $M/transform-worker/collect-dependencies.ts \
  $M/transform-worker/metro-transform-worker.ts \
  $M/utils/filePath.ts \
  $M/utils/findUpPackageJsonPath.ts \
  $M/serializer/__tests__/tree-shaking.test.ts \
  $M/serializer/__tests__/optimize-graph.test.ts \
  $M/serializer/__tests__/sideEffects.test.ts \
  $M/serializer/fork/__tests__/mini-metro.ts \
  $M/serializer/fork/__tests__/serializer-test-utils.ts \
  packages/babel-preset-expo/src/plugins/detect-dynamic-exports.ts
```

Also check whether new files were added to the tree-shaking pipeline: look at the processor list in `withExpoSerializers.ts` and the imports of the files above.

### 2. Apply each hunk

For each hunk, decide using the [File map](#file-map):

- **port / adapted file:** apply the change by hand in JS. Strip types, keep `require`, keep the local deviations.
- **mirrors file:** check whether the change affects the logic we reproduce (the optimize branch of `transformJS`, `transformJSWithBabelFallback`, `collectDependenciesForShaking`, `disabledDependencyTransformer`, the serializer processor order). If it does, reproduce it.
- **New upstream tests:** port the ones that exercise tree shaking. Skip web, CSS, RSC, chunking and React Compiler tests.

To convert a whole TS file to JS (and diff it against ours), strip types with Node's built-in stripper (Node ≥ 22.13, no install). Type-only lines become blank, and `import`/`export` still need converting to `require`/`module.exports` by hand:

```bash
git show $HEAD_SHA:$M/serializer/treeShakeSerializerPlugin.ts > /tmp/expo-sync/file.ts
node -e "process.stdout.write(require('node:module').stripTypeScriptTypes(require('fs').readFileSync(process.argv[1], 'utf8'), { mode: 'transform' }))" /tmp/expo-sync/file.ts > /tmp/expo-sync/file.js
```

### 3. Verify

1. `yarn test`. All suites must pass.
2. **Updated inline snapshots must keep the same modules and exports as Expo's.** Never accept `-u` blindly. For each snapshot that changes, compare against the upstream snapshot: the module list (`},"/app/x.js"`) and exported names (`exports.x =` here, `exports.x =` or `defineProperty(exports, "x"` upstream) must match. Formatting differences (live bindings vs static exports) are expected.
3. **Oldest supported Metro.** Copy the repo to a temp dir, set devDependencies to the oldest supported versions (currently `metro`/`metro-config`/`metro-minify-terser` `0.84.6`, `@react-native/babel-preset` and `@react-native/metro-babel-transformer` `0.86.3`), `yarn install`, then `yarn test --ci`. Expected differences that only come from Metro 0.84's own output: `_$$_REQUIRE` instead of `require`, `,[]);` empty dependency arrays, and statement order in a few `export *` snapshots. Anything else is a bug.
4. **Real Metro build.** Run `Metro.runBuild` with and without `withTreeShaking` on a small app (barrel re-exports, `export *`, a `"sideEffects": false` package, an unused function, an unused class). Check that unused markers are gone, the bundle runs (`vm.runInNewContext`) with the same output as the plain build, and source maps resolve to the same original positions.
5. Update the [baseline table](#upstream-baseline), the `(SDK NN)` in file headers, and this document if the mapping changed.

## Supporting a new Metro / React Native version

The project supports the latest 3 React Native minor versions. Version-specific Metro APIs are isolated in `src/compat.js`.

1. Diff `metro-transform-worker/src/index.js` between the newest supported and the new Metro version. Look at `transformJS`, `minifyCode`, `getBabelTransformArgs`, `transform`'s signature, `getCacheKey`.
2. Check the Metro internals we import: `metro/private/ModuleGraph/worker/{JsFileWrapping,importLocationsPlugin,generateImportNames}`, `metro/private/lib/{CountingSet,bundleToString,metroBabelRuntime}`, `metro/private/DeltaBundler/Serializers/baseJSBundle`, `metro-transform-plugins`, `metro-source-map`, `metro-transform-worker/private/utils/getMinifier`.
3. Put any differences in `compat.js` (feature-detect where possible, as with `usesVlqMaps`).
4. Update `peerDependencies.metro`, the devDependencies, and the README compatibility table. Drop versions that fall out of the "latest 3" window.
5. Run the [verification](#3-verify) steps against both the oldest and newest Metro.
