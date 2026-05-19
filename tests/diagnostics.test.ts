import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import {
  analyzeRanklistMetadata,
  checkFB,
  checkProblemStatistics,
  checkRanklistDataValidity,
  checkSeriesConfiguration,
  diagnoseRanklist,
} from '../src/diagnostics';

function makeRanklist(overrides: Partial<srk.Ranklist> = {}): srk.Ranklist {
  return {
    type: 'general',
    version: '0.3.9',
    contest: {
      title: 'Contest',
      startAt: '2026-01-01T00:00:00+08:00',
      duration: [5, 'h'],
    },
    problems: [{ alias: 'A' }, { alias: 'B' }],
    series: [{ title: 'Rank', rule: { preset: 'Normal' } }],
    rows: [],
    sorter: {
      algorithm: 'ICPC',
      config: {},
    },
    ...overrides,
  };
}

function makeRow(
  id: string,
  score: srk.RankScore = { value: 0, time: [0, 'ms'] },
  statuses: srk.RankProblemStatus[] = [
    { result: null, solutions: [] },
    { result: null, solutions: [] },
  ],
  user: Partial<srk.User> = {},
): srk.RanklistRow {
  return {
    user: {
      id,
      name: id,
      ...user,
    },
    score,
    statuses,
  };
}

function issueCodes(issues: { code: string }[]) {
  return issues.map((issue) => issue.code).sort();
}

