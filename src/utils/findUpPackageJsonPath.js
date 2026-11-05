'use strict';
/**
 * Copyright © 2024 650 Industries.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Copied from `@expo/metro-config/src/utils/findUpPackageJsonPath.ts` (SDK 58).
 */
const fs = require('fs');
const path = require('path');

function findUpPackageJsonPath(root) {
  for (let dir = root; path.dirname(dir) !== dir; dir = path.dirname(dir)) {
    const file = path.resolve(dir, 'package.json');
    if (fs.existsSync(file)) {
      return file;
    }
  }
  throw new Error(`Cannot find package.json from "${root}"`);
}

module.exports = { findUpPackageJsonPath };
