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

### typed models

- `TimeDuration`: Structured representation of an srk time duration with JSON marshal/unmarshal support.
- `RanklistRow`: Structured row model for Go callers that prefer typed values.
- `RanklistRowToMap`: Convert one typed row into the map shape accepted by ranklist helpers.
- `RanklistRowsToMaps`: Convert typed rows into the map shape accepted by ranklist helpers.
