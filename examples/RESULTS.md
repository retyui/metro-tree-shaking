# Tree shaking comparison

Production iOS JavaScript bundles (minified, no Hermes bytecode) of [`shared/App.js`](shared/App.js), built 2026-11-06 with `node compare.js`.

## Bundle

| | Metro (bare RN, no tree shaking) | Metro + metro-tree-shaking | rnx-kit (esbuild) | Expo (no tree shaking) | Expo tree shaking | Re.Pack (Rspack) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Size | 4242.9 KB | 1349.1 KB | 1246.0 KB | 4333.7 KB | 1581.7 KB | **1149.4 KB** |
| Modules | 3934 | 921 | 941 | 4056 | 984 | 891 |

## Size per package (bytes attributed through the source map)

| | Metro (bare RN, no tree shaking) | Metro + metro-tree-shaking | rnx-kit (esbuild) | Expo (no tree shaking) | Expo tree shaking | Re.Pack (Rspack) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `react-native` | 666.1 KB (449) | 561.6 KB (427) | 582.3 KB (452) | 593.8 KB (462) | 575.9 KB (435) | **508.4 KB (436)** |
| `react-native-reanimated` | 644.2 KB (266) | 355.7 KB (190) | 313.2 KB (182) | 625.0 KB (270) | 377.8 KB (190) | **292.0 KB (145)** |
| `react-native-worklets` | 99.1 KB (49) | 89.1 KB (50) | 84.9 KB (48) | 96.7 KB (52) | 91.0 KB (50) | **70.9 KB (43)** |
| `react-native-svg` | 117.2 KB (111) | 104.8 KB (111) | 109.3 KB (112) | 107.3 KB (111) | 119.1 KB (111) | **71.3 KB (106)** |
| `lucide-react-native` | 726.9 KB (2039) | 5.3 KB (17) | 5.3 KB (17) | 1662.2 KB (2039) | 6.9 KB (17) | **4.8 KB (16)** |
| `date-fns` | 140.2 KB (303) | 22.3 KB (37) | 22.4 KB (38) | 161.7 KB (304) | 24.7 KB (37) | **18.9 KB (36)** |
| `lodash-es` | 142.9 KB (640) | 2.5 KB (15) | 3.1 KB (15) | 243.0 KB (640) | 3.8 KB (15) | **2.2 KB (14)** |
| `shared (app code)` | 3.7 KB (6) | 1.5 KB (5) | 1.7 KB (6) | 3.1 KB (6) | 1.7 KB (5) | **1.1 KB (4)** |

The smallest size in each row is bold.

Number of modules in parentheses.

## Probes

| | Metro (bare RN, no tree shaking) | Metro + metro-tree-shaking | rnx-kit (esbuild) | Expo (no tree shaking) | Expo tree shaking | Re.Pack (Rspack) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Unused app code kept | `analytics_track`, `analytics_identify`, `UNUSED_PALETTE`, `UnusedCard`, `parsePrice`, `CURRENCIES` | none ✅ | `analytics_track`, `analytics_identify` | `analytics_track`, `analytics_identify`, `UNUSED_PALETTE`, `UnusedCard`, `parsePrice`, `CURRENCIES` | none ✅ | none ✅ |
| Used app code missing | none ✅ | none ✅ | none ✅ | none ✅ | none ✅ | none ✅ |
| Unused svg `Rect`/`Polygon` kept | Rect, Polygon | Rect, Polygon | Rect, Polygon | Rect, Polygon | Rect, Polygon | Rect, Polygon |

Unused probes: `analytics_track`, `analytics_identify`, `UNUSED_PALETTE`, `UnusedCard`, `parsePrice`, `CURRENCIES`.
