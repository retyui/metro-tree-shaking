'use strict';
/**
 * Reports modules that couldn't be fully tree-shaken, and why.
 *
 * `METRO_TREE_SHAKING_REPORT`:
 * - unset: short summary
 * - `1` / `true`: every file and package
 * - `0` / `false`: nothing
 */
const path = require('path');

const { isResolvedDependency } = require('../utils/isResolvedDependency');
const { toPosixPath } = require('../utils/filePath');
const { getPackageJsonSideEffect } = require('./sideEffects');

const REASONS = {
  commonjs: 'CommonJS, exports can not be removed',
  'side-effects': '"sideEffects": true in package.json, kept whenever imported',
  namespace: 'ES modules used as a namespace, all exports kept',
  require: 'ES modules loaded with require(), all exports kept',
  'dynamic-import': 'ES modules loaded with import(), all exports kept',
};

/** Importers listed per module in the detailed report. */
const MAX_DETAILS = 3;

/** Packages left out of the report: every app ships them and can't change how they're written. */
const IGNORED_PACKAGES = new Set(['react', 'react-native']);

const NAMESPACE_SYNTAX = {
  ImportDeclaration: 'import * as',
  ExportNamedDeclaration: 'export * as',
  ExportAllDeclaration: 'export * from',
};

function getReportMode(env = process.env) {
  const value = String(env.METRO_TREE_SHAKING_REPORT ?? '').toLowerCase();
  if (value === '0' || value === 'false') return 'off';
  if (value === '1' || value === 'true') return 'detailed';
  return 'summary';
}

function getOptimizedOutput(module) {
  return module?.output.find((output) => output.data?.reconcile != null);
}

/** How `importer` uses all exports of the module imported as `source` (`import * as`, ...). */
function getNamespaceSyntax(importerOutput, source) {
  for (const node of importerOutput.data.ast?.program.body ?? []) {
    if (node.source?.value !== source) continue;
    if (node.extra?.metroTreeShakingExportNamespaceFrom) {
      // `export * as ns from` rewritten for Metro 0.84 (see `export-namespace-from.js`).
      return 'export * as';
    }
    if (
      (node.type === 'ImportDeclaration' &&
        node.specifiers.some((s) => s.type === 'ImportNamespaceSpecifier')) ||
      (node.type === 'ExportNamedDeclaration' &&
        node.specifiers.some((s) => s.type === 'ExportNamespaceSpecifier')) ||
      node.type === 'ExportAllDeclaration'
    ) {
      return NAMESPACE_SYNTAX[node.type];
    }
  }
  return null;
}

/**
 * Collect why modules can't be fully tree-shaken. Must run after tree shaking and before the
 * reconcile step, which drops the ASTs.
 *
 * @returns Map of module path -> Map of reason -> Set of details (e.g. "import * as, by src/a.js").
 */
function collectReport(graph, options) {
  const report = new Map();
  const add = (modulePath, reason, detail) => {
    if (!report.has(modulePath)) report.set(modulePath, new Map());
    const reasons = report.get(modulePath);
    if (!reasons.has(reason)) reasons.set(reason, new Set());
    if (detail) reasons.get(reason).add(detail);
  };

  for (const [modulePath, module] of graph.dependencies) {
    const output = getOptimizedOutput(module);
    // Skip non-JS modules and Metro's async require runtime (added by Metro, not the app).
    if (!output || modulePath === options.asyncRequireModulePath) continue;

    if (output.data.hasCjsExports) {
      add(modulePath, 'commonjs');
    }
    if (getPackageJsonSideEffect(options, modulePath) === true) {
      add(modulePath, 'side-effects');
    }

    for (const dependency of module.dependencies.values()) {
      if (!isResolvedDependency(dependency)) continue;
      const targetOutput = getOptimizedOutput(graph.dependencies.get(dependency.absolutePath));
      // Only ES modules lose tree shaking here, CommonJS is reported on its own.
      if (!targetOutput || targetOutput.data.hasCjsExports) continue;

      const data = dependency.data.data;
      const importer = { modulePath, options };
      if (data.asyncType === 'async' || data.asyncType === 'maybeSync') {
        add(dependency.absolutePath, 'dynamic-import', `by ${displayPath(importer)}`);
      } else if (data.asyncType != null) {
        continue;
      } else if (!data.isESMImport) {
        add(dependency.absolutePath, 'require', `by ${displayPath(importer)}`);
      } else if (data.exportNames?.includes('*')) {
        const syntax = getNamespaceSyntax(output, dependency.data.name) ?? 'namespace';
        add(dependency.absolutePath, 'namespace', `${syntax}, by ${displayPath(importer)}`);
      }
    }
  }
  return report;
}

