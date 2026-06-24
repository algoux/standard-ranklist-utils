import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import { diagnoseRanklist } from '../src';

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

function issueCodes(ranklist: srk.Ranklist) {
  return diagnoseRanklist(ranklist).issues.map((issue) => issue.code);
}

describe('diagnoseRanklist', () => {
  test('reports actual time precision after converting declared units', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow(
            'u1',
            { value: 1, time: [300000, 'ms'] },
            [
              {
                result: 'AC',
                time: [125000, 'ms'],
                tries: 1,
                solutions: [{ result: 'AC', time: [125000, 'ms'] }],
              },
            ],
          ),
          makeRow(
            'u2',
            { value: 1, time: [10, 'min'] },
            [
              {
                result: 'AC',
                time: [2, 'min'],
                tries: 1,
                solutions: [{ result: 'AC', time: [2, 'min'] }],
              },
            ],
          ),
        ],
      }),
    );

    assert.equal(diagnostics.summary.precision.solutionTime.actualUnit, 's');
    assert.deepEqual(diagnostics.summary.precision.solutionTime.declaredUnits, ['ms', 'min']);
    assert.equal(diagnostics.summary.precision.statusTime.actualUnit, 's');
    assert.equal(diagnostics.summary.precision.scoreTime.actualUnit, 'min');
  });

  test('grades completeness items and classifies exact versus lite solution results', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        contest: {
          title: { fallback: 'Contest', 'zh-CN': '比赛' },
          startAt: '2026-01-01T00:00:00+08:00',
          duration: [5, 'h'],
        },
        problems: [{ alias: 'A', style: { backgroundColor: '#ff0000' } }, { alias: 'B' }],
        series: [
          {
            title: 'Medals',
            segments: [{ title: 'Gold' }, { title: 'Silver' }, { title: 'Bronze' }],
            rule: { preset: 'ICPC', options: { count: { value: [0, 0, 0] } } },
          },
        ],
        rows: [
          makeRow(
            'u1',
            { value: 1, time: [10, 'min'] },
            [
              {
                result: 'FB',
                time: [10, 'min'],
                tries: 2,
                solutions: [
                  { result: 'WA', time: [5, 'min'] },
                  { result: 'FB', time: [10, 'min'] },
                ],
              },
              { result: null },
            ],
            {
              avatar: 'https://example.com/u1.png',
              photo: 'https://example.com/u1-photo.png',
              teamMembers: [{ name: 'Coach', role: 'coach' } as unknown as srk.ExternalUser],
              organization: { fallback: 'Org', 'zh-CN': '学校' },
            },
          ),
          makeRow(
            'u2',
            { value: 0, time: [0, 'ms'] },
            [{ result: 'RJ', tries: 1, solutions: [{ result: 'RJ', time: [20, 'min'] }] }, { result: null }],
            { name: { fallback: 'User 2', 'zh-CN': '用户 2' } },
          ),
        ],
      }),
    );

    assert.equal(diagnostics.completeness.items.banner.level, 'missing');
    assert.equal(diagnostics.completeness.items.problemColors.presentCount, 1);
    assert.notEqual(diagnostics.completeness.items.icpcSeries.level, 'complete');
    assert.equal(diagnostics.completeness.items.userAvatar.presentCount, 1);
    assert.equal(diagnostics.completeness.items.userPhoto.presentCount, 1);
    assert.equal(diagnostics.completeness.items.banner.details.optional, true);
    assert.equal(diagnostics.completeness.items.userAvatar.details.optional, true);
    assert.equal(diagnostics.completeness.items.userPhoto.details.optional, true);
    assert.deepEqual(
      Object.keys(diagnostics.completeness.items).slice(
        Object.keys(diagnostics.completeness.items).indexOf('userAvatar'),
        Object.keys(diagnostics.completeness.items).indexOf('userAvatar') + 3,
      ),
      ['userAvatar', 'userPhoto', 'teamMembers'],
    );
    assert.equal(diagnostics.completeness.items.teamMembers.presentCount, 1);
    assert.equal(diagnostics.completeness.items.coachRole.presentCount, 1);
    assert.equal(diagnostics.completeness.items.statuses.level, 'complete');
    assert.equal(diagnostics.completeness.items.solutions.details.exactResultCount, 1);
    assert.equal(diagnostics.completeness.items.solutions.details.liteResultCount, 2);
    assert.ok(diagnostics.completeness.items.rowUserConsistency.details.missingByRow.length > 0);
  });

  test('detects first-blood conflicts and suggests unique repairs', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 1, time: [10, 'min'] }, [
            { result: 'AC', time: [10, 'min'], tries: 1, solutions: [{ result: 'AC', time: [10, 'min'] }] },
          ]),
          makeRow('u2', { value: 1, time: [20, 'min'] }, [
            { result: 'FB', time: [20, 'min'], tries: 1, solutions: [{ result: 'FB', time: [20, 'min'] }] },
          ]),
        ],
      }),
    );

    assert.ok(diagnostics.issues.some((issue) => issue.code === 'FIRST_BLOOD_CONFLICT'));
    assert.deepEqual(diagnostics.suggestions.firstBlood, [
      {
        problemIndex: 0,
        problemAlias: 'A',
        userId: 'u1',
        rowIndex: 0,
        time: [10, 'min'],
      },
    ]);
  });

  test('reports multiple first-blood declarations and missing declarations', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        rows: [
          makeRow('u1', { value: 2, time: [30, 'min'] }, [
            { result: 'FB', time: [10, 'min'], tries: 1, solutions: [{ result: 'FB', time: [10, 'min'] }] },
            { result: 'AC', time: [20, 'min'], tries: 1, solutions: [{ result: 'AC', time: [20, 'min'] }] },
          ]),
          makeRow('u2', { value: 1, time: [15, 'min'] }, [
            { result: 'FB', time: [15, 'min'], tries: 1, solutions: [{ result: 'FB', time: [15, 'min'] }] },
            { result: null, solutions: [] },
          ]),
          makeRow('u3', { value: 1, time: [5, 'min'] }, [
            { result: null, solutions: [] },
            { result: 'AC', time: [5, 'min'], tries: 1, solutions: [{ result: 'AC', time: [5, 'min'] }] },
          ]),
        ],
      }),
    );

    assert.ok(diagnostics.issues.some((issue) => issue.code === 'FIRST_BLOOD_MULTIPLE'));
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'FIRST_BLOOD_MISSING'));
    assert.ok(diagnostics.suggestions.firstBlood.some((suggestion) => suggestion.problemIndex === 1));
  });

  test('does not require first-blood declarations for problems without accepted solutions', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [
          { alias: 'A', statistics: { accepted: 1, submitted: 1 } },
          { alias: 'B', statistics: { accepted: 0, submitted: 2 } },
        ],
        rows: [
          makeRow('u1', { value: 1, time: [10, 'min'] }, [
            { result: 'FB', time: [10, 'min'], tries: 1, solutions: [{ result: 'FB', time: [10, 'min'] }] },
            { result: 'RJ', time: [0, 'ms'], tries: 2, solutions: [{ result: 'RJ', time: [5, 'min'] }] },
          ]),
          makeRow('u2', { value: 0, time: [0, 'ms'] }, [
            { result: null, solutions: [] },
            { result: 'RJ', time: [0, 'ms'], tries: 1, solutions: [{ result: 'RJ', time: [8, 'min'] }] },
          ]),
        ],
      }),
    );

    assert.equal(diagnostics.completeness.items.firstBlood.level, 'complete');
    assert.equal(diagnostics.completeness.items.firstBlood.presentCount, 1);
    assert.equal(diagnostics.completeness.items.firstBlood.totalCount, 1);
    assert.deepEqual(diagnostics.completeness.items.firstBlood.details.noAcceptedProblemIndexes, [1]);
    assert.equal(diagnostics.issues.some((issue) => issue.code === 'COMPLETENESS_FIRST_BLOOD'), false);
    assert.equal(diagnostics.issues.some((issue) => issue.code === 'FIRST_BLOOD_MISSING' && issue.problemIndex === 1), false);
    assert.equal(diagnostics.correctness.checks.firstBlood.checkedCount, 1);
  });

  test('detects problem statistics mismatches', () => {
    assert.ok(
      issueCodes(
        makeRanklist({
          problems: [{ alias: 'A', statistics: { accepted: 9, submitted: 9 } }],
          rows: [makeRow('u1', { value: 1, time: [10, 'min'] }, [{ result: 'AC', time: [10, 'min'], tries: 1 }])],
        }),
      ).includes('PROBLEM_STATISTICS_MISMATCH'),
    );
  });

  test('suggests problem statistics repairs when declared statistics look counted from penalty-only CE/NOUT/UKE', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 2 } }],
        rows: [
          makeRow('u1', { value: 1, time: [30, 'min'] }, [
            {
              result: 'AC',
              time: [30, 'min'],
              tries: 1,
              solutions: [
                { result: 'CE', time: [10, 'min'] },
                { result: 'AC', time: [30, 'min'] },
              ],
            },
          ]),
        ],
      }),
    );

    assert.deepEqual(diagnostics.suggestions.problemStatistics, [
      {
        problemIndex: 0,
        problemAlias: 'A',
        actual: { accepted: 1, submitted: 2 },
        expected: { accepted: 1, submitted: 1 },
        confidence: 'high',
        reason: 'declared statistics match a calculation where CE/NOUT/UKE count as penalty submissions',
        details: {
          withoutNoPenaltyResults: ['CE', 'NOUT', 'UKE'],
        },
      },
    ]);
  });

  test('uses solution histories for submitted problem statistics when available', () => {
    const matching = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 2 } }],
        rows: [
          makeRow('u1', { value: 1, time: [10, 'min'] }, [
            {
              result: 'AC',
              time: [10, 'min'],
              tries: 2,
              solutions: [
                { result: 'WA', time: [5, 'min'] },
                { result: 'AC', time: [10, 'min'] },
              ],
            },
          ]),
        ],
      }),
    );
    const mismatching = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 1 } }],
        rows: [
          makeRow('u1', { value: 1, time: [10, 'min'] }, [
            {
              result: 'AC',
              time: [10, 'min'],
              tries: 2,
              solutions: [
                { result: 'WA', time: [5, 'min'] },
                { result: 'AC', time: [10, 'min'] },
              ],
            },
          ]),
        ],
      }),
    );

    assert.equal(matching.issues.some((issue) => issue.code === 'PROBLEM_STATISTICS_MISMATCH'), false);
    const mismatch = mismatching.issues.find((issue) => issue.code === 'PROBLEM_STATISTICS_MISMATCH');
    assert.ok(mismatch);
    assert.deepEqual(mismatch.details?.actual, { accepted: 1, submitted: 1 });
    assert.deepEqual(mismatch.details?.expected, { accepted: 1, submitted: 2 });
    assert.equal(Object.prototype.hasOwnProperty.call(mismatch.details, 'current'), false);
  });

  test('detects broad mock solution timestamp patterns', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 0, time: [0, 'ms'] }, [
            {
              result: 'RJ',
              tries: 3,
              solutions: [
                { result: 'RJ', time: [10, 'min'] },
                { result: 'RJ', time: [10, 'min'] },
                { result: 'RJ', time: [10, 'min'] },
              ],
            },
          ]),
          makeRow('u2', { value: 0, time: [0, 'ms'] }, [
            {
              result: 'RJ',
              tries: 3,
              solutions: [
                { result: 'RJ', time: [20, 'min'] },
                { result: 'RJ', time: [20, 'min'] },
                { result: 'RJ', time: [20, 'min'] },
              ],
            },
          ]),
        ],
      }),
    );

    assert.equal(diagnostics.correctness.checks.mockSolutions.status, 'warning');
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'MOCK_SOLUTIONS_SUSPECTED' && issue.confidence === 'high'));
  });

  test('detects status mismatches and suggests no-penalty sorter repairs', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 1, time: [70, 'min'] }, [
            {
              result: 'AC',
              time: [30, 'min'],
              tries: 3,
              solutions: [
                { result: 'WA', time: [10, 'min'] },
                { result: 'CE', time: [20, 'min'] },
                { result: 'AC', time: [30, 'min'] },
              ],
            },
          ]),
        ],
      }),
    );

    const statusMismatch = diagnostics.issues.find((issue) => issue.code === 'STATUS_SUMMARY_MISMATCH');
    assert.ok(statusMismatch);
    assert.deepEqual(statusMismatch.details?.actual, { result: 'AC', tries: 3, time: [30, 'min'] });
    assert.deepEqual(statusMismatch.details?.expected, { result: 'AC', tries: 2, time: [30, 'min'] });
    assert.equal(Object.prototype.hasOwnProperty.call(statusMismatch.details, 'current'), false);
    assert.equal(diagnostics.issues.some((issue) => issue.code === 'SCORE_MISMATCH'), false);
    assert.equal(diagnostics.correctness.checks.scores.status, 'pass');
    assert.equal(diagnostics.correctness.checks.sorterConfig.details.baseline.triesMismatchCount, 1);
    assert.ok(
      diagnostics.suggestions.sorter.some((suggestion) => {
        return Array.isArray(suggestion.config.noPenaltyResults) && !suggestion.config.noPenaltyResults.includes('CE');
      }),
    );
  });

  test('suggests enumerated no-penalty configs when NOUT should count as penalty', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 2 } }],
        sorter: {
          algorithm: 'ICPC',
          config: {
            noPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'CE', 'UKE', null],
          },
        },
        rows: [
          makeRow('u1', { value: 1, time: [50, 'min'] }, [
            {
              result: 'AC',
              time: [30, 'min'],
              tries: 2,
              solutions: [
                { result: 'NOUT', time: [5, 'min'] },
                { result: 'CE', time: [10, 'min'] },
                { result: 'AC', time: [30, 'min'] },
              ],
            },
          ]),
        ],
      }),
    );

    assert.ok(diagnostics.issues.some((issue) => issue.code === 'STATUS_SUMMARY_MISMATCH'));
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'PROBLEM_STATISTICS_MISMATCH'));
    assert.equal(diagnostics.correctness.checks.sorterConfig.details.baseline.statusSummaryMismatchCount, 1);
    assert.equal(diagnostics.correctness.checks.sorterConfig.details.baseline.problemStatisticsMismatchCount, 1);
    assert.deepEqual(Object.keys(diagnostics.suggestions.sorter[0].config), ['noPenaltyResults']);
    assert.deepEqual(diagnostics.suggestions.sorter[0].config.noPenaltyResults, ['FB', 'AC', '?', 'CE', 'UKE', null]);
    const suggestion = diagnostics.suggestions.sorter.find((item) => {
      return (
        Array.isArray(item.config.noPenaltyResults) &&
        JSON.stringify(item.config.noPenaltyResults) === JSON.stringify(['FB', 'AC', '?', 'CE', 'UKE', null])
      );
    });
    assert.ok(suggestion);
    assert.equal(suggestion.details.evaluation.statusSummaryMismatchCount, 0);
    assert.equal(suggestion.details.evaluation.problemStatisticsMismatchCount, 0);
    assert.equal(suggestion.details.evaluation.issueCount, 0);
    assert.ok(suggestion.resolvedIssues.includes('statusSummaries'));
    assert.ok(suggestion.resolvedIssues.includes('problemStatistics'));
    assert.ok(suggestion.resolvedIssues.includes('statusTries'));
    assert.equal(
      diagnostics.suggestions.sorter.every((item) => item.details.evaluation.issueCount < item.details.baseline.issueCount),
      true,
    );
  });

  test('accepts status summary times that are compatible with status precision', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 1, time: [550, 's'] }, [
            {
              result: 'AC',
              time: [550, 's'],
              tries: 1,
              solutions: [{ result: 'AC', time: [550843, 'ms'] }],
            },
          ]),
        ],
      }),
    );

    assert.equal(diagnostics.issues.some((issue) => issue.code === 'STATUS_SUMMARY_MISMATCH'), false);
    assert.equal(diagnostics.correctness.checks.statusSummaries.status, 'pass');
    assert.equal(diagnostics.correctness.checks.sorterConfig.status, 'pass');
  });

  test('detects status summary times that cannot be rounded down to status precision', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 1, time: [551, 's'] }, [
            {
              result: 'AC',
              time: [551, 's'],
              tries: 1,
              solutions: [{ result: 'AC', time: [550843, 'ms'] }],
            },
          ]),
        ],
      }),
    );

    const mismatch = diagnostics.issues.find((issue) => issue.code === 'STATUS_SUMMARY_MISMATCH');
    assert.ok(mismatch);
    assert.deepEqual(mismatch.details?.mismatchReasons, ['time']);
  });

  test('treats zero rejected status time placeholders as summary-compatible', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 0, time: [0, 'ms'] }, [
            {
              result: 'RJ',
              time: [0, 's'],
              tries: 1,
              solutions: [{ result: 'WA', time: [550843, 'ms'] }],
            },
          ]),
        ],
      }),
    );

    assert.equal(diagnostics.issues.some((issue) => issue.code === 'STATUS_SUMMARY_MISMATCH'), false);
    assert.equal(diagnostics.correctness.checks.statusSummaries.status, 'pass');
  });

  test('treats frozen solution results as no-penalty attempts for status summaries', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 0, time: [0, 'ms'] }, [
            {
              result: '?',
              tries: 0,
              solutions: [{ result: '?', time: [10, 'min'] }],
            },
          ]),
        ],
      }),
    );

    assert.equal(diagnostics.issues.some((issue) => issue.code === 'STATUS_SUMMARY_MISMATCH'), false);
  });

  test('marks partial sorter suggestions when other mismatches remain unresolved', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 2, time: [70, 'min'] }, [
            {
              result: 'AC',
              time: [30, 'min'],
              tries: 3,
              solutions: [
                { result: 'WA', time: [10, 'min'] },
                { result: 'CE', time: [20, 'min'] },
                { result: 'AC', time: [30, 'min'] },
              ],
            },
          ]),
        ],
      }),
    );

    const scoreMismatch = diagnostics.issues.find((issue) => issue.code === 'SCORE_MISMATCH');
    assert.ok(scoreMismatch);
    assert.deepEqual(scoreMismatch.details?.actual, { value: 2, time: [70, 'min'] });
    assert.deepEqual(scoreMismatch.details?.expected, { value: 1, time: [70 * 60 * 1000, 'ms'] });
    assert.equal(Object.prototype.hasOwnProperty.call(scoreMismatch.details, 'current'), false);
    const partialSuggestion = diagnostics.suggestions.sorter.find((suggestion) => {
      return Array.isArray(suggestion.config.noPenaltyResults) && !suggestion.config.noPenaltyResults.includes('CE');
    });
    assert.ok(partialSuggestion);
    assert.equal(partialSuggestion.details.evaluation.scoreMismatchCount, 1);
    assert.ok(partialSuggestion.details.evaluation.issueCount < partialSuggestion.details.baseline.issueCount);
    assert.notEqual(partialSuggestion.confidence, 'high');
  });

  test('suggests time rounding sorter repairs when score timing exposes a mismatch', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        sorter: {
          algorithm: 'ICPC',
          config: {
            timePrecision: 'min',
            timeRounding: 'floor',
          },
        },
        rows: [
          makeRow('u1', { value: 1, time: [180000, 'ms'] }, [
            {
              result: 'AC',
              time: [125, 's'],
              tries: 1,
              solutions: [{ result: 'AC', time: [125, 's'] }],
            },
          ]),
        ],
      }),
    );

    assert.ok(diagnostics.issues.some((issue) => issue.code === 'SORTER_CONFIG_MISMATCH'));
    assert.ok(diagnostics.suggestions.sorter.some((suggestion) => suggestion.config.timeRounding === 'ceil'));
  });

  test('detects non-tied row order mismatches', () => {
    assert.ok(
      issueCodes(
        makeRanklist({
          problems: [{ alias: 'A' }],
          rows: [
            makeRow('slow', { value: 1, time: [30, 'min'] }, [{ result: 'AC', time: [30, 'min'], tries: 1 }]),
            makeRow('fast', { value: 1, time: [20, 'min'] }, [{ result: 'AC', time: [20, 'min'], tries: 1 }]),
          ],
        }),
      ).includes('ROW_ORDER_MISMATCH'),
    );
  });

  test('does not suggest ranking-time sorter repairs for row-order-only mismatches', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('slow-original-first', { value: 1, time: [359, 'min'] }, [
            { result: 'AC', time: [359, 'min'], tries: 1 },
          ]),
          makeRow('fast-original-second', { value: 1, time: [301, 'min'] }, [
            { result: 'AC', time: [301, 'min'], tries: 1 },
          ]),
        ],
      }),
    );

    assert.ok(diagnostics.issues.some((issue) => issue.code === 'ROW_ORDER_MISMATCH'));
    assert.equal(diagnostics.issues.some((issue) => issue.code === 'SORTER_CONFIG_MISMATCH'), false);
    assert.equal(
      diagnostics.suggestions.sorter.some((suggestion) => {
        return 'rankingTimePrecision' in suggestion.config || 'rankingTimeRounding' in suggestion.config;
      }),
      false,
    );
  });

  test('ignores ranking-time config when checking row order', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        sorter: {
          algorithm: 'ICPC',
          config: {
            rankingTimePrecision: 'h',
            rankingTimeRounding: 'floor',
          },
        },
        rows: [
          makeRow('slow-original-first', { value: 1, time: [359, 'min'] }, [
            { result: 'AC', time: [359, 'min'], tries: 1 },
          ]),
          makeRow('fast-original-second', { value: 1, time: [301, 'min'] }, [
            { result: 'AC', time: [301, 'min'], tries: 1 },
          ]),
        ],
      }),
    );

    assert.ok(diagnostics.issues.some((issue) => issue.code === 'ROW_ORDER_MISMATCH'));
  });

  test('detects undeclared legacy and modern marker ids', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        markers: [{ id: 'girls', label: 'Girls', style: 'pink' }],
        rows: [
          makeRow('legacy', undefined, undefined, { marker: 'unknown' }),
          makeRow('modern', undefined, undefined, { markers: ['girls', 'vip'] }),
        ],
      }),
    );

    assert.deepEqual(
      diagnostics.issues
        .filter((issue) => issue.code === 'MARKER_UNDECLARED')
        .map((issue) => issue.details?.markerId)
        .sort(),
      ['unknown', 'vip'],
    );
  });

  test('honors modern markers precedence over deprecated marker', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        markers: [{ id: 'girls', label: 'Girls', style: 'pink' }],
        rows: [makeRow('modern', undefined, undefined, { marker: 'legacy-ignored', markers: ['girls'] })],
      }),
    );

    assert.equal(diagnostics.issues.some((issue) => issue.code === 'MARKER_UNDECLARED'), false);
  });

  test('detects undeclared ICPC series marker filters', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        markers: [{ id: 'girls', label: 'Girls', style: 'pink' }],
        series: [
          {
            title: 'VIP',
            rule: { preset: 'ICPC', options: { filter: { byMarker: 'vip' }, count: { value: [1] } } },
          },
        ],
      }),
    );

    assert.ok(
      diagnostics.issues.some((issue) => {
        return issue.code === 'MARKER_UNDECLARED' && issue.path === 'series[0].rule.options.filter.byMarker';
      }),
    );
  });

  test('emits correctness errors for status length mismatches', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }, { alias: 'B' }],
        rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null }])],
      }),
    );

    assert.ok(diagnostics.issues.some((issue) => issue.code === 'STATUSES_LENGTH_MISMATCH'));
    assert.equal(diagnostics.correctness.checks.statuses.status, 'fail');
  });

  test('reports invalid time durations without throwing', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        sorter: {
          algorithm: 'ICPC',
          config: {
            penalty: [-20, 'min'],
          },
        },
        rows: [
          makeRow('u1', { value: 1, time: [-10, 'min'] }, [
            {
              result: 'AC',
              time: [-5, 'min'],
              tries: 1,
              solutions: [{ result: 'AC', time: [-5, 'min'] }],
            },
          ]),
        ],
      }),
    );

    assert.ok(diagnostics.summary.precision.solutionTime.invalidCount > 0);
    assert.ok(diagnostics.issues.some((issue) => issue.code === 'TIME_DURATION_INVALID' && issue.path === 'rows[0].statuses[0].time'));
    assert.ok(
      diagnostics.issues.some((issue) => {
        return issue.code === 'TIME_DURATION_INVALID' && issue.path === 'sorter.config.penalty';
      }),
    );
  });

  test('detects first-blood conflicts from status summaries when solution histories are absent', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 1, time: [10, 'min'] }, [{ result: 'AC', time: [10, 'min'], tries: 1 }]),
          makeRow('u2', { value: 1, time: [20, 'min'] }, [{ result: 'FB', time: [20, 'min'], tries: 1 }]),
        ],
      }),
    );

    assert.ok(diagnostics.issues.some((issue) => issue.code === 'FIRST_BLOOD_CONFLICT' && issue.confidence === 'medium'));
    assert.deepEqual(diagnostics.suggestions.firstBlood, [
      {
        problemIndex: 0,
        problemAlias: 'A',
        userId: 'u1',
        rowIndex: 0,
        time: [10, 'min'],
      },
    ]);
  });

  test('does not mutate the input ranklist', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('slow', { value: 1, time: [30, 'min'] }, [{ result: 'AC', time: [30, 'min'], tries: 1 }]),
        makeRow('fast', { value: 1, time: [20, 'min'] }, [{ result: 'AC', time: [20, 'min'], tries: 1 }]),
      ],
    });
    const before = JSON.stringify(ranklist);

    diagnoseRanklist(ranklist);

    assert.equal(JSON.stringify(ranklist), before);
  });

  test('marks ICPC-specific correctness checks not applicable for non-ICPC sorters', () => {
    const diagnostics = diagnoseRanklist(
      makeRanklist({
        sorter: { algorithm: 'score', config: {} } as srk.Sorter,
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 0, time: [0, 'ms'] }, [
            {
              result: 'AC',
              time: [10, 'min'],
              tries: 1,
              solutions: [{ result: 'AC', time: [10, 'min'] }],
            },
          ]),
        ],
      }),
    );

    assert.equal(diagnostics.correctness.checks.firstBlood.status, 'notApplicable');
    assert.equal(diagnostics.correctness.checks.statusSummaries.status, 'notApplicable');
    assert.equal(diagnostics.correctness.checks.scores.status, 'notApplicable');
    assert.equal(diagnostics.correctness.checks.rowOrder.status, 'notApplicable');
    assert.equal(diagnostics.correctness.checks.sorterConfig.status, 'notApplicable');
    assert.equal(diagnostics.issues.some((issue) => issue.code === 'FIRST_BLOOD_MISSING'), false);
  });
});
