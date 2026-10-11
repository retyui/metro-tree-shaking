const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Metro = require('metro');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withTreeShaking } = require('metro-tree-shaking');

const projectRoot = path.join(__dirname, 'fixture');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-tree-shaking-'));

async function bundle({ dev }) {
  const config = withTreeShaking(
    mergeConfig(getDefaultConfig(projectRoot), {
      watchFolders: [path.join(__dirname, '..')],
      resetCache: true,
      reporter: { update() {} },
    }),
  );
  const out = path.join(outDir, `bundle-${dev ? 'dev' : 'prod'}.js`);
  await Metro.runBuild(await Metro.loadConfig({}, config), {
    entry: './entry.js',
    platform: 'android',
    dev,
    minify: !dev,
    out,
    sourceMap: true,
  });
  return {
    code: fs.readFileSync(out, 'utf8'),
    sources: JSON.parse(fs.readFileSync(out.replace(/\.js$/, '.map'), 'utf8'))
      .sources,
  };
}

function run(code) {
  const context = vm.createContext({ console });
  context.global = context.globalThis = context;
  vm.runInContext(code, context);
  return { ...context.__result };
}

const EXPECTED = { add: 5, get: 'it works', greet: 'hello cjs' };

const lodashModules = sources =>
  sources.filter(s => s.includes('/lodash-es/')).length;

test('production bundle is tree-shaken and still works', async () => {
  const { code, sources } = await bundle({ dev: false });

  assert.doesNotMatch(code, /TREE_SHAKING_MARKER/);
  assert.doesNotMatch(code, /DEV_ONLY_MARKER/);
  assert.ok(
    lodashModules(sources) < 100,
    `${lodashModules(sources)} lodash-es modules`,
  );
  assert.deepStrictEqual(run(code), EXPECTED);
});

test('development bundle is not tree-shaken and still works', async () => {
  const { code, sources } = await bundle({ dev: true });

  assert.match(code, /TREE_SHAKING_MARKER/);
  assert.match(code, /DEV_ONLY_MARKER/);
  assert.ok(lodashModules(sources) > 600);
  assert.deepStrictEqual(run(code), EXPECTED);
});
