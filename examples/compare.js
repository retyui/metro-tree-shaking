#!/usr/bin/env node
'use strict';
/**
 * Builds the shared app with every example and compares the production iOS bundles.
 *
 *   node compare.js            build everything, then compare
 *   node compare.js --no-build compare the existing bundles in `<example>/build`
 *
 * Writes the result to RESULTS.md.
 */
const { execSync } = require('child_process');
const { createRequire } = require('module');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const { AnyMap, eachMapping } = createRequire(path.join(root, 'bare/package.json'))(
  '@jridgewell/trace-mapping'
);

const builds = [
  {
    name: 'Metro (bare RN, no tree shaking)',
    dir: 'bare',
    script: 'bundle:ios:baseline',
    bundle: 'build/ios-baseline.bundle',
  },
  { name: 'Metro + metro-tree-shaking', dir: 'bare', script: 'bundle:ios', bundle: 'build/ios.bundle' },
  {
    name: 'rnx-kit (esbuild)',
    dir: 'bare',
    script: 'bundle:ios:rnx-kit',
    bundle: 'build/ios-rnx-kit.bundle',
  },
  {
    name: 'Expo (no tree shaking)',
    dir: 'expo',
    script: 'bundle:ios:baseline',
    bundle: 'build/baseline/_expo/static/js/ios',
  },
  {
    name: 'Expo tree shaking',
    dir: 'expo',
    script: 'bundle:ios',
    bundle: 'build/tree-shaking/_expo/static/js/ios',
  },
  { name: 'Re.Pack (Rspack)', dir: 'repack', script: 'bundle:ios', bundle: 'build/ios.bundle' },
];

/** Packages reported in the table, in this order. */
const PACKAGES = [
  'react-native',
  'react-native-reanimated',
  'react-native-worklets',
  'react-native-svg',
  'lucide-react-native',
  'date-fns',
  'lodash-es',
  'shared (app code)',
];

function collectProbes() {
  const probes = { used: new Set(), unused: new Set() };
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else
        for (const [, kind, name] of fs
          .readFileSync(file, 'utf8')
          .matchAll(/PROBE_(USED|UNUSED)_(\w+)/g))
          probes[kind.toLowerCase()].add(name);
    }
  };
  walk(path.join(root, 'shared'));
  return probes;
}

/** Resolve a bundle path (a directory = Expo's output: the single .hbc/.js file in it). */
function resolveBundle(build) {
  const target = path.join(root, build.dir, build.bundle);
  if (!fs.existsSync(target)) return null;
  if (!fs.statSync(target).isDirectory()) return target;
  const file = fs.readdirSync(target).find((f) => f.endsWith('.js'));
  return file ? path.join(target, file) : null;
}

