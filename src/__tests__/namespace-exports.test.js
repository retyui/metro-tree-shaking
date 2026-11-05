'use strict';
/**
 * Not from Expo. How `import * as`, `export *` and `export * as` affect tree shaking.
 *
 * `export * as ns from` is covered here because Expo never sees it: `babel-preset-expo` turns it
 * into `import * as ns` + `export { ns }`, while `@react-native/babel-preset` keeps it.
 */
const { serializeShakingAsync } = require('./utils/serializer-test-utils');

jest.mock('../utils/findUpPackageJsonPath', () => ({
  findUpPackageJsonPath: jest.fn(() => null),
}));

const math = `
export const a = 'A_USED';
export const b = 'B_UNUSED';
`;

async function bundle(files) {
  const [, [artifact]] = await serializeShakingAsync(files);
  return artifact.source;
}

describe('export * as ns from', () => {
  it(`keeps the exports used through the namespace`, async () => {
    const source = await bundle({
      'index.js': `
import { ns } from './barrel';
console.log(ns.a);
`,
      'barrel.js': `export * as ns from './math';`,
      'math.js': math,
    });
    expect(source).toMatch('A_USED');
  });

  it(`removes the module when the namespace isn't used`, async () => {
    const source = await bundle({
      'index.js': `
import { other } from './barrel';
console.log(other);
`,
      'barrel.js': `
export * as ns from './math';
export const other = 'OTHER';
`,
      'math.js': math,
    });
    expect(source).toMatch('OTHER');
    expect(source).not.toMatch('A_USED');
  });
});

describe('import * as', () => {
  it(`keeps every export of the module when the namespace is used`, async () => {
    // Export-level shaking isn't possible: any property of the namespace may be accessed.
    const source = await bundle({
      'index.js': `
import * as M from './math';
console.log(M.a);
`,
      'math.js': math,
    });
    expect(source).toMatch('A_USED');
    expect(source).toMatch('B_UNUSED');
  });

  it(`removes the module when the namespace isn't used`, async () => {
    const source = await bundle({
      'index.js': `
import * as M from './math';
console.log('x');
`,
      'math.js': math,
    });
    expect(source).not.toMatch('/app/math.js');
  });
});

describe('export * from', () => {
  it(`removes unused exports of an ES module`, async () => {
    const source = await bundle({
      'index.js': `
import { a } from './barrel';
console.log(a);
`,
      'barrel.js': `export * from './math';`,
      'math.js': math,
    });
    expect(source).toMatch('A_USED');
    expect(source).not.toMatch('B_UNUSED');
  });

  it(`keeps every export of a CommonJS module`, async () => {
    const source = await bundle({
      'index.js': `
import { a } from './barrel';
console.log(a);
`,
      'barrel.js': `export * from './math';`,
      'math.js': `
exports.a = 'A_USED';
exports.b = 'B_UNUSED';
`,
    });
    expect(source).toMatch('A_USED');
    expect(source).toMatch('B_UNUSED');
  });
});

describe('export * as ns from, rewrite for Metro 0.84', () => {
  const { transformSync } = require('@babel/core');
  const { exportNamespaceFromPlugin } = require('../transform-worker/export-namespace-from');
  const rewrite = (code) =>
    transformSync(code, {
      babelrc: false,
      configFile: false,
      plugins: [exportNamespaceFromPlugin],
    }).code;

  it(`turns it into an import and a named export`, () => {
    expect(rewrite(`export * as ns from './math';`)).toMatchInlineSnapshot(`
"import * as _ns from './math';
export { _ns as ns };"
`);
  });

  it(`keeps other exports`, () => {
    expect(
      rewrite(`export * as ns from './math';\nexport { a } from './math';\nexport * from './other';`)
    ).toMatchInlineSnapshot(`
"import * as _ns from './math';
export { _ns as ns };
export { a } from './math';
export * from './other';"
`);
  });
});
