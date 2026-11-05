'use strict';
/**
 * Small adapters over Metro internals that changed between the supported Metro versions
 * (0.84 for React Native 0.86, 0.87 for React Native 0.87+).
 */
const { requireFromMetro, requireMetroPrivate, interopDefault } = require('./metro');

const metroSourceMap = requireFromMetro('metro-source-map');
const JsFileWrapping = requireMetroPrivate('ModuleGraph/worker/JsFileWrapping');

/** Metro >= 0.85 stores per-module source maps as a compact `VlqMap` instead of segment tuples. */
const usesVlqMaps = typeof metroSourceMap.vlqMapFromBabelDecodedMap === 'function';

function countLines(code) {
  const NEWLINE = /\r\n?|\n|\u2028|\u2029/g;
  let lineCount = 1;
  let lastLineStart = 0;
  for (const match of code.matchAll(NEWLINE)) {
    lineCount++;
    lastLineStart = match.index + match[0].length;
  }
  return { lineCount, lastLineColumn: code.length - lastLineStart };
}

/** Same as Metro's `countLinesAndTerminateMap` (segment tuple maps). */
function terminateTuples(code, map) {
  const { lineCount, lastLineColumn } = countLines(code);
  const lastMapping = map[map.length - 1];
  const terminatingMapping = [lineCount, lastLineColumn];
  if (
    !lastMapping ||
    lastMapping[0] !== terminatingMapping[0] ||
    lastMapping[1] !== terminatingMapping[1]
  ) {
    return { lineCount, map: map.concat([terminatingMapping]) };
  }
  return { lineCount, map: [...map] };
}

/** Build the module output `{ lineCount, map }` from a `@babel/generator` result. */
function mapFromGeneratorResult(result) {
  const code = result.code;
  if (usesVlqMaps) {
    const { lineCount, lastLineColumn } = countLines(code);
    const map = metroSourceMap.vlqMapFromBabelDecodedMap(
      result.decodedMap ?? { mappings: [], names: [] },
      [lineCount, lastLineColumn]
    );
    return { lineCount, map };
  }
  const tuples = result.rawMappings ? result.rawMappings.map(metroSourceMap.toSegmentTuple) : [];
  return terminateTuples(code, tuples);
}

/** Minify module code, mirroring `minifyCode` from the installed `metro-transform-worker`. */
async function minifyCode(minifyConfig, filename, generatorResult, source, reserved = []) {
  const getMinifier = interopDefault(
    requireFromMetro('metro-transform-worker/private/utils/getMinifier')
  );
  const minify = getMinifier(minifyConfig.minifierPath);

  let inputMap;
  if (usesVlqMaps) {
    inputMap = generatorResult.map;
  } else {
    const tuples = generatorResult.rawMappings
      ? generatorResult.rawMappings.map(metroSourceMap.toSegmentTuple)
      : [];
    inputMap = metroSourceMap
      .fromRawMappings([
        {
          code: generatorResult.code,
          functionMap: null,
          isIgnored: false,
          map: tuples,
          path: filename,
          source,
        },
      ])
      .toMap(undefined, {});
  }

  let minified;
  try {
    minified = await minify({
      code: generatorResult.code,
      config: minifyConfig.minifierConfig,
      filename,
      map: inputMap,
      reserved,
    });
  } catch (error) {
    if (error.constructor.name === 'JS_Parse_Error') {
      throw new Error(`${error.message} in file ${filename} at ${error.line}:${error.col}`);
    }
    throw error;
  }

  const code = minified.code;
  if (usesVlqMaps) {
    let decoded = minified.decodedMap ?? null;
    if (decoded == null && minified.map != null) {
      const { decode } = require('@jridgewell/sourcemap-codec');
      decoded = { mappings: decode(minified.map.mappings), names: minified.map.names };
    }
    const { lineCount, lastLineColumn } = countLines(code);
    const map = metroSourceMap.vlqMapFromBabelDecodedMap(decoded ?? { mappings: [], names: [] }, [
      lineCount,
      lastLineColumn,
    ]);
    return { code, lineCount, map };
  }
  const tuples = minified.map
    ? metroSourceMap.toBabelSegments(minified.map).map(metroSourceMap.toSegmentTuple)
    : [];
  return { code, ...terminateTuples(code, tuples) };
}

/** `JsFileWrapping.wrapModule`. Metro 0.84 has an extra `skipRequireRename` positional argument. */
function wrapModule(ast, importDefault, importAll, dependencyMapName, globalPrefix, opts) {
  const { skipRequireRename = false, unstable_useStaticHermesModuleFactory = false } = opts;
  if (usesVlqMaps) {
    return JsFileWrapping.wrapModule(ast, importDefault, importAll, dependencyMapName, globalPrefix, {
      unstable_useStaticHermesModuleFactory,
    });
  }
  return JsFileWrapping.wrapModule(
    ast,
    importDefault,
    importAll,
    dependencyMapName,
    globalPrefix,
    skipRequireRename,
    { unstable_useStaticHermesModuleFactory }
  );
}

/** Extra babel transformer options only known to newer Metro versions. */
function getBabelRuntimeOptions(config) {
  if (config.enableBabelRuntime !== true) {
    return null;
  }
  let metroBabelRuntime;
  try {
    metroBabelRuntime = requireMetroPrivate('lib/metroBabelRuntime');
  } catch {
    return null;
  }
  return {
    babelRuntimeModuleName: metroBabelRuntime.METRO_BABEL_RUNTIME_MODULE_NAME,
    babelRuntimeVersion: metroBabelRuntime.getMetroBabelRuntimeVersion(),
  };
}

module.exports = {
  usesVlqMaps,
  countLines,
  mapFromGeneratorResult,
  minifyCode,
  wrapModule,
  getBabelRuntimeOptions,
};
