# srkutils

Go utilities for Standard Ranklist (srk).

Supported srk versions: `>=0.3.0 <0.4.0`.

## Install

```shell
go get github.com/algoux/standard-ranklist-utils/go
```

## Usage Sample

```go
package main

import srkutils "github.com/algoux/standard-ranklist-utils/go"

func main() {
	_ = srkutils.FormatTimeDuration([]any{1.5, "h"}, "min", nil)
	_ = srkutils.ResolveText(map[string]any{"fallback": "English", "zh-CN": "中文"}, []string{"zh-CN"})
	_ = srkutils.SortRows(srkutils.RanklistRowsToMaps([]srkutils.RanklistRow{}), nil)
	_ = srkutils.DiagnoseRanklist(map[string]any{}, nil)
	_ = srkutils.PatchRanklist(map[string]any{}, srkutils.RanklistPatch{Type: "srk-patch", Version: 1, Operations: []srkutils.RanklistPatchOperation{}}, nil)
}
```

The map-based helpers mirror srk JSON closely. When using exported Go structs such as `RanklistRow`, convert them with
`RanklistRowToMap` or `RanklistRowsToMaps` before passing them to ranklist helpers.

## Utilities

### formatters

- `FormatTimeDuration`: Convert an srk `TimeDuration` between `ms`, `s`, `min`, `h`, and `d`.
- `FormatTimeDurationChecked`: Convert an srk `TimeDuration` and return an error for invalid values.
- `PreZeroFill`: Left-pad a number with zeroes for fixed-width display.
- `SecToTimeStr`: Format elapsed seconds as a ranklist time string such as `1:02:03` or `1D 1:02:03`.
- `NumberToAlphabet`: Convert a zero-based problem index to an alphabetic alias such as `A`, `Z`, or `AA`.
- `AlphabetToNumber`: Convert an alphabetic problem alias back to a zero-based index.

### resolvers

- `ResolveText`: Resolve plain or i18n srk text using explicit language preferences and fallback text.
- `ResolveContributor`: Parse a contributor string into `name`, optional `email`, and optional `url`.
- `ResolveColor`: Normalize an srk color value to a CSS color string.
- `ResolveThemeColor`: Expand a single color or theme color object into explicit light and dark colors.
- `ResolveStyle`: Resolve text/background style colors and auto-pick readable text color when needed.
- `ResolveUserMarkers`: Resolve a user's marker IDs to marker definitions from the ranklist config.

### ranklist

- `SortRows`: Sort rows by ICPC solved count descending and penalty time ascending, with optional ranking-time precision.
- `RegenerateRanklistBySolutions`: Rebuild rows, scores, sorting, and problem statistics from solution tetrads.
- `RegenerateRowsByIncrementalSolutions`: Apply incremental solution tetrads to existing rows and re-sort them.
- `ConvertToStaticRanklist`: Add precomputed per-series rank values and segment indexes to each row.

### CCPC26 display order

- `GetCCPC26ProblemLayout`: Calculate revealed/hidden original problem indexes from the complete current snapshot;
  returns `nil` without standard ICPC CCPC26 `config.problemRevealAcceptedThreshold` configuration.
- `GetCCPC26RowProblemOrder`: Build one row's original problem-index order from its statuses and a layout.
- `CCPC26ProblemLayout`: Typed layout with `RevealedProblemIndexes` and `HiddenProblemIndexes`; JSON uses the same
  `revealedProblemIndexes` and `hiddenProblemIndexes` arrays as JavaScript/Python.

```go
layout := srkutils.GetCCPC26ProblemLayout(ranklist)
if layout != nil {
    order := srkutils.GetCCPC26RowProblemOrder(statuses, *layout)
    _ = order // Index into the original problems/statuses; inputs are not reordered.
}
```

The caller supplies a complete current ranklist, controls whether CCPC26 mode is active, and disables it at freeze time.
Apply display-only row filters after calculating the layout. Both helpers are pure and keep no reveal history, so replay
can move backwards. Revealed problems form a shared prefix; hidden accepted problems follow by acceptance time, then
attempted problems by latest submission time, then untouched problems. Unknown times sort last within their group and
original indexes break ties. AC and FB both count as accepted; rendering FB anonymously as AC belongs to the renderer.

Thresholds support count OR ratio, official-only selection, `all`/`submitted`/`scored` denominators and
`floor`/`ceil`/`round`. There are no implicit 50/0.2 thresholds. An empty threshold object is valid and reveals nothing.
Numeric/time strings and booleans are not coerced into numbers. Native Go integer/float values, `json.Number`, and
`TimeDuration` are supported. Returned empty arrays are non-nil and encode as `[]`.

### diagnostics and patch

- `DiagnoseRanklist`: Inspect SRK completeness/correctness and return structured issues plus repair suggestions.
- `PatchRanklist`: Apply a pure `srk-patch` object to a deep-copied ranklist.
- `CreateRanklistPatchFromDiagnostics`: Convert diagnostic suggestions into an applicable `srk-patch`.

### typed models

- `TimeDuration`: Structured representation of an srk time duration with JSON marshal/unmarshal support.
- `RanklistRow`: Structured row model for Go callers that prefer typed values.
- `RanklistRowToMap`: Convert one typed row into the map shape accepted by ranklist helpers.
- `RanklistRowsToMaps`: Convert typed rows into the map shape accepted by ranklist helpers.
