# standard-ranklist-utils

Utilities for standard ranklist.

## Usage

Make sure you have installed the `@algoux/standard-ranklist` package, then install this package:

```shell
npm i -S @algoux/standard-ranklist-utils
```

## CLI

After installation, run a comprehensive diagnostics report for an srk JSON file:

```shell
srk-diagnose ./ranklist.json
```

Use JSON output to receive the raw `diagnoseRanklist()` result object:

```shell
srk-diagnose ./ranklist.json --format json
# or
srk-diagnose ./ranklist.json --json
```

The friendly report uses colored status labels for diagnostic meaning; JSON output keeps the raw boolean fields unchanged.

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

### diagnostics

- `checkProblemStatistics`: Compare declared problem statistics with values computed from row solutions.
- `checkSeriesConfiguration`: Summarize ICPC series configuration and report missing or empty ICPC segment allocation.
- `checkFB`: Compute and validate FB declarations, including computed/declared multi-FB states; `shouldOverride` is reserved for FB result changes rather than time-only mismatches.
- `checkRanklistDataValidity`: Check row/status/score/statistics consistency, structural validity, marker references, row order, and possible ICPC score time precision configs.
- `analyzeRanklistMetadata`: Inspect derived metadata such as true submission precision, FB availability, colors, and rich user data.
- `diagnoseRanklist`: Run the full diagnostics suite and return a complete report.
