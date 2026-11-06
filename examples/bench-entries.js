#!/usr/bin/env node
'use strict';
/**
 * Bundles every entry point in `entries/` with every bundler, compiles each bundle to Hermes
 * bytecode, and writes how much each import adds on top of an empty entry to ENTRIES.md.
 *
 *   node bench-entries.js            build everything, then compare
 *   node bench-entries.js --no-build compare the existing bundles in `<example>/build/entries`
 *
 * The three example projects build in parallel; builds inside one project run one at a time.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const entriesDir = path.join(root, 'entries');
const hermesc = path.join(root, 'bare/node_modules/hermes-compiler/hermesc/osx-bin/hermesc');

const variants = [
  {
    key: 'metro',
    name: 'Metro',
    dir: 'bare',
    env: { NO_TREE_SHAKING: '1' },
    command: (entry, out, reset) => [
      'node_modules/.bin/react-native',
      ['bundle', '--platform', 'ios', '--dev', 'false', '--minify', 'true', ...reset],
      ['--entry-file', entry, '--bundle-output', out],
    ],
  },
  {
    key: 'metro-tree-shaking',
    name: 'Metro + metro-tree-shaking',
    dir: 'bare',
    env: { METRO_TREE_SHAKING_REPORT: '0' },
    command: (entry, out, reset) => [
      'node_modules/.bin/react-native',
      ['bundle', '--platform', 'ios', '--dev', 'false', '--minify', 'true', ...reset],
      ['--entry-file', entry, '--bundle-output', out],
    ],
  },
  {
    key: 'rnx-kit',
    name: 'rnx-kit (esbuild)',
    dir: 'bare',
    env: { RNX_KIT: '1' },
    command: (entry, out, reset) => [
      'node_modules/.bin/react-native',
      ['bundle', '--platform', 'ios', '--dev', 'false', '--minify', 'true', ...reset],
      ['--entry-file', entry, '--bundle-output', out],
    ],
  },
  {
    key: 'expo',
    name: 'Expo',
    dir: 'expo',
    env: {},
    command: (entry, out, reset) => [
      'node_modules/.bin/expo',
      ['export:embed', '--platform', 'ios', '--dev', 'false', '--minify', 'true', ...reset],
      ['--entry-file', entry, '--bundle-output', out],
    ],
  },
  {
    key: 'expo-tree-shaking',
    name: 'Expo tree shaking',
    dir: 'expo',
    env: { EXPO_UNSTABLE_TREE_SHAKING: '1', EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH: '1' },
    command: (entry, out, reset) => [
      'node_modules/.bin/expo',
      ['export:embed', '--platform', 'ios', '--dev', 'false', '--minify', 'true', ...reset],
      ['--entry-file', entry, '--bundle-output', out],
    ],
  },
  {
    key: 'repack',
    name: 'Re.Pack (Rspack)',
    dir: 'repack',
    env: {},
    command: (entry, out) => [
      'node_modules/.bin/react-native',
      ['bundle', '--platform', 'ios', '--dev', 'false', '--minify', 'true'],
      ['--entry-file', entry, '--bundle-output', out],
    ],
  },
];

/** `entries/empty.js` first, then `entries/<package>/<style>.js`. */
function findEntries() {
  const entries = [{ id: 'empty', pkg: null, style: 'empty', file: path.join(entriesDir, 'empty.js') }];
  for (const pkg of fs.readdirSync(entriesDir).sort()) {
    const dir = path.join(entriesDir, pkg);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.js')) continue;
      const style = file.replace(/\.js$/, '');
      entries.push({ id: `${pkg}__${style}`, pkg, style, file: path.join(dir, file) });
    }
  }
  return entries;
}

function outputPaths(variant, entry) {
  const dir = path.join(root, variant.dir, 'build/entries', variant.key);
  return {
    dir,
    js: path.join(dir, `${entry.id}.js`),
    hbc: path.join(dir, `${entry.id}.hbc`),
    log: path.join(dir, `${entry.id}.log`),
  };
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ code, output }));
  });
}

