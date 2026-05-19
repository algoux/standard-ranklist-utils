import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import packageJson from '../package.json';
import { runCli } from '../src/cli';

function makeRanklist(overrides: Partial<srk.Ranklist> = {}): srk.Ranklist {
  return {
    type: 'general',
    version: '0.3.9',
    contest: {
      title: 'Contest',
      startAt: '2026-01-01T00:00:00+08:00',
      duration: [5, 'h'],
    },
    problems: [{ alias: 'A', statistics: { accepted: 0, submitted: 0 } }],
    series: [{ title: 'Rank', rule: { preset: 'Normal' } }],
    rows: [
      {
        user: { id: 'u1', name: 'U1' },
        score: { value: 1, time: [10, 'min'] },
        statuses: [
          {
            result: 'AC',
            time: [10, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [10, 'min'] }],
          },
        ],
      },
    ],
    sorter: {
      algorithm: 'ICPC',
      config: {},
    },
    ...overrides,
  };
}

function withTempRanklist(ranklist: srk.Ranklist, fn: (filePath: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'srk-cli-test-'));
  try {
    const filePath = join(dir, 'ranklist.json');
    writeFileSync(filePath, JSON.stringify(ranklist), 'utf8');
    fn(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withNoColor(value: string | undefined, fn: () => void) {
  const originalNoColor = process.env.NO_COLOR;
  if (value === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = value;
  }
  try {
    fn();
  } finally {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  }
}

function makeValidRanklist(): srk.Ranklist {
  return makeRanklist({
    problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 1 } }],
    series: [
      {
        title: 'Medals',
        rule: { preset: 'ICPC', options: { count: { value: [1] } } },
      },
    ],
    rows: [
      {
        user: { id: 'u1', name: 'U1' },
        score: { value: 1, time: [10, 'min'] },
        statuses: [
          {
            result: 'FB',
            time: [10, 'min'],
            tries: 1,
            solutions: [{ result: 'FB', time: [10, 'min'] }],
          },
        ],
      },
    ],
    sorter: {
      algorithm: 'ICPC',
      config: { timePrecision: 'min' },
    },
  });
}

