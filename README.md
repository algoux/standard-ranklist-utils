# standard-ranklist-utils

Utilities for [Standard Ranklist (srk)](https://github.com/algoux/standard-ranklist), packaged for JavaScript,
Python, and Go.

The JavaScript package is the behavior baseline. Python and Go are tested against shared JSON fixtures generated from
that baseline so ranklist regeneration and rendering helpers stay aligned across languages.

## Packages

| Language | Directory | Package |
| --- | --- | --- |
| JavaScript/TypeScript | `js/` | `@algoux/standard-ranklist-utils` |
| Python | `python/` | `algoux-standard-ranklist-utils` (`standard_ranklist_utils`) |
| Go | `go/` | `github.com/algoux/standard-ranklist-utils/go` |

All packages support srk `>=0.3.0 <0.4.0`. Regeneration helpers require srk `0.3.0` or later and the ICPC sorter.

## Repository Layout

- `js/`: npm package and JS baseline tests.
- `python/`: PyPI package using a `src/` layout and typed exports.
- `go/`: Go module with table-driven contract tests.
- `testdata/contract-fixtures.json`: canonical behavior fixture generated from JS.
- `python/tests/fixtures/` and `go/testdata/fixtures/`: package-local copies of the contract fixture.

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

```shell
pnpm -C js build
(cd js && npm pack --dry-run)
python/.venv/bin/python -m build python
python/.venv/bin/python -m twine check python/dist/*
go -C go test ./...
go -C go vet ./...
```

For Go subdirectory releases, tag with the module prefix, for example `go/v0.3.0`.