async function build(variant, entry, reset) {
  const out = outputPaths(variant, entry);
  fs.mkdirSync(out.dir, { recursive: true });
  for (const file of [out.js, out.hbc]) fs.rmSync(file, { force: true });
  const [bin, args, entryArgs] = variant.command(entry.file, out.js, reset ? ['--reset-cache'] : []);
  const cwd = path.join(root, variant.dir);
  const started = Date.now();
  const bundle = await run(path.join(cwd, bin), [...args, ...entryArgs], {
    cwd,
    env: { ...process.env, ...variant.env },
  });
  let log = bundle.output;
  if (bundle.code === 0) {
    const hermes = await run(hermesc, [
      '-emit-binary',
      '-max-diagnostic-width=80',
      '-O',
      '-w',
      '-out',
      out.hbc,
      out.js,
    ]);
    log += `\n--- hermesc (exit ${hermes.code})\n${hermes.output}`;
  }
  fs.writeFileSync(out.log, log);
  const status = bundle.code === 0 ? 'ok' : `FAILED (see ${path.relative(root, out.log)})`;
  console.log(`${variant.key.padEnd(20)} ${entry.id.padEnd(40)} ${status} ${Date.now() - started}ms`);
}

async function buildAll(entries) {
  const byProject = new Map();
  for (const variant of variants) {
    if (!byProject.has(variant.dir)) byProject.set(variant.dir, []);
    byProject.get(variant.dir).push(variant);
  }
  await Promise.all(
    [...byProject.values()].map(async (projectVariants) => {
      for (const variant of projectVariants) {
        // Reset Metro's cache when switching variants: the transform differs between them.
        for (const [index, entry] of entries.entries()) await build(variant, entry, index === 0);
      }
    })
  );
}

function size(file) {
  return fs.existsSync(file) ? fs.statSync(file).size : null;
}

function kb(bytes, signed) {
  if (bytes == null) return '✗';
  const value = (bytes / 1024).toFixed(1);
  return signed && bytes >= 0 ? `+${value} KB` : `${value} KB`;
}

/** Bold the cells with the smallest value (ties as displayed are all bold). */
function boldSmallest(cells, values) {
  const known = values.filter((value) => value != null);
  if (!known.length) return cells;
  const best = cells[values.indexOf(Math.min(...known))];
  return cells.map((cell) => (cell === best ? `**${cell}**` : cell));
}

function importLine(entry) {
  const line = fs.readFileSync(entry.file, 'utf8').split('\n').find((l) => l.startsWith('import') && !l.includes('runtime'));
  return line ? `\`${line.replace(/;$/, '')}\`` : '';
}

function table(entries, kind) {
  const sizes = new Map(
    variants.map((variant) => [
      variant.key,
      new Map(entries.map((entry) => [entry.id, size(outputPaths(variant, entry)[kind])])),
    ])
  );
  const rows = [
    `| Entry | Import | ${variants.map((v) => v.name).join(' | ')} |`,
    `| --- | --- | ${variants.map(() => '---:').join(' | ')} |`,
  ];
  let previousPkg;
  for (const entry of entries) {
    const values = variants.map((variant) => {
      const own = sizes.get(variant.key).get(entry.id);
      if (entry.pkg == null) return own;
      const empty = sizes.get(variant.key).get('empty');
      return own == null || empty == null ? null : own - empty;
    });
    const cells = boldSmallest(values.map((value) => kb(value, entry.pkg != null)), values);
    const label = entry.pkg == null ? '_empty entry (runtime only)_' : `${entry.pkg === previousPkg ? '' : `\`${entry.pkg}\` `}${entry.style}`;
    previousPkg = entry.pkg;
    rows.push(`| ${label} | ${entry.pkg == null ? '' : importLine(entry)} | ${cells.join(' | ')} |`);
  }
  return rows.join('\n');
}

async function main() {
  const entries = findEntries();
  if (!process.argv.includes('--no-build')) await buildAll(entries);

  const markdown = `# Entry point results

Generated by \`node bench-entries.js\`. Each file in [\`entries/\`](entries) is bundled on its own as a
production iOS bundle (\`--dev false --minify true\`) and compiled to Hermes bytecode with the same
\`hermesc\` (\`-O\`). Every entry first imports [\`entries/runtime.js\`](entries/runtime.js) (React Native and its
startup code, which every app ships). The first row is the size of a bundle with only that; every
other cell is how much the import adds on top of it. The smallest size in each row is bold. ✗ means the build failed.

## JavaScript

${table(entries, 'js')}

## Hermes bytecode

${table(entries, 'hbc')}
`;
  fs.writeFileSync(path.join(root, 'ENTRIES.md'), markdown);
  console.log(`\n${markdown}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
