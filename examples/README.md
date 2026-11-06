# Examples

The same app ([`shared/App.js`](shared/App.js)) built three ways, to compare tree shaking:

| Example | Bundler | Tree shaking |
| --- | --- | --- |
| [`bare/`](bare) | Metro (React Native 0.88 CLI) | `withTreeShaking` from this repo (linked, so it runs the repo's `src/`) |
| [`bare/`](bare) with `RNX_KIT=1` | Metro + esbuild | rnx-kit's ([`@rnx-kit/metro-serializer-esbuild`](https://github.com/microsoft/rnx-kit/tree/main/packages/metro-serializer-esbuild)) |
| [`expo/`](expo) | Metro (Expo SDK 58) | Expo's own (`EXPO_UNSTABLE_TREE_SHAKING=1`) |
| [`repack/`](repack) | Rspack (Re.Pack 5) | Rspack's |

All three use React Native 0.88.1 and the same libraries: `react-native-reanimated`, `react-native-worklets`, `react-native-svg`, `lucide-react-native`, `date-fns`, `lodash-es`.

## The app

[`shared/`](shared) imports libraries and a local barrel the way apps usually do:

```js
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { Heart, Star } from 'lucide-react-native';
import { format } from 'date-fns';
import { debounce } from 'lodash-es';
import { Badge, PRIMARY, formatPrice } from './ui';
```

[`shared/ui/index.js`](shared/ui/index.js) re-exports with `export *`, `export { … } from` and `export * as`. Unused exports contain a `PROBE_UNUSED_*` string, used ones a `PROBE_USED_*` string, so the bundles can be checked for what survived. `UnusedCard` is never used and is the only code using svg's `Rect` and `Polygon`.

## Compare

```bash
cd .. && yarn install            # this repo, used by bare/ through `link:../..`
cd examples/bare && yarn install && cd ../expo && yarn install && cd ../repack && yarn install && cd ..
node compare.js                  # builds every variant (caches reset), writes RESULTS.md
node compare.js --no-build       # only compares the existing bundles
```

Each example can also be built on its own: `yarn bundle:ios` (and `yarn bundle:ios:baseline` in `bare/` and `expo/` for a build without tree shaking, `yarn bundle:ios:rnx-kit` in `bare/` for rnx-kit).

rnx-kit's build in `bare/` needs one extra Babel plugin: React Native 0.88's preset strips Flow `export enum` declarations (such as `VirtualViewMode` in `react-native/src/private/components/virtualview/VirtualView.js`) instead of converting them, and esbuild then fails on the import with no matching export. Metro's own output hides this (the import is just `undefined`). With `RNX_KIT=1`, [`bare/babel.config.js`](bare/babel.config.js) runs `babel-plugin-transform-flow-enums` before the preset. Bundles go to `<example>/build/`.

## Entry points

[`entries/`](entries) holds one tiny entry file per way of importing a library, for example:

```js
// entries/react-native-svg/named.js
import '../runtime';
import { Path } from 'react-native-svg';
global._Path = Path;

// entries/react-native-svg/direct-import.js
import '../runtime';
import Path from 'react-native-svg/src/elements/Path.tsx';
global._Path = Path;
```

Styles: `named`, `default`, `namespace` (`import * as`), `direct-import` (a file inside the package) and, for lucide, `icons-subpath`. Every entry first imports [`entries/runtime.js`](entries/runtime.js), which loads React Native and its startup code as every app does (Re.Pack always adds the startup code, Metro only when something imports it). `entries/empty.js` imports only that, and gives the size of React Native alone.

```bash
node bench-entries.js            # bundles every entry with every bundler, plus Hermes bytecode
node bench-entries.js --no-build # only compares the existing bundles
```

Each entry is bundled on its own by Metro (with and without metro-tree-shaking), rnx-kit, Expo (with and without tree shaking, via `expo export:embed`) and Re.Pack, then compiled with the same `hermesc -O`. [ENTRIES.md](ENTRIES.md) shows how much each import adds on top of the empty entry, for JavaScript and for Hermes bytecode. Bundles and build logs go to `<example>/build/entries/`.

## Results

See [RESULTS.md](RESULTS.md) for the full tables. Production iOS JavaScript bundles, minified, without Hermes bytecode:

| | Metro, no tree shaking | Metro + metro-tree-shaking | rnx-kit (esbuild) | Expo, no tree shaking | Expo tree shaking | Re.Pack (Rspack) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Size | 4243 KB | 1349 KB | 1246 KB | 4334 KB | 1582 KB | **1149 KB** |
| `lucide-react-native` | 727 KB | 5.3 KB | 5.3 KB | 1662 KB | 6.9 KB | **4.8 KB** |
| `date-fns` | 140 KB | 22 KB | 22 KB | 162 KB | 25 KB | **19 KB** |
| `lodash-es` | 143 KB | 2.5 KB | 3.1 KB | 243 KB | 3.8 KB | **2.2 KB** |
| `react-native-reanimated` | 644 KB | 356 KB | 313 KB | 625 KB | 378 KB | **292 KB** |
| Unused app code kept | 6 probes | **none** | 2 probes (`export * as analytics`) | 6 probes | **none** | **none** |

The best result in each row is bold.

What explains the differences:

- **metro-tree-shaking vs. Expo:** the same tree shaking logic. The Expo bundle also contains the Expo runtime (`expo`, `expo-modules-core`, `expo-asset`, `expo-constants`, …), which accounts for most of the difference.
- **rnx-kit:** esbuild bundles the modules into one scope (no `__d(…)` wrappers) and follows `ns.x` property reads on `import * as ns`, so it is smaller than metro-tree-shaking for namespace imports and for packages that mark files as side-effectful (reanimated). It keeps the object built by `export * as analytics` though, and its Hermes bytecode is larger than its JavaScript suggests (see [ENTRIES.md](ENTRIES.md)).
- **Re.Pack:** Rspack concatenates modules (scope hoisting) instead of wrapping each module in a `__d(…)` factory, and minifies with SWC, so the same code is smaller.
- **`react-native-svg` isn't shaken by anyone** (111 modules everywhere, unused `Rect`/`Polygon` kept): `lucide-react-native` does `import * as NativeSvg from 'react-native-svg'` and picks components dynamically, so no bundler can tell which ones are unused. Building the bare example with `METRO_TREE_SHAKING_REPORT=1` shows it:

  ```
  ES modules used as a namespace, all exports kept (14):
    react-native-svg (1 module)
      react-native-svg/src/index.ts  (import * as, by lucide-react-native/dist/esm/Icon.mjs)
  ```

- **Plain React Native can't build `export * as ns from` at all**: `@react-native/babel-preset` needs `@babel/plugin-transform-export-namespace-from` for it (added to the baseline build only). With metro-tree-shaking, Metro handles the module syntax and no plugin is needed.
