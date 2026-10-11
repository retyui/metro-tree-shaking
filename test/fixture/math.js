// Only `add` is imported by entry.js; the rest must be tree-shaken away.
export function add(a, b) {
  return a + b;
}

export function unusedMultiply(a, b) {
  console.log('TREE_SHAKING_MARKER: unusedMultiply');
  return a * b;
}

export const UNUSED_CONSTANT = 'TREE_SHAKING_MARKER: UNUSED_CONSTANT';
