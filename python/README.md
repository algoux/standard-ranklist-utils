# algoux-standard-ranklist-utils

Python utilities for Standard Ranklist (srk).

Supported srk versions: `>=0.3.0 <0.4.0`.

## Install

```shell
pip install algoux-standard-ranklist-utils
```

## Usage Sample

```python
from standard_ranklist_utils import diagnose_ranklist, format_time_duration, patch_ranklist, resolve_text, sort_rows

format_time_duration([1.5, "h"], "min")  # 90
resolve_text({"fallback": "English", "zh-CN": "中文"}, ["zh-CN"])  # 中文
sort_rows(ranklist["rows"], ranklist.get("sorter", {}).get("config"))
diagnostics = diagnose_ranklist(ranklist)
patched = patch_ranklist(ranklist, {"type": "srk-patch", "version": 1, "operations": []})
```

## Utilities

### formatters

- `format_time_duration`: Convert an srk `TimeDuration` between `ms`, `s`, `min`, `h`, and `d`.
- `pre_zero_fill`: Left-pad a number with zeroes for fixed-width display.
- `sec_to_time_str`: Format elapsed seconds as a ranklist time string such as `1:02:03` or `1D 1:02:03`.
- `number_to_alphabet`: Convert a zero-based problem index to an alphabetic alias such as `A`, `Z`, or `AA`.
- `alphabet_to_number`: Convert an alphabetic problem alias back to a zero-based index.

### resolvers

- `resolve_text`: Resolve plain or i18n srk text using explicit language preferences and fallback text.
- `resolve_contributor`: Parse a contributor string into `name`, optional `email`, and optional `url`.
- `resolve_color`: Normalize an srk color value to a CSS color string.
- `resolve_theme_color`: Expand a single color or theme color object into explicit light and dark colors.
- `resolve_style`: Resolve text/background style colors and auto-pick readable text color when needed.
- `resolve_user_markers`: Resolve a user's marker IDs to marker definitions from the ranklist config.

### ranklist

- `sort_rows`: Sort rows by ICPC solved count descending and penalty time ascending, with optional ranking-time precision.
- `regenerate_ranklist_by_solutions`: Rebuild rows, scores, sorting, and problem statistics from solution tetrads.
- `regenerate_rows_by_incremental_solutions`: Apply incremental solution tetrads to existing rows and re-sort them.
- `convert_to_static_ranklist`: Add precomputed per-series rank values and segment indexes to each row.

### diagnostics and patch

- `diagnose_ranklist`: Inspect SRK completeness/correctness and return structured issues plus repair suggestions.
- `patch_ranklist`: Apply a pure `srk-patch` object to a deep-copied ranklist.
- `create_ranklist_patch_from_diagnostics`: Convert diagnostic suggestions into an applicable `srk-patch`.
