// `NO_TREE_SHAKING=1` builds the same app without metro-tree-shaking, as a baseline. `RNX_KIT=1`
// (rnx-kit's esbuild tree shaking) also needs ES modules, so it keeps `disableImportExportTransform`.
const treeShaking = !process.env.NO_TREE_SHAKING;

module.exports = {
  presets: [
    ['module:@react-native/babel-preset', treeShaking ? { disableImportExportTransform: true } : {}],
  ],
  plugins: [
    // Without metro-tree-shaking, Babel converts modules to CommonJS and needs this plugin for
    // `export * as ns from` (with it, Metro handles the module syntax).
    ...(treeShaking ? [] : ['@babel/plugin-transform-export-namespace-from']),
    // rnx-kit only: the preset strips Flow `export enum` declarations (e.g. `VirtualViewMode` in
    // react-native/src/private/components/virtualview/VirtualView.js) before converting them, and
    // esbuild rejects the import that is left without a matching export. Converting enums first
    // (plugins run before presets) keeps them.
    ...(process.env.RNX_KIT ? ['babel-plugin-transform-flow-enums'] : []),
    'react-native-worklets/plugin',
  ],
};
