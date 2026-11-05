'use strict';
// Copied from `@expo/metro-config/src/utils/filePath.ts` (SDK 58).
const path = require('path');

/** Convert any platform-specific path to a POSIX path. */
function toPosixPath(filePath) {
  return path.sep === '\\' ? filePath.replaceAll('\\', '/') : filePath;
}

module.exports = { toPosixPath };
