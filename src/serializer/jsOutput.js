'use strict';
// Copied from `@expo/metro-config/src/serializer/jsOutput.ts` (SDK 58).

function isExpoJsOutput(output) {
  return 'data' in output && typeof output.data === 'object';
}

module.exports = { isExpoJsOutput };