function findSourceMap(bundleFile) {
  for (const candidate of [`${bundleFile}.map`, bundleFile.replace(/\.js$/, '.js.map')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Expo: `_expo/static/js/ios/index-<hash>.js` + `index-<hash>.js.map` / `.map` in the same dir.
  const dir = path.dirname(bundleFile);
  const map = fs.readdirSync(dir).find((f) => f.endsWith('.map'));
  return map ? path.join(dir, map) : null;
}

function packageOf(source) {
  const posix = source.replace(/\\/g, '/');
  const index = posix.lastIndexOf('node_modules/');
  if (index === -1) return /(^|\/)shared\//.test(posix) ? 'shared (app code)' : 'other';
  const parts = posix.slice(index + 'node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** Bytes and modules per package, attributed through the source map. */
function analyzeSourceMap(code, mapFile) {
  const map = new AnyMap(JSON.parse(fs.readFileSync(mapFile, 'utf8')));
  const lines = code.split('\n');
  const bytes = new Map();
  const modules = new Map();
  let previous = null;
  const flush = (next) => {
    if (previous?.source == null) return;
    const end =
      next && next.generatedLine === previous.generatedLine
        ? next.generatedColumn
        : (lines[previous.generatedLine - 1] ?? '').length;
    const pkg = packageOf(previous.source);
    bytes.set(pkg, (bytes.get(pkg) ?? 0) + Math.max(0, end - previous.generatedColumn));
  };
  const sources = new Set();
  eachMapping(map, (mapping) => {
    flush(mapping);
    previous = mapping;
    if (mapping.source != null) sources.add(mapping.source);
  });
  flush(null);
  for (const source of sources) {
    const pkg = packageOf(source);
    modules.set(pkg, (modules.get(pkg) ?? 0) + 1);
  }
  return { bytes, modules, sources: [...sources] };
}

function kb(bytes) {
  return bytes == null ? '–' : `${(bytes / 1024).toFixed(1)} KB`;
}

function main() {
  const probes = collectProbes();
  const results = [];
  for (const build of builds) {
    if (!process.argv.includes('--no-build')) {
      console.log(`\n▶ ${build.name}: yarn ${build.script} (${build.dir})`);
      execSync(`yarn ${build.script}`, { cwd: path.join(root, build.dir), stdio: 'inherit' });
    }
    const bundleFile = resolveBundle(build);
    if (!bundleFile) {
      console.warn(`No bundle for "${build.name}", skipped.`);
      continue;
    }
    const code = fs.readFileSync(bundleFile, 'utf8');
    const mapFile = findSourceMap(bundleFile);
    const analysis = mapFile ? analyzeSourceMap(code, mapFile) : null;
    results.push({
      build,
      size: Buffer.byteLength(code),
      analysis,
      usedMissing: [...probes.used].filter((p) => !code.includes(`PROBE_USED_${p}`)),
      unusedKept: [...probes.unused].filter((p) => code.includes(`PROBE_UNUSED_${p}`)),
      svgUnusedElements: analysis
        ? ['Rect', 'Polygon'].filter((el) =>
            analysis.sources.some((s) => new RegExp(`react-native-svg/.*/elements/${el}\\.`).test(s))
          )
        : null,
    });
  }

  const header = `| | ${results.map((r) => r.build.name).join(' | ')} |`;
  const divider = `| --- | ${results.map(() => '---:').join(' | ')} |`;
  const row = (label, fn) => `| ${label} | ${results.map(fn).join(' | ')} |`;
  // Bold the cells with the smallest value (ties as displayed are all bold).
  const sizeRow = (label, valueOf, format) => {
    const values = results.map(valueOf);
    const cells = values.map((value, index) => (value == null ? '–' : format(value, results[index])));
    const known = values.filter((value) => value != null);
    const best = known.length ? cells[values.indexOf(Math.min(...known))] : null;
    return `| ${label} | ${cells.map((cell) => (cell === best ? `**${cell}**` : cell)).join(' | ')} |`;
  };
  const md = [
    '# Tree shaking comparison',
    '',
    `Production iOS JavaScript bundles (minified, no Hermes bytecode) of [\`shared/App.js\`](shared/App.js), built ${new Date().toISOString().slice(0, 10)} with \`node compare.js\`.`,
    '',
    '## Bundle',
    '',
    header,
    divider,
    sizeRow('Size', (r) => r.size, kb),
    row('Modules', (r) => (r.analysis ? r.analysis.sources.length : '–')),
    '',
    '## Size per package (bytes attributed through the source map)',
    '',
    header,
    divider,
    ...PACKAGES.map((pkg) =>
      sizeRow(
        `\`${pkg}\``,
        (r) => (r.analysis ? r.analysis.bytes.get(pkg) ?? 0 : null),
        (bytes, r) => `${kb(bytes)} (${r.analysis.modules.get(pkg) ?? 0})`
      )
    ),
    '',
    'The smallest size in each row is bold.',
    '',
    'Number of modules in parentheses.',
    '',
    '## Probes',
    '',
    header,
    divider,
    row('Unused app code kept', (r) =>
      r.unusedKept.length ? r.unusedKept.map((p) => `\`${p}\``).join(', ') : 'none ✅'
    ),
    row('Used app code missing', (r) =>
      r.usedMissing.length ? `❌ ${r.usedMissing.join(', ')}` : 'none ✅'
    ),
    row('Unused svg `Rect`/`Polygon` kept', (r) =>
      r.svgUnusedElements == null ? '–' : r.svgUnusedElements.length ? r.svgUnusedElements.join(', ') : 'none ✅'
    ),
    '',
    `Unused probes: ${[...probes.unused].map((p) => `\`${p}\``).join(', ')}.`,
    '',
  ].join('\n');

  fs.writeFileSync(path.join(root, 'RESULTS.md'), md);
  console.log(`\n${md}`);
}

main();
