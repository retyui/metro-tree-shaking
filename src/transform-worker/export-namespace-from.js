'use strict';
/**
 * Babel plugin: `export * as ns from 'mod'` -> `import * as _ns from 'mod'; export { _ns as ns };`
 *
 * Metro 0.84's `importExportPlugin` crashes on `export * as ns from` (fixed in Metro 0.85). With
 * `disableImportExportTransform: true`, Babel no longer handles it, so this rewrite is applied on
 * Metro 0.84 only. `babel-preset-expo` performs the same rewrite.
 */
function exportNamespaceFromPlugin({ types: t }) {
  return {
    name: 'metro-tree-shaking-export-namespace-from',
    visitor: {
      ExportNamedDeclaration(path) {
        const { node } = path;
        if (node.source == null || node.exportKind === 'type') {
          return;
        }
        const index = node.specifiers.findIndex((specifier) =>
          t.isExportNamespaceSpecifier(specifier)
        );
        if (index === -1) {
          return;
        }
        const [namespace] = node.specifiers.splice(index, 1);
        const exportedName = t.isIdentifier(namespace.exported)
          ? namespace.exported.name
          : namespace.exported.value;
        const local = path.scope.generateUidIdentifier(exportedName);

        const importDeclaration = t.importDeclaration(
          [t.importNamespaceSpecifier(local)],
          t.cloneNode(node.source)
        );
        // Keep the location so Metro still sees an ESM import at this position.
        importDeclaration.loc = node.loc;
        // Lets the report show the syntax that was written.
        importDeclaration.extra = { metroTreeShakingExportNamespaceFrom: true };
        const exportDeclaration = t.exportNamedDeclaration(null, [
          t.exportSpecifier(t.cloneNode(local), namespace.exported),
        ]);

        path.insertBefore([importDeclaration, exportDeclaration]);
        if (node.specifiers.length === 0) {
          path.remove();
        }
      },
    },
  };
}

module.exports = { exportNamespaceFromPlugin };
