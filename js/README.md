# @algoux/standard-ranklist-utils

JavaScript and TypeScript utilities for Standard Ranklist (srk).

Supported srk versions: `>=0.3.0 <0.4.0`.

## Install

```shell
npm i -S @algoux/standard-ranklist @algoux/standard-ranklist-utils
```

## Usage Sample

```ts
import {
  diagnoseRanklist,
  formatTimeDuration,
  patchRanklist,
  resolveText,
  sortRows,
} from '@algoux/standard-ranklist-utils';

formatTimeDuration([1.5, 'h'], 'min'); // 90
resolveText({ fallback: 'English', 'zh-CN': '中文' }, ['zh-CN']); // 中文
sortRows(ranklist.rows, ranklist.sorter?.config);
diagnoseRanklist(ranklist); // structured diagnostics for srk completeness/correctness
patchRanklist(ranklist, {
  type: 'srk-patch',
  version: 1,
  operations: [
    { op: 'set', target: { type: 'contest', path: ['banner'] }, value: 'https://example.com/banner.png' },
    { op: 'set', target: { type: 'sorter', path: 'config.noPenaltyResults' }, value: ['FB', 'AC', '?', null] },
  ],
}); // returns a patched copy without mutating ranklist
```

## CLI

This package provides structured JavaScript and TypeScript APIs. Command-line usage is owned by the standalone
`@algoux/standard-ranklist-cli` package, which exposes the `srk` command.

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

### ccpc26

- `getCCPC26ProblemLayout`: Calculate revealed/hidden problem indexes from the complete current ranklist snapshot and the
  standard `sorter.config.extendedAlgorithms` CCPC26 configuration; return `undefined` when that configuration is absent.
- `getCCPC26RowProblemOrder`: Return a row's display indexes, keeping the shared revealed prefix and ordering hidden
  problems by accepted time, latest submission time, then unsubmitted problem order.
- `CCPC26ProblemLayout`: The exported `{ revealedProblemIndexes: number[], hiddenProblemIndexes: number[] }` type.

```ts
const layout = getCCPC26ProblemLayout(ranklist);
const problemIndexes = layout && getCCPC26RowProblemOrder(ranklist.rows[0].statuses, layout);
```

Compute the layout before applying display filters. Both helpers preserve input objects and original problem indexes;
callers decide whether CCPC26 display is enabled and when the contest reaches its freeze. Threshold conditions are ORed,
with `floor`, `all`, and `includeOfficialOnly: false` as defaults. No count or ratio default is added, and zero thresholds
are applied literally. A submitted team includes teams with only no-penalty submissions such as CE.

Accepted ordering prefers `status.time`, falling back to the earliest AC/FB in solution history. Other attempted problems
use the latest detailed submission time, or `status.time` when history is absent. Missing/invalid times sort after known
times in the same group; equal times and unsubmitted problems use original index order. Full solution histories are needed
for exact latest-submission ordering.

### diagnostics

- `diagnoseRanklist`: Return a machine-friendly diagnostics object with precision summary, completeness checks, correctness checks, repair suggestions, and a flat `issues[]` index.

### patch

- `patchRanklist`: Apply an SRK patch object and return a new ranklist without mutating the input.
- `createRanklistPatchFromDiagnostics`: Convert safe diagnostic suggestions into a reusable SRK patch object.