describe('diagnostics utilities', () => {
  test('checkProblemStatistics silently skips when no detailed solutions exist', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A', statistics: { accepted: 99, submitted: 99 } }],
      rows: [makeRow('u1', { value: 1, time: [10, 'min'] }, [{ result: 'AC', time: [10, 'min'], tries: 1 }])],
    });

    const report = checkProblemStatistics(ranklist);

    assert.equal(report.skipped, true);
    assert.equal(report.confidence, 'none');
    assert.deepEqual(report.issues, []);
  });

  test('checkProblemStatistics ignores visible submissions after the first AC', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 3 } }],
      rows: [
        makeRow('u1', { value: 1, time: [40, 'min'] }, [
          {
            result: 'AC',
            time: [20, 'min'],
            tries: 2,
            solutions: [
              { result: 'WA', time: [5, 'min'] },
              { result: 'AC', time: [20, 'min'] },
              { result: 'WA', time: [25, 'min'] },
            ],
          },
        ]),
      ],
    });

    const report = checkProblemStatistics(ranklist);

    assert.equal(report.skipped, false);
    assert.deepEqual(report.computed[0], { accepted: 1, submitted: 2 });
    assert.deepEqual(issueCodes(report.issues), ['problem-statistics-mismatch']);
  });

  test('checkProblemStatistics computes from solutions even when sorter is not ICPC', () => {
    const ranklist = makeRanklist({
      sorter: { algorithm: 'score', config: {} },
      problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 2 } }],
      rows: [
        makeRow('u1', { value: 100 }, [
          {
            result: 'AC',
            time: [20, 'min'],
            tries: 2,
            solutions: [
              { result: 'WA', time: [10, 'min'] },
              { result: 'AC', time: [20, 'min'] },
            ],
          },
        ]),
      ],
    });

    const report = checkProblemStatistics(ranklist);

    assert.equal(report.skipped, false);
    assert.deepEqual(report.computed[0], { accepted: 1, submitted: 2 });
    assert.deepEqual(report.issues, []);
  });

  test('checkFB reports missing FB, non-standard FB declarations, and multiple possible FB candidates', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }, { alias: 'B' }, { alias: 'C' }],
      rows: [
        makeRow('u1', { value: 2, time: [30, 'min'] }, [
          {
            result: 'AC',
            time: [10, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [10, 'min'] }],
          },
          {
            result: 'FB',
            time: [15, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [15, 'min'] }],
          },
          {
            result: 'AC',
            time: [20, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [20, 'min'] }],
          },
        ]),
        makeRow('u2', { value: 1, time: [20, 'min'] }, [
          { result: null, solutions: [] },
          { result: null, solutions: [] },
          {
            result: 'AC',
            time: [20, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [20, 'min'] }],
          },
        ]),
      ],
    });

    const report = checkFB(ranklist);

    assert.equal(report.hasDeclaredFB, true);
    assert.equal(report.canEnhance, true);
    assert.equal(report.shouldOverride, true);
    assert.equal(report.computedFB[2].multiplePossible, true);
    assert.deepEqual(issueCodes(report.issues), [
      'FB-missing',
      'FB-missing',
      'FB-multiple-possible',
      'FB-summary-solution-AC',
    ]);
  });

  test('checkFB does not recommend result override when only declared FB time differs', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 1, time: [600, 's'] }, [
          {
            result: 'FB',
            time: [600, 's'],
            tries: 1,
            solutions: [{ result: 'FB', time: [600001, 'ms'] }],
          },
        ]),
      ],
    });

    const report = checkFB(ranklist);
    const metadata = analyzeRanklistMetadata(ranklist);

    assert.equal(report.canEnhance, false);
    assert.equal(report.shouldOverride, false);
    assert.deepEqual(issueCodes(report.issues), ['FB-declaration-time-mismatch']);
    assert.equal(metadata.FB.availability, 'declared-valid');
  });

  test('checkFB reports computed multi FB and treats a single matching declaration as higher precision', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 1, time: [10, 'min'] }, [
          {
            result: 'FB',
            time: [10, 'min'],
            tries: 1,
            solutions: [],
          },
        ]),
        makeRow('u2', { value: 1, time: [10, 'min'] }, [
          {
            result: 'AC',
            time: [10, 'min'],
            tries: 1,
            solutions: [],
          },
        ]),
      ],
    });

    const report = checkFB(ranklist);
    const metadata = analyzeRanklistMetadata(ranklist);

    assert.equal(report.hasComputedMultiplePossible, true);
    assert.equal(report.hasDeclaredMultipleFB, false);
    assert.equal(report.computedFB[0].multiplePossible, true);
    assert.equal(report.declaredFBByProblem[0].multipleDeclared, false);
    assert.equal(report.declaredFBByProblem[0].singleDeclaredWithComputedMultiple, true);
    assert.equal(report.shouldOverride, false);
    assert.equal(metadata.FB.availability, 'declared-valid');
  });

  test('checkSeriesConfiguration reports missing and empty ICPC series configs', () => {
    const missingReport = checkSeriesConfiguration(makeRanklist());

    assert.equal(missingReport.icpc.hasICPCSeries, false);
    assert.equal(missingReport.icpc.seriesCount, 0);
    assert.deepEqual(issueCodes(missingReport.issues), ['icpc-series-missing']);

    const emptyReport = checkSeriesConfiguration(
      makeRanklist({
        series: [
          {
            title: 'Medals',
            rule: {
              preset: 'ICPC',
              options: {
                count: { value: [0, 0, 0] },
              },
            },
          },
          {
            title: 'No segments',
            rule: {
              preset: 'ICPC',
              options: {},
            } as srk.RankSeriesRulePresetICPC,
          },
        ],
      }),
    );

    assert.equal(emptyReport.icpc.hasICPCSeries, true);
    assert.equal(emptyReport.icpc.seriesCount, 2);
    assert.deepEqual(emptyReport.icpc.summaries[0].countValue, [0, 0, 0]);
    assert.equal(emptyReport.icpc.summaries[0].countTotal, 0);
    assert.equal(emptyReport.icpc.summaries[0].isEmpty, true);
    assert.equal(emptyReport.icpc.summaries[1].hasAllocationConfig, false);
    assert.deepEqual(issueCodes(emptyReport.issues), ['icpc-series-count-empty', 'icpc-series-empty-config']);
  });

  test('checkRanklistDataValidity compares computed statuses, scores, statistics, and row order', () => {
    const ranklist = makeRanklist({
      problems: [
        { alias: 'A', statistics: { accepted: 2, submitted: 2 } },
        { alias: 'B', statistics: { accepted: 1, submitted: 1 } },
      ],
      rows: [
        makeRow('u1', { value: 1, time: [30, 'min'] }, [
          {
            result: 'AC',
            time: [25, 'min'],
            tries: 3,
            solutions: [
              { result: 'WA', time: [5, 'min'] },
              { result: 'AC', time: [20, 'min'] },
              { result: 'WA', time: [25, 'min'] },
            ],
          },
          { result: null, solutions: [] },
        ]),
        makeRow('u2', { value: 2, time: [25, 'min'] }, [
          {
            result: 'AC',
            time: [10, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [10, 'min'] }],
          },
          {
            result: 'AC',
            time: [15, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [15, 'min'] }],
          },
        ]),
      ],
    });

    const report = checkRanklistDataValidity(ranklist);

    assert.deepEqual(issueCodes(report.issues), [
      'problem-statistics-mismatch',
      'row-score-time-mismatch',
      'rows-order-mismatch',
      'status-time-mismatch',
      'status-tries-mismatch',
    ]);
  });

  test('checkRanklistDataValidity reports structural and time validity issues', () => {
    const ranklist = makeRanklist({
      rows: [
        makeRow('u1', { value: 0, time: [0, 'ms'] }, [
          {
            result: 'RJ',
            tries: -1,
            solutions: [
              { result: 'WA', time: [20, 'min'] },
              { result: 'WA', time: [10, 'min'] },
            ],
          },
        ]),
        makeRow('u1'),
      ],
    });

    const report = checkRanklistDataValidity(ranklist);

    assert.deepEqual(issueCodes(report.issues), [
      'duplicate-user-id',
      'solution-order-mismatch',
      'status-tries-invalid',
      'statuses-length-mismatch',
    ]);
  });

  test('checkRanklistDataValidity accepts omitted zero score time', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 0 }, [{ result: null, solutions: [] }])],
    });

    assert.equal(issueCodes(checkRanklistDataValidity(ranklist).issues).includes('row-score-time-mismatch'), false);
  });

  test('checkRanklistDataValidity reports invalid accepted solution time without throwing', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 1, time: [10, 'min'] }, [
          {
            result: 'AC',
            time: [10, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [-1, 'min'] }],
          },
        ]),
      ],
    });

    assert.doesNotThrow(() => checkRanklistDataValidity(ranklist));
    assert.equal(issueCodes(checkRanklistDataValidity(ranklist).issues).includes('solution-time-invalid'), true);
  });

  test('checkRanklistDataValidity reports invalid summary AC time without throwing', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 1, time: [10, 'min'] }, [{ result: 'AC', time: [-1, 'min'], tries: 1 }])],
    });

    assert.doesNotThrow(() => checkRanklistDataValidity(ranklist));
    assert.equal(issueCodes(checkRanklistDataValidity(ranklist).issues).includes('status-time-invalid'), true);
  });

  test('checkRanklistDataValidity reports missing solution result explicitly', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 0, time: [0, 'ms'] }, [
          {
            result: null,
            solutions: [{ time: [10, 'min'] } as srk.Solution],
          },
        ]),
      ],
    });

    assert.equal(issueCodes(checkRanklistDataValidity(ranklist).issues).includes('solution-result-invalid'), true);
  });

  test('checkRanklistDataValidity reports unresolved marker references', () => {
    const ranklist = makeRanklist({
      markers: [{ id: 'girls', label: 'Girls', style: 'pink' }],
      series: [
        {
          title: 'Girls',
          rule: {
            preset: 'ICPC',
            options: {
              filter: { byMarker: 'missing-series-marker' },
              count: { value: [1] },
            },
          },
        },
      ],
      rows: [
        makeRow('u1', { value: 0, time: [0, 'ms'] }, undefined, {
          markers: ['girls', 'missing-user-marker'],
          marker: 'missing-legacy-marker',
        }),
        makeRow('u2', { value: 0, time: [0, 'ms'] }, undefined, {
          marker: 'missing-legacy-only-marker',
        }),
      ],
    });

    const markerIssues = checkRanklistDataValidity(ranklist).issues.filter((issue) => issue.code.includes('marker'));

    assert.deepEqual(
      markerIssues.map((issue) => issue.code).sort(),
      [
        'marker-reference-missing',
        'marker-reference-missing',
        'marker-reference-missing',
        'series-filter-marker-reference-missing',
      ],
    );
    assert.deepEqual(
      markerIssues.map((issue) => issue.path).sort(),
      [
        'rows[0].user.marker',
        'rows[0].user.markers[1]',
        'rows[1].user.marker',
        'series[0].rule.options.filter.byMarker',
      ],
    );
  });

  test('checkRanklistDataValidity reports invalid sorter config without throwing', () => {
    const ranklist = makeRanklist({
      sorter: {
        algorithm: 'ICPC',
        config: {
          penalty: [-1, 'min'],
          timePrecision: 'bad',
          timeRounding: 'bad',
          rankingTimePrecision: 'bad',
          rankingTimeRounding: 'bad',
        } as unknown as srk.SorterICPC['config'],
      },
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 0 }, [{ result: null, solutions: [] }])],
    });

    assert.doesNotThrow(() => checkRanklistDataValidity(ranklist));
    assert.deepEqual(issueCodes(checkRanklistDataValidity(ranklist).issues), [
      'sorter-penalty-invalid',
      'sorter-ranking-time-precision-invalid',
      'sorter-ranking-time-rounding-invalid',
      'sorter-time-precision-invalid',
      'sorter-time-rounding-invalid',
    ]);
  });

  test('checkRanklistDataValidity infers possible ICPC score time precision configs from status times', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }, { alias: 'B' }],
      sorter: {
        algorithm: 'ICPC',
        config: {
          timePrecision: 'ms',
          timeRounding: 'floor',
        },
      },
      rows: [
        makeRow('u1', { value: 2, time: [2795, 's'] }, [
          { result: 'AC', time: [995500, 'ms'], tries: 1, solutions: [] },
          { result: 'AC', time: [10, 'min'], tries: 2, solutions: [] },
        ]),
      ],
    });

    const report = checkRanklistDataValidity(ranklist);

    assert.equal(report.timePrecision?.matchedDeclared, false);
    assert.deepEqual(report.timePrecision?.possible, [{ timePrecision: 's', timeRounding: 'floor' }]);
    assert.equal(issueCodes(report.issues).includes('sorter-time-precision-config-mismatch'), true);
  });

  test('checkFB ignores solution-level FB after the first accepted submission', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 1, time: [20, 'min'] }, [
          {
            result: 'AC',
            time: [20, 'min'],
            tries: 1,
            solutions: [
              { result: 'AC', time: [20, 'min'] },
              { result: 'FB', time: [40, 'min'] },
            ],
          },
        ]),
      ],
    });

    const report = checkFB(ranklist);

    assert.equal(report.shouldOverride, true);
    assert.equal(report.declaredFB.length, 0);
    assert.deepEqual(issueCodes(report.issues), ['FB-missing']);
  });

  test('analyzeRanklistMetadata detects precision, rich metadata, mock solutions, and fuzzy RJ results', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A', style: { backgroundColor: '#58a2d1' } }],
      rows: [
        makeRow(
          'u1',
          { value: 1, time: [10, 'min'] },
          [
            {
              result: '?',
              time: [10, 'min'],
              tries: 1,
              solutions: [
                { result: 'RJ', time: [0, 's'] },
                { result: 'AC', time: [10, 'min'] },
                { result: '?', time: [11, 'min'] },
              ],
            },
          ],
          {
            avatar: 'avatar.png',
            teamMembers: [{ name: 'Alice' }],
            ...({
              photo: 'photo.png',
              location: 'A-01',
            } as Partial<srk.User>),
          },
        ),
      ],
    });

    const metadata = analyzeRanklistMetadata(ranklist);

    assert.equal(metadata.submissionPrecision, 'min');
    assert.equal(metadata.hasProblemColors, true);
    assert.equal(metadata.hasDetailedSolutions, true);
    assert.equal(metadata.solutionsAreLikelyMocked, true);
    assert.equal(metadata.hasFuzzyRJResults, true);
    assert.equal(metadata.hasPreciseSolutionResults, false);
    assert.equal(metadata.hasFrozenSubmissions, true);
    assert.equal(metadata.hasTeamMembers, true);
    assert.equal(metadata.hasUserAvatar, true);
    assert.equal(metadata.hasUserPhoto, true);
    assert.equal(metadata.hasUserLocation, true);
  });

  test('analyzeRanklistMetadata reports true submission precision instead of declared time unit labels', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 1, time: [995, 's'] }, [
          {
            result: 'AC',
            time: [995, 's'],
            tries: 1,
            solutions: [{ result: 'AC', time: [995000, 'ms'] }],
          },
        ]),
      ],
    });

    const metadata = analyzeRanklistMetadata(ranklist);

    assert.equal(metadata.submissionPrecision, 's');
  });

  test('analyzeRanklistMetadata treats concrete rejected result enums as precise when no RJ is present', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 1, time: [20, 'min'] }, [
          {
            result: 'AC',
            time: [20, 'min'],
            tries: 2,
            solutions: [
              { result: 'WA', time: [10, 'min'] },
              { result: 'AC', time: [20, 'min'] },
            ],
          },
        ]),
      ],
    });

    const metadata = analyzeRanklistMetadata(ranklist);

    assert.equal(metadata.hasFuzzyRJResults, false);
    assert.equal(metadata.hasPreciseSolutionResults, true);
  });

  test('diagnoseRanklist aggregates sub reports and issue totals', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A', statistics: { accepted: 0, submitted: 0 } }],
      rows: [
        makeRow('u1', { value: 1, time: [10, 'min'] }, [
          {
            result: 'AC',
            time: [10, 'min'],
            tries: 1,
            solutions: [{ result: 'AC', time: [10, 'min'] }],
          },
        ]),
      ],
    });

    const report = diagnoseRanklist(ranklist);

    assert.equal(report.problemStatistics.computed[0].accepted, 1);
    assert.equal(report.series.icpc.hasICPCSeries, false);
    assert.equal(report.FB.canEnhance, true);
    assert.equal(report.metadata.hasDetailedSolutions, true);
    assert.equal(report.summary.errorCount, 0);
    assert.equal(report.summary.warningCount > 0, true);
    assert.equal(report.issues.length, report.summary.issueCount);
  });
});
