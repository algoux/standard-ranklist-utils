# @algoux/standard-ranklist-utils

JavaScript and TypeScript utilities for Standard Ranklist (srk).

Supported srk versions: `>=0.3.0 <0.4.0`.

## Install

```shell
npm i -S @algoux/standard-ranklist @algoux/standard-ranklist-utils
```

## Usage Sample

```ts
import { formatTimeDuration, resolveText, sortRows } from '@algoux/standard-ranklist-utils';

formatTimeDuration([1.5, 'h'], 'min'); // 90
resolveText({ fallback: 'English', 'zh-CN': '中文' }, ['zh-CN']); // 中文
sortRows(ranklist.rows, ranklist.sorter?.config);
```

## Utilities

### formatters

- `formatTimeDuration`: Convert an srk `TimeDuration` between `ms`, `s`, `min`, `h`, and `d`.
- `preZeroFill`: Left-pad a number with zeroes for fixed-width display.
- `secToTimeStr`: Format elapsed seconds as a ranklist time string such as `1:02:03` or `1D 1:02:03`.
- `numberToAlphabet`: Convert a zero-based problem index to an alphabetic alias such as `A`, `Z`, or `AA`.
- `alphabetToNumber`: Convert an alphabetic problem alias back to a zero-based index.

### resolvers

- `resolveText`: Resolve plain or i18n srk text using browser language preferences and fallback text.
- `resolveContributor`: Parse a contributor string into `name`, optional `email`, and optional `url`.
- `resolveColor`: Normalize an srk color value to a CSS color string.
- `resolveThemeColor`: Expand a single color or theme color object into explicit light and dark colors.
- `resolveStyle`: Resolve text/background style colors and auto-pick readable text color when needed.
- `resolveUserMarkers`: Resolve a user's marker IDs to marker definitions from the ranklist config.

### ranklist

- `canRegenerateRanklist`: Check whether a ranklist version and sorter support ICPC regeneration.
- `getSortedCalculatedRawSolutions`: Extract and sort a submission timeline from ranklist rows.
- `filterSolutionsUntil`: Keep only solutions submitted at or before a given contest time.
- `sortRows`: Sort rows by ICPC solved count descending and penalty time ascending, with optional ranking-time precision.
- `calculateProblemStatistics`: Recalculate accepted/submitted totals for each problem, using full solution histories when present.
- `regenerateRanklistBySolutions`: Rebuild rows, scores, sorting, and problem statistics from solution tetrads.
- `regenerateRowsByIncrementalSolutions`: Apply incremental solution tetrads to existing rows and re-sort them.
- `convertToStaticRanklist`: Add precomputed per-series rank values and segment indexes to each row.
