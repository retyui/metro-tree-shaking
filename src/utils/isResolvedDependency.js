'use strict';
// Same as `metro/private/lib/isResolvedDependency` (inlined, it's a one-liner).
function isResolvedDependency(dep) {
  return dep.absolutePath != null;
}

module.exports = { isResolvedDependency };
