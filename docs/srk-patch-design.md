# SRK Patch Design

## Goal

`patchRanklist(ranklist, patch, options?)` applies a static, JSON-serializable patch object to an SRK ranklist and
returns a new ranklist object. It is designed for two use cases:

- External scripts can build typed, precise patches from supplemental data without hand-mutating nested SRK fields.
- the standalone `srk diagnose` command can emit a reusable patch file from safe repair suggestions, and `srk patch`
  can apply that file.

The first version is JavaScript/TypeScript only. Python and Go APIs are unchanged.

## Patch Object

Patch files use an SRK-aware DSL instead of RFC JSON Patch:

```json
{
  "type": "srk-patch",
  "version": 1,
  "metadata": {
    "source": "external-script"
  },
  "operations": [
    {
      "op": "set",
      "target": { "type": "contest", "path": ["banner"] },
      "value": "https://example.com/banner.png"
    }
  ]
}
```

Operations run sequentially on a deep-cloned ranklist. The input ranklist is never mutated, so callers can chain
multiple `patchRanklist` calls.

## Operations

- `set`: overwrite or create a value at a resolved target.
- `merge`: shallow-merge a plain object into a resolved target. It does not recursively deep-merge nested objects.
- `unset`: remove an object property or array element.
- `append`: append an item to an array. If the array field is missing, it is created. `uniqueBy` can point to a field
  inside the appended item and existing items to avoid duplicates.

Each operation can set `optional: true`. Required operations throw on missing or incompatible targets. Optional
operations skip target-resolution errors.

## Targets

Targets are SRK-aware and may include a path relative to the selected object:

- `ranklist`: root ranklist object.
- `contest`: `ranklist.contest`.
- `problem`: locate by `problemIndex`, `problemAlias`, or both.
- `row`: locate by `rowIndex`, `userId`, or both.
- `status`: locate by row plus problem.
- `solution`: locate by row plus problem plus `solutionIndex`.
- `sorter`: `ranklist.sorter`, with optional `path` for nested sorter fields.

When both index and semantic ID are provided, both must resolve to the same object. This lets generated patches fail
loudly if applied to a ranklist whose row or problem order no longer matches the source diagnostics.

`path` accepts either an array such as `["config", "noPenaltyResults"]` or a dot string such as
`"config.noPenaltyResults"`. To patch sorter config, use the `sorter` target:

```json
{
  "op": "set",
  "target": { "type": "sorter", "path": "config.noPenaltyResults" },
  "value": ["FB", "AC", "?", null]
}
```

For whole-config updates, use `path: "config"` with `merge`, or omit `path` and merge into the sorter object itself.

## Conditions

Operations may include `when`, either a single condition or an array of conditions. Conditions are ANDed.

Supported predicates:

- `exists`
- `missing`
- `equals`
- `in`

Condition targets default to the operation target when omitted. Failed conditions skip the operation.

## CLI Integration

The standalone `@algoux/standard-ranklist-cli` package owns command-line parsing and file IO. Its `srk patch` command
applies a patch file:

```shell
srk patch ranklist.json patch.json
srk patch -o fixed.json ranklist.json patch.json
srk patch --in-place ranklist.json patch.json
```

The default writes patched JSON to stdout. `-o` writes to a separate file. `--in-place` overwrites the input ranklist
file and is mutually exclusive with `-o`.

`srk diagnose` can also emit a patch file while preserving normal diagnostic output:

```shell
srk diagnose --patch patch.json ranklist.json
srk diagnose -p patch.json ranklist.json
srk patch -o fixed.json ranklist.json patch.json
```

## Diagnostic Patch Policy

Diagnostic patch generation uses a conservative safe-first policy:

- All first-blood suggestions are emitted.
- Existing `FB` declarations for the same problem are changed to `AC`.
- The suggested status is changed to `FB`.
- When detailed `solutions[]` exists, existing `FB` solution results for the same problem are changed to `AC`, and the
  matching accepted solution for the suggested row/problem/time is changed to `FB`.
- Sorter suggestions are alternatives, so only the first ranked sorter suggestion is emitted as a shallow merge into the
  `sorter` target with `path: "config"`.
- Problem-statistics suggestions are emitted as `set` operations on the `problem` target with `path: "statistics"` and
  the sorter-aware expected statistics as the value.

The generated patch metadata records `source: "standard-ranklist-utils"` plus the first-blood and sorter suggestion
details used to build the operations.
