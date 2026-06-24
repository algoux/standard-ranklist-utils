# SRK Diagnostics Design

## Goal

`diagnoseRanklist(ranklist, options?)` provides a read-only, JS/TS-only diagnostic pass for Standard Ranklist data. It is meant for upper-layer tools that need structured signals for summaries, lint-style issue lists, and safe repair suggestions.

## Result Shape

The public result is `RanklistDiagnostics`:

- `summary.precision` reports actual precision for solution times, status times, and score times after converting all valid `TimeDuration` values to milliseconds.
- `completeness.items` grades data coverage such as banner, first-blood declarations, problem colors, ICPC series config, user avatars, user photos, team members, coach roles, i18n text, status arrays, solution histories, and row user consistency.
- `correctness.checks` reports deterministic or heuristic checks for first blood, problem statistics, mock solutions, status summaries, scores, row order, sorter config, and marker declarations.
- `suggestions.firstBlood`, `suggestions.sorter`, and `suggestions.problemStatistics` include only repair candidates that can be derived from the current data.
- `issues[]` is the flat machine-friendly index for filtering by code, severity, confidence, path, row, problem, or user.

## CLI Integration

This package only owns the structured diagnostic API. The standalone `@algoux/standard-ranklist-cli` package owns the
human-readable terminal report, file IO, command parsing, and `srk diagnose` command behavior.

The CLI may print `RanklistDiagnostics` as JSON or render a terminal-friendly text report, but that text formatter lives
in the CLI package rather than in `standard-ranklist-utils`.

## Important Boundaries

- The function never mutates the input ranklist. Existing mutable utilities such as `sortRows` are only used on copied arrays.
- Python and Go APIs are intentionally unchanged for this diagnostics version.
- Avatar and photo completeness checks inspect `row.user.avatar` and `row.user.photo` as separate items; `teamMembers[].avatar` and `teamMembers[].photo` are ignored.
- i18n completeness checks are limited to `contest.title`, `row.user.name`, and `row.user.organization`.
- Non-ICPC sorters mark ICPC-specific checks as `notApplicable` instead of failing.
- SRK summary fields remain authoritative where the spec says so. `solutions[]` mismatch diagnostics are warnings about history/summary consistency and regenerability, not proof that `status.result` is invalid.

## Diagnostic Rules

- Precision detection ignores zero values when choosing `actualUnit`, then chooses the coarsest standard SRK unit that exactly represents every non-zero sample.
- First-blood correctness uses exact `status.solutions[]` accepted submissions when available. It reports multiple declarations, missing declarations, and conflicts where a unique earlier accepted submission is visible.
- First-blood correctness can fall back to `status.result/time` when no detailed `solutions[]` history exists; those findings use lower confidence than exact solution-history findings.
- First-blood completeness only expects declarations for problems with at least one accepted status or accepted solution. Problems with zero accepted submissions are listed in `noAcceptedProblemIndexes` and do not reduce first-blood completeness.
- Status summary consistency is recalculated from exact `solutions[]` with the configured ICPC `noPenaltyResults`, and reported as a warning because SRK treats the summary as authoritative. Time comparison is compatibility-based: the first accepted solution time is converted to the declared `status.time` unit with floor rounding, then compared to `status.time[0]`; zero time placeholders on rejected summaries are accepted.
- Score correctness recalculates score from declared status summaries and sorter timing options. It uses declared `status.tries`; solution-history `noPenaltyResults` effects are diagnosed by sorter configuration checks instead of changing score correctness.
- Row-order correctness uses adjacent non-tie comparisons so tied rows are allowed to remain in source order.
- Mock solution detection is intentionally heuristic and uses confidence levels for repeated identical RJ timestamps or uniform one-second/one-minute synthetic RJ sequences.
- Problem statistics in ICPC diagnostics are sorter-aware when exact `solutions[]` histories are present. The checker recalculates each cell's effective summary with the active `noPenaltyResults`, uses the effective result for accepted counts, and uses the effective `tries` for submitted counts. When histories are absent, it falls back to declared `status.result` and `status.tries`. The public `calculateProblemStatistics` utility keeps its existing behavior.
- Problem-statistics suggestions are emitted for mismatches where the declared statistics match a calculation that removes `CE`, `NOUT`, and `UKE` from `sorter.config.noPenaltyResults`. That pattern indicates the ranklist may have counted those no-penalty results as submitted attempts. The suggested repair patches `problems[].statistics` to the current sorter-aware expected value.
- Sorter configuration diagnostics check whether `noPenaltyResults` can explain detailed solution histories, declared `status.tries`, problem statistics submitted counts, and whether `timePrecision`/`timeRounding` can explain `SUM(status.time + penalty) -> score.time`.
- Sorter suggestions enumerate `noPenaltyResults` candidates in the normalized shape `[FB, AC, ?, ...subset, null]`, where `subset` is any combination of `NOUT`, `CE`, and `UKE`. They also continue trying score timing `timePrecision` and `timeRounding` candidates. Ranking-time precision/rounding is intentionally ignored by diagnostics suggestions. A candidate is suggested only when it reduces the related mismatch count; candidates that solve everything are high confidence, while partial reductions are lower confidence.
- Sorter configuration details expose `statusSummaryMismatchCount`, `problemStatisticsMismatchCount`, `triesMismatchCount`, `scoreMismatchCount`, `rowOrderMismatchCount`, and `issueCount`. The legacy `statusMismatchCount` detail is retained as an alias for `triesMismatchCount`.
- Marker diagnostics honor SRK precedence: modern `user.markers` overrides deprecated `user.marker`; `series[].rule.options.filter.byMarker` is also checked against declared marker IDs.
- `rows[].statuses.length === problems.length` is both a completeness signal and a correctness error because SRK defines it as a MUST.

## Extension Notes

Future language ports should treat the TypeScript implementation and `js/tests/diagnostics.test.ts` as the behavior baseline. If diagnostics become part of the cross-language contract, add fixture generation after the JS behavior stabilizes rather than retrofitting Python/Go from incomplete heuristics.