describe('diagnostics CLI', () => {
  test('package exposes an executable diagnostics bin', () => {
    assert.deepEqual((packageJson as { bin?: unknown }).bin, {
      'srk-diagnose': './dist/cli.js',
    });
  });

  test('prints a friendly English diagnostics report by default', () => {
    withNoColor(undefined, () => {
      withTempRanklist(makeRanklist(), (filePath) => {
        const stdout: string[] = [];
        const stderr: string[] = [];

        const exitCode = runCli([filePath], {
          stdout: (text: string) => stdout.push(text),
          stderr: (text: string) => stderr.push(text),
        });

        assert.equal(exitCode, 0);
        assert.equal(stderr.join(''), '');
        assert.match(stdout.join(''), /SRK Diagnostics Report/);
        assert.match(stdout.join(''), /Summary/);
        assert.match(stdout.join(''), /Problem Statistics/);
        assert.match(stdout.join(''), /Series/);
        assert.match(stdout.join(''), /ICPC series: \x1b\[33mmissing\x1b\[0m \(0\)/);
        assert.match(stdout.join(''), /ICPC config summary: none/);
        assert.match(stdout.join(''), /FB/);
        assert.match(stdout.join(''), /Validation status: \x1b\[33mWARN\x1b\[0m/);
        assert.match(stdout.join(''), /Problem colors: \x1b\[2mmissing\x1b\[0m/);
        assert.match(stdout.join(''), /Missing FB fill: \x1b\[33mfill available\x1b\[0m/);
        assert.match(stdout.join(''), /FB result override: \x1b\[33mrecommended\x1b\[0m/);
        assert.match(stdout.join(''), /Rows order: \x1b\[32mOK\x1b\[0m/);
        assert.doesNotMatch(stdout.join(''), /\x1b\[32myes\x1b\[0m/);
        assert.doesNotMatch(stdout.join(''), /\x1b\[31mno\x1b\[0m/);
        assert.doesNotMatch(stdout.join(''), /Has errors:/);
        assert.doesNotMatch(stdout.join(''), /Can fill missing FB result:/);
        assert.doesNotMatch(stdout.join(''), /Should override FB result:/);
        assert.doesNotMatch(stdout.join(''), /Computed row order:/);
        assert.match(stdout.join(''), /problem-statistics-mismatch/);
      });
    });
  });

  test('prints OK and ERROR validation badges with diagnostic colors', () => {
    withNoColor(undefined, () => {
      withTempRanklist(makeValidRanklist(), (filePath) => {
        const stdout: string[] = [];

        const exitCode = runCli([filePath], {
          stdout: (text: string) => stdout.push(text),
          stderr: () => undefined,
        });

        assert.equal(exitCode, 0);
        assert.match(stdout.join(''), /Validation status: \x1b\[32mOK\x1b\[0m/);
        assert.match(stdout.join(''), /ICPC series: \x1b\[36mconfigured\x1b\[0m \(1\)/);
        assert.match(stdout.join(''), /ICPC config summary: #0 Medals count=\[1\]/);
        assert.match(stdout.join(''), /FB result override: \x1b\[32mno action\x1b\[0m/);
      });

      withTempRanklist(
        makeRanklist({
          sorter: { algorithm: 'ICPC', config: { timePrecision: 'bad' } as unknown as srk.SorterICPC['config'] },
        }),
        (filePath) => {
          const stdout: string[] = [];

          const exitCode = runCli([filePath], {
            stdout: (text: string) => stdout.push(text),
            stderr: () => undefined,
          });

          assert.equal(exitCode, 0);
          assert.match(stdout.join(''), /Validation status: \x1b\[31mERROR\x1b\[0m/);
        },
      );
    });
  });

  test('supports NO_COLOR for friendly semantic badges', () => {
    withNoColor('1', () => {
      withTempRanklist(makeRanklist(), (filePath) => {
        const stdout: string[] = [];

        const exitCode = runCli([filePath], {
          stdout: (text: string) => stdout.push(text),
          stderr: () => undefined,
        });

        assert.equal(exitCode, 0);
        assert.match(stdout.join(''), /Validation status: WARN/);
        assert.doesNotMatch(stdout.join(''), /\x1b\[/);
      });
    });
  });

  test('prints the raw diagnostics object as JSON when requested', () => {
    withTempRanklist(makeRanklist(), (filePath) => {
      const stdout: string[] = [];
      const stderr: string[] = [];

      const exitCode = runCli([filePath, '--format', 'json'], {
        stdout: (text: string) => stdout.push(text),
        stderr: (text: string) => stderr.push(text),
      });

      assert.equal(exitCode, 0);
      assert.equal(stderr.join(''), '');
      const report = JSON.parse(stdout.join(''));
      assert.equal(report.summary.issueCount > 0, true);
      assert.equal(report.problemStatistics.computed[0].accepted, 1);
      assert.equal(report.series.icpc.hasICPCSeries, false);
      assert.equal(report.FB.canEnhance, true);
      assert.equal(typeof report.FB.canEnhance, 'boolean');
    });
  });

  test('supports --json as a short JSON output switch', () => {
    withTempRanklist(makeRanklist(), (filePath) => {
      const stdout: string[] = [];

      const exitCode = runCli([filePath, '--json'], {
        stdout: (text: string) => stdout.push(text),
        stderr: () => undefined,
      });

      assert.equal(exitCode, 0);
      assert.equal(JSON.parse(stdout.join('')).metadata.hasDetailedSolutions, true);
    });
  });

  test('returns an error for a missing path', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runCli([], {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.join(''), '');
    assert.match(stderr.join(''), /Usage:/);
  });

  test('returns an error for invalid JSON files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'srk-cli-test-'));
    try {
      const filePath = join(dir, 'ranklist.json');
      writeFileSync(filePath, '{', 'utf8');
      const stderr: string[] = [];

      const exitCode = runCli([filePath], {
        stdout: () => undefined,
        stderr: (text: string) => stderr.push(text),
      });

      assert.equal(exitCode, 1);
      assert.match(stderr.join(''), /Failed to read or parse SRK file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
