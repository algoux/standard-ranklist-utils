# CCPC26 display helpers

## Contract and scope

All three language packages supply two pure helpers for SRK 0.3.14 CCPC26 presentation. `getCCPC26ProblemLayout(ranklist)`
returns the shared revealed/hidden original problem indexes. `getCCPC26RowProblemOrder(statuses, layout)` returns the
complete column order for one row. No ranklist data, scores, status order, solution history, or input arrays are changed.

Only `sorter.algorithm: ICPC` with an `extendedAlgorithms` entry whose `algorithm` is `CCPC26` and whose
`config.problemRevealAcceptedThreshold` is an object is recognized. Absent or legacy flat configuration returns undefined.
An empty standard threshold object is valid and reveals no problems because it supplies no conditions.

The calling application controls activation and freeze timing. These helpers neither inspect a clock nor retain state.
Every call describes the current complete snapshot, including when a replay moves backwards. Compute the layout before
filtering rows for display. Package publication and renderer-specific UI projection remain outside these helpers.

| Language | Visibility | Row order | Layout |
| --- | --- | --- | --- |
| JS | `getCCPC26ProblemLayout(ranklist)` | `getCCPC26RowProblemOrder(statuses, layout)` | `CCPC26ProblemLayout` interface; absent returns `undefined` |
| Python | `get_ccpc26_problem_layout(ranklist)` | `get_ccpc26_row_problem_order(statuses, layout)` | exported `CCPC26ProblemLayout` TypedDict; absent returns `None` |
| Go | `GetCCPC26ProblemLayout(ranklist)` | `GetCCPC26RowProblemOrder(statuses, *layout)` | exported `CCPC26ProblemLayout` struct pointer; absent returns `nil` |

Layout JSON keys are always `revealedProblemIndexes` and `hiddenProblemIndexes`. Python
retains these keys directly; Go exports `RevealedProblemIndexes`/`HiddenProblemIndexes`
with matching JSON tags. Go accepts the repository's map-based SRK representation;
convert typed rows through the existing `RanklistRowsToMaps` helper. Its row-order input
is `[]map[string]any`. Empty returned layouts/orders serialize as arrays, not null.

## Reveal calculation

Each problem counts the current rows whose summary result is AC or FB, once per row. Declared problem statistics are not
used. `includeOfficialOnly` defaults to false; when true it excludes only rows with `user.official === false` from both
accepted counts and the denominator.

The ratio denominator is all eligible rows by default, submitted rows for `submitted`, or positive-score rows for `scored`.
A submitted row has at least one status with nonempty solution history, a non-null summary result, or positive tries.
This includes CE/NOUT/UKE-only histories even when the scoring algorithm leaves the summary result null and tries empty.
The chosen denominator does not additionally filter the accepted numerator.

Reveal uses `accepted >= count` OR `accepted >= round(denominator * ratio)`, considering only supplied finite numeric
thresholds. Rounding defaults to floor and also supports ceil/round. Neither count nor ratio has an implicit default.
Zero thresholds, including a ratio rounded to zero for an empty/small population, are applied literally. Both output
arrays preserve original problem-index order; aliases do not define sort order.

Python and Go intentionally avoid their ordinary rounding defaults: JS resolves half ties
toward positive infinity, and a float immediately below a half must not round up because
of adding 0.5. Finite ratios whose population product overflows preserve the JS infinity
comparison semantics. Numeric thresholds and valid duration values reject booleans,
numeric strings and non-finite numbers; these rules do not change older formatter APIs.

## Per-row order and timestamps

The revealed prefix is copied from the layout. Hidden problems are grouped as accepted, attempted, then unsubmitted.
Accepted means an AC/FB summary; later submissions cannot move an accepted problem into the attempted group. Within the
accepted group, a valid summary `status.time` takes precedence, otherwise the earliest valid AC/FB history time is used.
Within the attempted group, the latest valid solution time is used, including no-penalty results; summary time is only
used when detailed history is absent/empty. Nonempty history with no valid time remains unknown rather than falling back
to a potentially stale summary. Durations are compared in milliseconds, and zero is a valid time.

Unknown/invalid times follow known times within their group. Equal/unknown times and all unsubmitted problems use the
original problem index as their deterministic tie-breaker. The layout determines the total columns, so missing statuses
still produce their original problem column. Incomplete histories or missing times cannot reconstruct exact chronology;
the fallback order remains stable without inventing submission times.

## Verification and local integration

`js/tests/ccpc26.test.ts` uses small synthetic fixtures for thresholds/defaults, official and denominator selection,
CE-only participation, timeline replay, timestamp sources/ties/missing values, incomplete statuses, and frozen-input
immutability. `js/tests/index.test.ts` checks public runtime and type exports. Run `pnpm -C js test` and `pnpm -C js build`.
The build exports ESM/CJS runtime files and matching declarations under `js/dist/`.

`js/scripts/ccpc26-fixtures.ts` supplies 35 small layout inputs and 12 ordering inputs.
The canonical `ccpc26` fixture section stores those inputs and expected results generated
by JS, with identical Python/Go package copies. All three packages consume this contract;
Python/Go add native numeric/API/immutability tests that cannot be represented by JSON.
The existing non-CCPC26 fixture sections are unchanged. Regenerate with
`pnpm run sync:fixtures`, check with `pnpm run check:fixtures`, and run each language suite.
Because `verify:fixtures` compares against Git, intentional uncommitted fixture additions
are instead checked for byte-identical regeneration and synchronized copies during this task.

Renderer integration must consume this rebuilt package from every importer that uses it, rather than only linking the
workspace root. Published renderer bundles keep utils external, so a build alone does not prove runtime resolution.
Verify the new exports through both ESM and CJS and record local linking separately from release dependency changes.
Before a future renderer publication, publish utils containing these exports and raise the renderer's minimum dependency
version. This work does not change package versions, publish packages, or rewrite unrelated diagnostics fixtures.
