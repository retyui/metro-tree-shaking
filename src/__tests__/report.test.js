'use strict';
/**
 * Not from Expo. The report printed after tree shaking (`METRO_TREE_SHAKING_REPORT`).
 */
const { serializeShakingAsync } = require('./utils/serializer-test-utils');
const { getReportMode } = require('../serializer/report');

jest.mock('../utils/findUpPackageJsonPath', () => ({
  findUpPackageJsonPath: jest.fn(() => null),
}));

const math = `
export const a = 'A';
export const b = 'B';
`;

const files = {
  'index.js': `
import { a } from './node_modules/esm-lib/index.js';
import { legacy } from './src/legacy.js';
import * as M from './src/math.js';
import { fx } from './node_modules/fx-lib/index.js';
const required = require('./src/required.js');
import('./src/lazy.js');
console.log(a, legacy, M.a, fx, required);
`,
  'node_modules/esm-lib/package.json': JSON.stringify({ name: 'esm-lib', sideEffects: false }),
  'node_modules/esm-lib/index.js': `export const a = 'A'; export const unused = 'U';`,
  'node_modules/fx-lib/package.json': JSON.stringify({ name: 'fx-lib', sideEffects: true }),
  'node_modules/fx-lib/index.js': `export const fx = 'FX';`,
  'src/legacy.js': `module.exports.legacy = 'LEGACY';`,
  'src/math.js': math,
  'src/required.js': math,
  'src/lazy.js': math,
  'expo-mock/async-require': `module.exports = () => 'MOCK'`,
};

let warn;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  process.env.METRO_TREE_SHAKING_REPORT = '0';
});

async function report(mode) {
  process.env.METRO_TREE_SHAKING_REPORT = mode;
  await serializeShakingAsync(files);
  return warn.mock.calls.map((args) => args.join(' ')).join('\n');
}

it(`prints a summary by default`, async () => {
  const output = await report('');
  expect(output).toMatch(/^metro-tree-shaking: \d+ modules could not be fully tree-shaken/);
  expect(output).toMatch('1 CommonJS, exports can not be removed: src/legacy.js');
  expect(output).toMatch(
    '1 "sideEffects": true in package.json, kept whenever imported: fx-lib'
  );
  expect(output).toMatch('1 ES modules used as a namespace, all exports kept: src/math.js');
  expect(output).toMatch('1 ES modules loaded with require(), all exports kept: src/required.js');
  expect(output).toMatch('1 ES modules loaded with import(), all exports kept: src/lazy.js');
  expect(output).toMatch('Set METRO_TREE_SHAKING_REPORT=1 for details');
  // Fully tree-shaken modules aren't reported.
  expect(output).not.toMatch('esm-lib');
});

it(`prints every file with METRO_TREE_SHAKING_REPORT=1`, async () => {
  const output = await report('1');
  expect(output).toMatch('    src/math.js  (import * as, by index.js)');
  expect(output).toMatch('    src/required.js  (by index.js)');
  expect(output).toMatch('    src/lazy.js  (by index.js)');
  expect(output).toMatch(/ {4}fx-lib \(1 module\)\n {6}fx-lib\/index\.js/);
  expect(output).not.toMatch('Set METRO_TREE_SHAKING_REPORT=1');
});

it(`prints nothing with METRO_TREE_SHAKING_REPORT=0`, async () => {
  expect(await report('0')).toBe('');
});

it(`prints nothing when everything was tree-shaken`, async () => {
  process.env.METRO_TREE_SHAKING_REPORT = '';
  await serializeShakingAsync({
    'index.js': `import { a } from './math'; console.log(a);`,
    'math.js': math,
  });
  expect(warn).not.toHaveBeenCalled();
});

it(`reports export * from CommonJS as CommonJS and export * as as a namespace`, async () => {
  process.env.METRO_TREE_SHAKING_REPORT = '1';
  await serializeShakingAsync({
    'index.js': `import { a, ns } from './barrel'; console.log(a, ns);`,
    'barrel.js': `export * from './cjs'; export * as ns from './math';`,
    'cjs.js': `exports.a = 'A';`,
    'math.js': math,
  });
  const output = warn.mock.calls.flat().join('\n');
  expect(output).toMatch(/CommonJS, exports can not be removed \(1\):\n {4}cjs\.js/);
  expect(output).toMatch('    math.js  (export * as, by barrel.js)');
});

it.each([
  [undefined, 'summary'],
  ['', 'summary'],
  ['1', 'detailed'],
  ['true', 'detailed'],
  ['0', 'off'],
  ['false', 'off'],
])(`METRO_TREE_SHAKING_REPORT=%s is %s`, (value, mode) => {
  expect(getReportMode({ METRO_TREE_SHAKING_REPORT: value })).toBe(mode);
});
