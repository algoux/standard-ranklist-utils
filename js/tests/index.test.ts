import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as index from '../src';
import type {
  CalculatedSolutionTetrad,
  DiagnoseRanklistOptions,
  DiagnosticPatchOptions,
  PatchRanklistOptions,
  RankValue,
  RanklistDiagnosticIssue,
  RanklistDiagnostics,
  RanklistPatch,
  StaticRanklist,
  ThemeColor,
} from '../src';

test('index re-exports the public runtime API', () => {
  assert.equal(index.MIN_REGEN_SUPPORTED_VERSION, '0.3.0');
  assert.deepEqual(index.EnumTheme, {
    light: 'light',
    dark: 'dark',
  });

  const functionNames = [
    'formatTimeDuration',
    'preZeroFill',
    'secToTimeStr',
    'numberToAlphabet',
    'alphabetToNumber',
    'resolveText',
    'resolveContributor',
    'resolveColor',
    'resolveThemeColor',
    'resolveStyle',
    'resolveUserMarkers',
    'canRegenerateRanklist',
    'getSortedCalculatedRawSolutions',
    'filterSolutionsUntil',
    'sortRows',
    'calculateProblemStatistics',
    'regenerateRanklistBySolutions',
    'regenerateRowsByIncrementalSolutions',
    'convertToStaticRanklist',
    'diagnoseRanklist',
    'patchRanklist',
    'createRanklistPatchFromDiagnostics',
  ] as const;

  for (const functionName of functionNames) {
    assert.equal(typeof index[functionName], 'function', `${functionName} should be re-exported`);
  }
});

test('index re-exports public type-only helpers for TypeScript consumers', () => {
  const rankValue: RankValue = { rank: null, segmentIndex: null };
  const diagnosticIssue: RanklistDiagnosticIssue = {
    code: 'EXAMPLE',
    message: 'Example',
    severity: 'info',
    confidence: 'low',
    section: 'correctness',
  };
  const diagnoseOptions: DiagnoseRanklistOptions = {};
  const patchOptions: PatchRanklistOptions = {};
  const diagnosticPatchOptions: DiagnosticPatchOptions = {};
  const patch: RanklistPatch = {
    type: 'srk-patch',
    version: 1,
    operations: [],
  };
  const diagnostics: RanklistDiagnostics = {
    summary: {
      precision: {
        solutionTime: { actualUnit: null, declaredUnits: [], sampleCount: 0, invalidCount: 0, zeroCount: 0 },
        statusTime: { actualUnit: null, declaredUnits: [], sampleCount: 0, invalidCount: 0, zeroCount: 0 },
        scoreTime: { actualUnit: null, declaredUnits: [], sampleCount: 0, invalidCount: 0, zeroCount: 0 },
      },
    },
    completeness: {
      items: {} as RanklistDiagnostics['completeness']['items'],
    },
    correctness: {
      checks: {} as RanklistDiagnostics['correctness']['checks'],
    },
    suggestions: {
      firstBlood: [],
      sorter: [],
      problemStatistics: [],
    },
    issues: [diagnosticIssue],
  };
  const themeColor: ThemeColor = {
    [index.EnumTheme.light]: '#ffffff',
    [index.EnumTheme.dark]: '#000000',
  };
  const solution: CalculatedSolutionTetrad = ['u1', 0, 'AC', [1, 'min']];
  const ranklist: StaticRanklist = {
    type: 'general',
    version: '0.3.9',
    contest: {
      title: 'Contest',
      startAt: '2026-01-01T00:00:00+08:00',
      duration: [5, 'h'],
    },
    problems: [{ alias: 'A' }],
    series: [],
    markers: [{ id: 'girls', label: 'Girls Team', style: 'pink' }],
    rows: [
      {
        user: { id: 'u1', name: 'U1', markers: ['girls'] },
        score: { value: 1, time: [1, 'min'] },
        statuses: [{ result: 'AC', time: [1, 'min'], tries: 1 }],
        rankValues: [rankValue],
      },
    ],
  };

  assert.deepEqual(themeColor, {
    light: '#ffffff',
    dark: '#000000',
  });
  assert.deepEqual(solution, ['u1', 0, 'AC', [1, 'min']]);
  assert.deepEqual(diagnoseOptions, {});
  assert.deepEqual(patchOptions, {});
  assert.deepEqual(diagnosticPatchOptions, {});
  assert.equal(patch.type, 'srk-patch');
  assert.equal(diagnostics.issues[0].code, 'EXAMPLE');
  assert.equal(ranklist.rows[0].rankValues[0].rank, null);
  assert.deepEqual(ranklist.rows[0].user.markers, ['girls']);
});
