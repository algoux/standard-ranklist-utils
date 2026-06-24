# standard-ranklist-utils

Utilities for [Standard Ranklist (srk)](https://github.com/algoux/standard-ranklist), packaged for JavaScript,
Python, and Go.

The JavaScript package is the behavior baseline. Python and Go are tested against shared JSON fixtures generated from
that baseline so ranklist regeneration, diagnostics, patching, and rendering helpers stay aligned across languages.

## Packages

| Language | Directory | Package |
| --- | --- | --- |
| JavaScript/TypeScript | `js/` | [@algoux/standard-ranklist-utils](https://www.npmjs.com/package/@algoux/standard-ranklist-utils) |
| Python | `python/` | [algoux-standard-ranklist-utils](https://pypi.org/project/algoux-standard-ranklist-utils/) (`standard_ranklist_utils`) |
| Go | `go/` | [github.com/algoux/standard-ranklist-utils/go](https://pkg.go.dev/github.com/algoux/standard-ranklist-utils/go) |

All packages support srk `>=0.3.0 <0.4.0`. Regeneration helpers require srk `0.3.0` or later and the ICPC sorter.

## Repository Layout

- `js/`: npm package and JS baseline tests.
- `python/`: PyPI package using a `src/` layout and typed exports.
- `go/`: Go module with table-driven contract tests.
- `testdata/contract-fixtures.json`: canonical behavior fixture generated from JS.
- `python/tests/fixtures/` and `go/testdata/fixtures/`: package-local copies of the contract fixture.

## Diagnostics And Patching

All three language packages expose library-level diagnostics and patch helpers. CLI ownership lives outside this repo.

- JS: `diagnoseRanklist`, `patchRanklist`, `createRanklistPatchFromDiagnostics`.
- Python: `diagnose_ranklist`, `patch_ranklist`, `create_ranklist_patch_from_diagnostics`.
- Go: `DiagnoseRanklist`, `PatchRanklist`, `CreateRanklistPatchFromDiagnostics`.

The patch DSL is the shared `srk-patch` object format with SRK-aware targets such as `ranklist`, `contest`, `problem`,
`row`, `status`, `solution`, and `sorter`. The public sorter target is `{"type": "sorter", "path": "config..."}`.

## Development

Install JS dependencies:

```shell
pnpm install
```

Set up Python dev tools:

```shell
python3 -m venv python/.venv
python/.venv/bin/python -m pip install -e 'python[dev]'
```

Run tests:

```shell
pnpm run test:js
pnpm run test:python
pnpm run test:go
```

Regenerate shared fixtures after intentional JS behavior changes:

```shell
pnpm run sync:fixtures
pnpm run check:fixtures
pnpm run verify:fixtures
```

## Release Checks

The `Test` GitHub Actions workflow is CI only: it runs tests, builds, fixture checks, and packaging dry runs. Releases are
handled by the manual `Release` workflow so each language package can publish independently.

```shell
pnpm -C js build
(cd js && npm pack --dry-run)
python/.venv/bin/python -m build python
python/.venv/bin/python -m twine check python/dist/*
go -C go test ./...
go -C go vet ./...
```

## Publishing

Run **Actions > Release** manually with:

- `package`: `js`, `python`, or `go`.
- `version`: stable SemVer without `v`, for example `0.3.1`.
- `dry_run`: keep `true` to validate only; set `false` to publish, tag, and create a GitHub Release.

Real releases are restricted to `main` or `master`. The workflow validates that the target tag does not already exist,
runs the target package checks, and then publishes only the selected package.

Version sources and tags are independent:

- JS: update `js/package.json`; release tag `js/vX.Y.Z`.
- Python: update `python/pyproject.toml`; release tag `python/vX.Y.Z`.
- Go: no version in `go.mod`; release tag `go/vX.Y.Z`.

Configure registry publishing before setting `dry_run=false`:

- npm: configure Trusted Publishing for `@algoux/standard-ranklist-utils` with workflow `release.yml` and environment
  `npm`.
- PyPI: configure Trusted Publisher for `algoux-standard-ranklist-utils` with workflow `release.yml` and environment
  `pypi`.
- GitHub: create `npm`, `pypi`, and `go-release` environments, preferably with required reviewers.

The workflow uses OIDC / Trusted Publishing and does not require `NPM_TOKEN` or `PYPI_API_TOKEN`.

Registry setup references: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers),
[PyPI Trusted Publishers](https://docs.pypi.org/trusted-publishers/using-a-publisher/), and
[Go modules](https://go.dev/ref/mod).
