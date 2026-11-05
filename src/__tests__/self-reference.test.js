'use strict';
/**
 * Not from Expo. Exports referenced only from inside their own declaration (recursive functions) or
 * through a shadowing local binding (classes compiled to functions by `@react-native/babel-preset`
 * with the `default` transform profile) must be removable.
 *
 * Kept in a separate file: Babel caches the preset per transform profile within a process.
 */
const { serializeShakingAsync } = require('./utils/serializer-test-utils');

jest.mock('../utils/findUpPackageJsonPath', () => ({
  findUpPackageJsonPath: jest.fn(() => null),
}));
describe('self-referencing exports', () => {
  it(`removes unused classes compiled to functions (default transform profile)`, async () => {
    const [, [artifact]] = await serializeShakingAsync(
      {
        'index.js': `
import { gravity } from "./b";
console.log('keep', gravity);
`,
        'b.js': `
export const gravity = 7;
export class UnusedMath {
  add() { console.log("UNUSED_ADD"); }
}
`,
      },
      { hermes: false }
    );
    // The class was compiled to a function (Babel helpers are still there).
    expect(artifact.source).toMatch('_classCallCheck');
    expect(artifact.source).toMatch('gravity');
    expect(artifact.source).not.toMatch('UnusedMath');
    expect(artifact.source).not.toMatch('UNUSED_ADD');
  });

  it(`keeps used classes compiled to functions (default transform profile)`, async () => {
    const [, [artifact]] = await serializeShakingAsync(
      {
        'index.js': `
import { UsedMath } from "./b";
console.log('keep', new UsedMath().add());
`,
        'b.js': `
export class UsedMath {
  add() { return "USED_ADD"; }
}
`,
      },
      { hermes: false }
    );
    expect(artifact.source).toMatch('_classCallCheck(this, UsedMath)');
    expect(artifact.source).toMatch('USED_ADD');
  });

  it(`keeps classes used by another export`, async () => {
    const [, [artifact]] = await serializeShakingAsync(
      {
        'index.js': `
import { create } from "./b";
console.log('keep', create());
`,
        'b.js': `
export class Helper {
  run() { return "HELPER_RUN"; }
}
export function create() { return new Helper(); }
`,
      },
      { hermes: false }
    );
    expect(artifact.source).toMatch('HELPER_RUN');
    expect(artifact.source).toMatch('create');
  });

  it(`removes unused recursive functions`, async () => {
    const [, [artifact]] = await serializeShakingAsync({
      'index.js': `
import { used } from "./b";
console.log('keep', used(3));
`,
      'b.js': `
export function used(n) { return n <= 0 ? 0 : used(n - 1); }
export function unusedFactorial(n) { return n <= 1 ? 1 : n * unusedFactorial(n - 1); }
`,
    });
    expect(artifact.source).toMatch('used(n - 1)');
    expect(artifact.source).not.toMatch('unusedFactorial');
  });
});
