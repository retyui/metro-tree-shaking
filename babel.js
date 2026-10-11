/**
 * Babel preset for tree shaking: `babel-preset-expo` keeps `import`/`export`
 * for Metro and inlines `Platform.OS` / `process.env.NODE_ENV`.
 *
 *   // babel.config.js
 *   module.exports = { presets: ['module:metro-tree-shaking/babel'] };
 */
module.exports = require('babel-preset-expo');
