'use strict';
/**
 * Not from Expo. Confirms the `package.json#sideEffects` behavior documented in the README
 * ("Tips & limitations"), including the known import-order issue inherited from Expo.
 */
const { serializeShakingAsync } = require('./utils/serializer-test-utils');

jest.mock('../utils/findUpPackageJsonPath', () => ({
  findUpPackageJsonPath: jest.fn(() => null),
}));

/** `sideEffects` value for the `lib` package, `undefined` = no field. */
function libFiles(sideEffects, files = {}) {
  return {
    'node_modules/lib/package.json': JSON.stringify(
      sideEffects === undefined ? { name: 'lib' } : { name: 'lib', sideEffects }
    ),
    'node_modules/lib/used.js': `
export const used = 'USED_VALUE';
export const unusedExport = 'UNUSED_EXPORT';
`,
    'node_modules/lib/named.js': `
console.log('NAMED_MODULE_TOP_LEVEL');
export const neverUsed = 1;
`,
    'node_modules/lib/polyfill.js': `console.log('POLYFILL_TOP_LEVEL');`,
    'node_modules/lib/polyfill2.js': `console.log('POLYFILL2_TOP_LEVEL');`,
    ...files,
  };
}

async function bundle(files) {
  const [, [artifact]] = await serializeShakingAsync(files);
  return artifact.source;
}

describe.each([
  // [field, unused named import module, side-effect import module]
  ['no field', undefined, 'removed', 'kept'],
  ['false', false, 'removed', 'removed'],
  ['true', true, 'kept', 'kept'],
])('sideEffects: %s', (_label, sideEffects, namedImportModule, sideEffectImportModule) => {
  it(`removes unused exports`, async () => {
    const source = await bundle({
      'index.js': `
import { used } from './node_modules/lib/used.js';
console.log(used);
`,
      ...libFiles(sideEffects),
    });
    expect(source).toMatch('USED_VALUE');
    expect(source).not.toMatch('UNUSED_EXPORT');
  });

  it(`${namedImportModule === 'kept' ? 'keeps' : 'removes'} a module imported only for unused names`, async () => {
    const source = await bundle({
      'index.js': `
import { used } from './node_modules/lib/used.js';
import { neverUsed } from './node_modules/lib/named.js';
console.log(used);
`,
      ...libFiles(sideEffects),
    });
    expect(source.includes('NAMED_MODULE_TOP_LEVEL')).toBe(namedImportModule === 'kept');
  });

  it(`${sideEffectImportModule === 'kept' ? 'keeps' : 'removes'} a module imported for its side effects`, async () => {
    // The side-effect import comes first, see the known issue below.
    const source = await bundle({
      'index.js': `
import './node_modules/lib/polyfill.js';
import { used } from './node_modules/lib/used.js';
console.log(used);
`,
      ...libFiles(sideEffects),
    });
    expect(source.includes('POLYFILL_TOP_LEVEL')).toBe(sideEffectImportModule === 'kept');
  });
});

it(`counts a module as having side effects when something it imports is marked \`true\``, async () => {
  const source = await bundle({
    'index.js': `
import { used } from './node_modules/lib/used.js';
import { neverUsed } from './node_modules/lib/named.js';
console.log(used);
`,
    ...libFiles(undefined, {
      'node_modules/lib/named.js': `
import { register } from '../fx/index.js';
console.log('NAMED_MODULE_TOP_LEVEL');
export const neverUsed = register;
`,
    }),
    'node_modules/fx/package.json': JSON.stringify({ name: 'fx', sideEffects: true }),
    'node_modules/fx/index.js': `
console.log('FX_TOP_LEVEL');
export const register = 1;
`,
  });
  expect(source).toMatch('NAMED_MODULE_TOP_LEVEL');
  expect(source).toMatch('FX_TOP_LEVEL');
});

it(`always removes modules without code, even when marked \`true\``, async () => {
  const source = await bundle({
    'index.js': `
import './node_modules/lib/empty.js';
import { used } from './node_modules/lib/used.js';
console.log(used);
`,
    ...libFiles(true, {
      'node_modules/lib/empty.js': `// Only a comment.`,
    }),
  });
  expect(source).toMatch('USED_VALUE');
  expect(source).not.toMatch('/app/node_modules/lib/empty.js');
});

it(`keeps a module that only becomes empty after tree shaking, when marked \`true\``, async () => {
  const source = await bundle({
    'index.js': `
import { used } from './node_modules/lib/used.js';
import { neverUsed } from './node_modules/lib/named.js';
console.log(used);
`,
    ...libFiles(true, {
      'node_modules/lib/named.js': `export const neverUsed = 'EMPTY_AFTER_SHAKING';`,
    }),
  });
  expect(source).not.toMatch('EMPTY_AFTER_SHAKING');
  // The (now empty) module is still bundled and required.
  expect(source).toMatch('/app/node_modules/lib/named.js');
});

describe('known issue: import order (inherited from Expo)', () => {
  // Expo stores the original specifier count in `path.opts`, which Babel shares between all nodes of
  // a traversal, so every import in a file uses the count of the file's first import.
  //
  // `test.failing` passes while the bug exists. Once fixed, it fails: turn it into a normal test and
  // update the README.
  test.failing(`keeps a side-effect import that follows a named import (no field)`, async () => {
    const source = await bundle({
      'index.js': `
import { used } from './node_modules/lib/used.js';
import './node_modules/lib/polyfill.js';
console.log(used);
`,
      ...libFiles(undefined),
    });
    expect(source).toMatch('POLYFILL_TOP_LEVEL');
  });

  it(`keeps all side-effect imports when the file's first import is a side-effect import (workaround)`, async () => {
    const source = await bundle({
      'index.js': `
import './node_modules/lib/polyfill.js';
import { used } from './node_modules/lib/used.js';
import './node_modules/lib/polyfill2.js';
console.log(used);
`,
      ...libFiles(undefined),
    });
    expect(source).toMatch('POLYFILL_TOP_LEVEL');
    expect(source).toMatch('POLYFILL2_TOP_LEVEL');
  });
});
