'use strict';
/**
 * Copied from `@expo/metro-config/src/serializer/fork/__tests__/mini-metro.ts` (SDK 58).
 * Changes: TS -> JS, uses this package's transform worker with `@react-native/metro-babel-transformer`
 * instead of Expo's, removed Expo-only transform options.
 */
const { getDefaultConfig } = require('metro-config');
const CountingSet = require('metro/private/lib/CountingSet').default;
const path = require('path');
const transformWorker = require('../../transform-worker');

const projectRoot = '/app';
const METRO_CONFIG_DEFAULTS = getDefaultConfig.getDefaultValues(projectRoot);
function toDependencyMap(...deps) {
  const map = new Map();
  for (const dep of deps) {
    map.set(dep.data.data.key ?? ('absolutePath' in dep ? dep.absolutePath : undefined), dep);
  }
  return map;
}
async function microBundle({
  fs,
  entry,
  resolve = (from, id) => {
    const fullFs = {
      ...preModulesFs,
      ...fs,
    };
    for (const index of ['index', '']) {
      for (const ext of ['', '.js', '.ts', '.tsx']) {
        let next = path.join(path.dirname(from), id);
        if (index) {
          next = path.join(next, index);
        }
        next += ext;
        if (fullFs[next] != null) {
          return next;
        }
      }
    }
    for (const mid of [
      'expo-mock/async-require',
      'react-server-dom-webpack/server',
      'react-server-dom-webpack/client',
      'expo-router/rsc/internal',
      'react/compiler-runtime',
    ]) {
      if (id === mid && !fullFs[mid]) {
        fullFs[mid] = `
                module.exports = () => 'MOCK'
            `;
        return mid;
      }
    }

    // Handle node_modules subpath imports like 'react/compiler-runtime'
    if (!id.startsWith('.') && !id.startsWith('/')) {
      const nodeModulePath = 'node_modules/' + id + '.js';
      if (fullFs[nodeModulePath] != null) {
        return nodeModulePath;
      }
      const nodeModuleIndexPath = 'node_modules/' + id + '/index.js';
      if (fullFs[nodeModuleIndexPath] != null) {
        return nodeModuleIndexPath;
      }
    }
    throw new Error(
      `Cannot resolve ${id} from ${from}. Available files: ${Object.keys(fullFs).join(', ')}`,
    );
  },
  options = {},
  preModulesFs = {},
}) {
  const fullFs = {
    'expo-router/rsc/internal': ``,
    'react-server-dom-webpack/server': ``,
    'react-server-dom-webpack/client': ``,
    'react/compiler-runtime': `
    module.exports.c = function c(size) { return new Array(size); };
`,
    'expo-mock/async-require': `
    module.exports = () => 'MOCK'
`,
    ...preModulesFs,
    ...fs,
  };
  if (!entry) {
    entry = Object.keys(fullFs).find((key) => key.match(/(\.\/)?index\.[tj]sx?/));
    if (!entry) {
      throw new Error(
        'No entrypoint found and cannot infer one from the mock fs: ' +
          Object.keys(fullFs).join(', '),
      );
    }
  }
  const absEntry = path.join(projectRoot, entry);
  const dev = options.dev ?? true;
  const transformOptions = {
    minify: options.minify ?? false,
    dev,
    type: 'module',
    // Hermes V1 profile: `@react-native/babel-preset` keeps native classes (like `babel-preset-expo`).
    unstable_transformProfile: options.hermes === false ? 'default' : 'hermes-stable',
    platform: options.platform ?? 'ios',
    inlineRequires: options.inlineRequires ?? false,
    customTransformOptions: {
      __proto__: null,
    },
    // NOTE: This is non-standard but it provides a cleaner output
    experimentalImportSupport: true,
  };
  const modules = new Map();
  const visited = new Set();
  const parsedPreModules = await Promise.all(
    Object.entries(preModulesFs).map(
      async ([id, code]) => await parseModule(id, code, transformOptions),
    ),
  );
  async function recurseWith(queue, parent, onResolve) {
    while (queue.length) {
      const id = queue.shift();
      const absPath = path.join(projectRoot, id);
      // Resolve every edge, even if its target was already visited.
      onResolve?.(absPath);
      if (visited.has(absPath)) {
        const mod = modules.get(absPath);
        if (mod && parent?.path) mod.inverseDependencies.add(parent.path);
        continue;
      }
      visited.add(absPath);
      const code = fullFs[id];
      if (code == null) {
        throw new Error(`File not found: ${id}`);
      }
      const module = await parseModule(id, code, transformOptions);
      modules.set(absPath, module);
      if (parent?.path) {
        module.inverseDependencies.add(parent.path);
      }

      // @ts-ignore
      for (const dep of module.dependencies.values()) {
        if (dep.data.data.contextParams) {
          throw new Error(`mini-metro runner doesn't support require context (yet)`);
        }
        try {
          const resolved = resolve(id, dep.data.name);
          if (
            (dep.data.data.asyncType === 'weak' && !options.legacyTraverseWeakDependencies) ||
            (options.lazy && dep.data.data.asyncType != null)
          ) {
            // @ts-expect-error
            dep.absolutePath = path.join(projectRoot, resolved);
            continue;
          }
          await recurseWith([resolved], module, (fp) => {
            // @ts-expect-error
            dep.absolutePath = fp;
          });
        } catch (error) {
          if (dep.data.data.isOptional) {
            // Skip optional modules that cannot be found.
            continue;
          }
          throw error;
        }
      }
    }
  }
  function moduleExists(id) {
    if (fullFs[id] != null) {
      return id;
    }
    const p = id.replace(/^\/+/, '');
    if (fullFs[p] != null) {
      return p;
    }
    return null;
  }
  const findUpPackageJsonPath = (projectRoot, dir) => {
    if (dir === path.sep || dir.length < projectRoot.length) {
      return null;
    }
    const packageJsonPath = path.relative(projectRoot, path.join(dir, 'package.json'));
    const exists = moduleExists(packageJsonPath);
    if (exists != null) {
      return exists;
    }
    return findUpPackageJsonPath(projectRoot, path.dirname(dir));
  };
  await recurseWith([entry]);
  return [
    // entryPoint: string,
    absEntry,
    // preModules: readonly Module<MixedOutput>[],
    parsedPreModules,
    // graph: ReadOnlyGraph<MixedOutput>,
    {
      dependencies: modules,
      entryPoints: new Set([absEntry]),
      transformOptions,
    },
    // options: SerializerOptions<MixedOutput>
    {
      // @ts-ignore
      serializerOptions:
        options.output ||
        options.hermes ||
        options.sourceMaps ||
        options.splitChunks ||
        options.treeshake
          ? {
              usedExports: options.treeshake,
              output: options.output,
              includeSourceMaps: options.sourceMaps,
              splitChunks: options.splitChunks,
              chunkingStrategy: options.chunkingStrategy,
              // NOTE(cedric): exporting mode should always be provided explicitly, but we can't easily do that in the tests
              exporting: !dev,
            }
          : undefined,
      inlineSourceMap: options.inlineSourceMaps,
      sourceMapUrl: options.sourceMaps
        ? 'https://localhost:8081/indedx.bundle?dev=false'
        : undefined,
      // Metro passes the resolved path.
      asyncRequireModulePath: path.join(projectRoot, 'expo-mock/async-require'),
      sourceUrl: options.sourceUrl,
      createModuleId(filePath) {
        return filePath;
      },
      dev,
      getRunModuleStatement(moduleId) {
        return `TEST_RUN_MODULE(${JSON.stringify(moduleId)});`;
      },
      includeAsyncPaths: options.lazy ?? dev,
      shouldAddToIgnoreList(_module) {
        return false;
      },
      modulesOnly: false,
      processModuleFilter(_module) {
        return true;
      },
      projectRoot,
      runBeforeMainModule: [],
      runModule: true,
      serverRoot: projectRoot,
      // For testing only since we do extra FS work in the serializer
      _test_getPackageJson(dir) {
        const packageJsonPath = findUpPackageJsonPath(projectRoot, dir);
        if (packageJsonPath) {
          return [JSON.parse(fullFs[packageJsonPath]), packageJsonPath];
        }
        return [null, null];
      },
    },
  ];
}
// A small version of the Metro transformer to easily create dependency mocks from a string of code.
async function parseModule(relativeFilePath, code, transformOptions, transformConfig = {}) {
  const absoluteFilePath = path.join(projectRoot, relativeFilePath);
  const codeBuffer = Buffer.from(code);
  const { output, dependencies } = await transformWorker.transform(
    // TODO: Maybe just pull from expo/metro-config to ensure correctness over time.
    {
      ...METRO_CONFIG_DEFAULTS.transformer,
      asyncRequireModulePath: 'expo-mock/async-require',
      unstable_allowRequireContext: true,
      allowOptionalDependencies: true,
      assetPlugins: [],
      babelTransformerPath: require.resolve('@react-native/metro-babel-transformer'),
      // Inline Babel helpers, the mock file system has no `@babel/runtime`.
      enableBabelRuntime: false,
      ...transformConfig,
    },
    projectRoot,
    absoluteFilePath,
    codeBuffer,
    {
      inlineRequires: false,
      ...transformOptions,
      inlinePlatform: true,
    },
  );
  return {
    getSource() {
      return codeBuffer;
    },
    path: absoluteFilePath,
    dependencies: toDependencyMap(
      ...dependencies.map((dep) => ({
        absolutePath: mockAbsolutePath(dep.name),
        data: dep,
      })),
    ),
    inverseDependencies: new CountingSet(),
    output,
  };
}
function mockAbsolutePath(name, fp = name) {
  if (name.match(/^(\.|\/)/)) {
    return path.join(projectRoot, name.replace(/\.[tj]sx?/, '')) + '.js';
  }
  return path.join(projectRoot, 'node_modules', name, 'index.js');
}

module.exports = { projectRoot, microBundle, parseModule };