function displayPath({ modulePath, options }) {
  const posix = toPosixPath(modulePath);
  const index = posix.lastIndexOf('/node_modules/');
  if (index !== -1) {
    return posix.slice(index + '/node_modules/'.length);
  }
  return toPosixPath(path.relative(options.projectRoot ?? process.cwd(), modulePath));
}

function getPackageName(modulePath) {
  const posix = toPosixPath(modulePath);
  const index = posix.lastIndexOf('/node_modules/');
  if (index === -1) return null;
  const parts = posix.slice(index + '/node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** Format the report for the remaining modules of the graph. */
function formatReport(report, graph, options, mode) {
  const byReason = new Map(Object.keys(REASONS).map((reason) => [reason, []]));
  let moduleCount = 0;
  for (const [modulePath, reasons] of report) {
    // Modules removed by tree shaking don't matter.
    if (!graph.dependencies.has(modulePath)) continue;
    if (IGNORED_PACKAGES.has(getPackageName(modulePath))) continue;
    moduleCount++;
    for (const [reason, details] of reasons) {
      byReason.get(reason).push({ modulePath, details: [...details] });
    }
  }
  if (moduleCount === 0) {
    return null;
  }

  const lines = [
    `metro-tree-shaking: ${moduleCount} module${moduleCount === 1 ? '' : 's'} could not be fully tree-shaken`,
  ];
  for (const [reason, entries] of byReason) {
    if (!entries.length) continue;
    // App files are listed one by one, files from node_modules are grouped by package.
    const groups = new Map();
    for (const entry of entries) {
      const name = getPackageName(entry.modulePath) ?? displayPath({ ...entry, options });
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(entry);
    }
    const names = [...groups.keys()].sort((a, b) => groups.get(b).length - groups.get(a).length);

    if (mode === 'summary') {
      const shown = names.slice(0, 3).join(', ');
      const more = names.length > 3 ? `, +${names.length - 3} more` : '';
      lines.push(`  ${entries.length} ${REASONS[reason]}: ${shown}${more}`);
      continue;
    }

    lines.push(`  ${REASONS[reason]} (${entries.length}):`);
    for (const name of names) {
      const group = groups.get(name);
      const isPackage = getPackageName(group[0].modulePath) != null;
      if (isPackage) {
        lines.push(`    ${name} (${group.length} module${group.length === 1 ? '' : 's'})`);
      }
      for (const entry of group) {
        const file = displayPath({ ...entry, options });
        // Shared modules can have many importers, show the first few.
        const shown = entry.details.slice(0, MAX_DETAILS);
        if (entry.details.length > MAX_DETAILS) {
          shown.push(`+${entry.details.length - MAX_DETAILS} more`);
        }
        const details = shown.length ? `  (${shown.join('; ')})` : '';
        lines.push(`${isPackage ? '      ' : '    '}${file}${details}`);
      }
    }
  }
  if (mode === 'summary') {
    lines.push('  Set METRO_TREE_SHAKING_REPORT=1 for details, or 0 to hide this report.');
  }
  return lines.join('\n');
}

module.exports = { getReportMode, collectReport, formatReport };
