module.exports = {
  // Keep ES modules, so Rspack can tree-shake them (`babel-swc-loader` keeps `import`/`export`
  // when the CommonJS transform is disabled).
  presets: [['module:@react-native/babel-preset', { disableImportExportTransform: true }]],
  plugins: ['react-native-worklets/plugin'],
};
