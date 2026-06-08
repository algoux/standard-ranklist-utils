import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import {
  calculateProblemStatistics,
  canRegenerateRanklist,
  convertToStaticRanklist,
  filterSolutionsUntil,
  getSortedCalculatedRawSolutions,
  regenerateRanklistBySolutions,
  regenerateRowsByIncrementalSolutions,
  sortRows,
} from '../src/ranklist';
import type { CalculatedSolutionTetrad } from '../src/types';

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

describe('ranklist utilities', () => {
  test('canRegenerateRanklist checks supported versions and ICPC sorter', () => {
    assert.equal(canRegenerateRanklist(makeRanklist()), true);
    assert.equal(canRegenerateRanklist(makeRanklist({ version: '0.2.9' })), false);
    assert.equal(
      canRegenerateRanklist(makeRanklist({ sorter: { algorithm: 'score', config: {} } as srk.Sorter })),
      false,
    );
    assert.equal(canRegenerateRanklist(makeRanklist({ version: 'not-semver' })), false);
  });

  test('getSortedCalculatedRawSolutions extracts detailed and summarized solutions by time', () => {
    const rows = [
      makeRow('u1', undefined, [
        { result: 'AC', time: [2, 'min'], tries: 3 },
        {
          result: null,
          solutions: [
            { result: 'WA', time: [30, 's'] },
            { result: 'AC', time: [60, 's'] },
          ],
        },
      ]),
    ];

    assert.deepEqual(getSortedCalculatedRawSolutions(rows), [
      ['u1', 1, 'WA', [30, 's']],
      ['u1', 1, 'AC', [60, 's']],
      ['u1', 0, 'RJ', [2, 'min']],
      ['u1', 0, 'RJ', [2, 'min']],
      ['u1', 0, 'AC', [2, 'min']],
    ]);
  });

  test('filterSolutionsUntil returns the sorted prefix at or before the given time', () => {
    const solutions: CalculatedSolutionTetrad[] = [
      ['u1', 0, 'WA', [10, 's']],
      ['u1', 0, 'AC', [1, 'min']],
      ['u2', 0, 'AC', [2, 'min']],
    ];

    assert.deepEqual(filterSolutionsUntil(solutions, [60, 's']), solutions.slice(0, 2));
    assert.deepEqual(filterSolutionsUntil(solutions, [5, 's']), []);
  });

  test('sortRows sorts by solved count descending and penalty time ascending in place', () => {
    const rows = [
      makeRow('slow', { value: 1, time: [30, 'min'] }),
      makeRow('fast', { value: 1, time: [20, 'min'] }),
      makeRow('solved-more', { value: 2, time: [90, 'min'] }),
    ];

    const sorted = sortRows(rows);

    assert.equal(sorted, rows);
    assert.deepEqual(
      rows.map((row) => row.user.id),
      ['solved-more', 'fast', 'slow'],
    );
  });

  test('calculateProblemStatistics counts accepted and submitted statuses per problem', () => {
    const ranklist = makeRanklist({
      rows: [
        makeRow('u1', undefined, [
          {
            result: 'AC',
            tries: 2,
            solutions: [
              { result: 'WA', time: [10, 'min'] },
              { result: 'CE', time: [20, 'min'] },
              { result: 'AC', time: [30, 'min'] },
            ],
          },
          {
            result: 'RJ',
            tries: 3,
            solutions: [
              { result: 'WA', time: [10, 'min'] },
              { result: 'OLE', time: [20, 'min'] },
              { result: 'WA', time: [30, 'min'] },
            ],
          },
        ]),
        makeRow('u2', undefined, [
          { result: 'FB', tries: 1 },
          { result: 'RJ', tries: 10 },
        ]),
      ],
    });

    assert.deepEqual(calculateProblemStatistics(ranklist), [
      { accepted: 2, submitted: 3 },
      { accepted: 0, submitted: 13 },
    ]);
  });

  test('calculateProblemStatistics treats solution history after first AC as read-only rendering data', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', undefined, [
          {
            result: 'AC',
            tries: 2,
            solutions: [
              { result: 'WA', time: [10, 'min'] },
              { result: 'AC', time: [20, 'min'] },
              { result: 'WA', time: [30, 'min'] },
              { result: 'FB', time: [40, 'min'] },
            ],
          },
        ]),
      ],
    });

    assert.deepEqual(calculateProblemStatistics(ranklist), [{ accepted: 1, submitted: 2 }]);
  });

  test('regenerateRanklistBySolutions rebuilds rows, scores, and problem statistics from submissions', () => {
    const originalRanklist = makeRanklist({
      rows: [
        makeRow('u1'),
        makeRow('u2'),
        makeRow('u3', { value: 0, time: [0, 'ms'] }, undefined, { official: false }),
      ],
      problems: [{ alias: 'A', statistics: { accepted: 0, submitted: 0 } }, { alias: 'B' }],
    });
    const solutions: CalculatedSolutionTetrad[] = [
      ['u1', 0, 'WA', [10, 'min']],
      ['u1', 0, 'CE', [15, 'min']],
      ['u3', 0, 'AC', [20, 'min']],
      ['u2', 0, 'AC', [30, 'min']],
      ['u1', 0, 'AC', [50, 'min']],
      ['u2', 1, 'WA', [100, 'min']],
      ['u1', 1, 'AC', [120, 'min']],
    ];

    const regenerated = regenerateRanklistBySolutions(originalRanklist, solutions);

    assert.deepEqual(
      regenerated.rows.map((row) => row.user.id),
      ['u1', 'u3', 'u2'],
    );
    assert.deepEqual(regenerated.rows[0].score, { value: 2, time: [11400000, 'ms'] });
    assert.deepEqual(regenerated.rows[0].statuses[0], {
      result: 'AC',
      solutions: [
        { result: 'WA', time: [10, 'min'] },
        { result: 'CE', time: [15, 'min'] },
        { result: 'AC', time: [50, 'min'] },
      ],
      tries: 2,
      time: [50, 'min'],
    });
    assert.deepEqual(regenerated.problems[0].statistics, { accepted: 3, submitted: 4 });
    assert.deepEqual(regenerated.problems[1].statistics, { accepted: 1, submitted: 2 });
    assert.deepEqual(originalRanklist.rows[0].statuses[0], { result: null, solutions: [] });
  });

  test('regenerateRanklistBySolutions excludes default no-penalty results from effective tries and submitted statistics', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
    });
    const solutions: CalculatedSolutionTetrad[] = [
      ['u1', 0, 'WA', [10, 'min']],
      ['u1', 0, 'CE', [15, 'min']],
      ['u1', 0, 'WA', [20, 'min']],
      ['u1', 0, '?', [25, 'min']],
      ['u1', 0, 'AC', [30, 'min']],
    ];

    const regenerated = regenerateRanklistBySolutions(originalRanklist, solutions);

    assert.deepEqual(regenerated.rows[0].score, { value: 1, time: [5400000, 'ms'] });
    assert.deepEqual(regenerated.rows[0].statuses[0], {
      result: 'AC',
      solutions: [
        { result: 'WA', time: [10, 'min'] },
        { result: 'CE', time: [15, 'min'] },
        { result: 'WA', time: [20, 'min'] },
        { result: '?', time: [25, 'min'] },
        { result: 'AC', time: [30, 'min'] },
      ],
      tries: 4,
      time: [30, 'min'],
    });
    assert.deepEqual(regenerated.problems[0].statistics, { accepted: 1, submitted: 4 });
  });

  test('regenerateRanklistBySolutions counts unknown results as submitted tries before any accepted solution', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
    });
    const solutions: CalculatedSolutionTetrad[] = [
      ['u1', 0, 'WA', [1, 'min']],
      ['u1', 0, 'CE', [2, 'min']],
      ['u1', 0, 'NOUT', [3, 'min']],
      ['u1', 0, 'UKE', [4, 'min']],
      ['u1', 0, 'WA', [5, 'min']],
      ['u1', 0, '?', [6, 'min']],
      ['u1', 0, '?', [7, 'min']],
      ['u1', 0, '?', [8, 'min']],
    ];

    const regenerated = regenerateRanklistBySolutions(originalRanklist, solutions);

    assert.deepEqual(regenerated.rows[0].score, { value: 0, time: [0, 'ms'] });
    assert.deepEqual(regenerated.rows[0].statuses[0], {
      result: '?',
      solutions: [
        { result: 'WA', time: [1, 'min'] },
        { result: 'CE', time: [2, 'min'] },
        { result: 'NOUT', time: [3, 'min'] },
        { result: 'UKE', time: [4, 'min'] },
        { result: 'WA', time: [5, 'min'] },
        { result: '?', time: [6, 'min'] },
        { result: '?', time: [7, 'min'] },
        { result: '?', time: [8, 'min'] },
      ],
      tries: 5,
    });
    assert.deepEqual(regenerated.problems[0].statistics, { accepted: 0, submitted: 5 });
  });

  test('regenerateRanklistBySolutions honors custom noPenaltyResults when scoring tries', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
      sorter: {
        algorithm: 'ICPC',
        config: {
          noPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'UKE', null],
        },
      },
    });
    const solutions: CalculatedSolutionTetrad[] = [
      ['u1', 0, 'CE', [10, 'min']],
      ['u1', 0, 'AC', [30, 'min']],
    ];

    const regenerated = regenerateRanklistBySolutions(originalRanklist, solutions);

    assert.deepEqual(regenerated.rows[0].score, { value: 1, time: [3000000, 'ms'] });
    assert.equal(regenerated.rows[0].statuses[0].tries, 2);
    assert.deepEqual(regenerated.problems[0].statistics, { accepted: 1, submitted: 2 });
  });

  test('regenerateRanklistBySolutions keeps submissions after first AC for rendering but excludes them from scoring and statistics', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
    });
    const solutions: CalculatedSolutionTetrad[] = [
      ['u1', 0, 'WA', [10, 'min']],
      ['u1', 0, 'AC', [20, 'min']],
      ['u1', 0, 'WA', [30, 'min']],
      ['u1', 0, 'FB', [40, 'min']],
    ];

    const regenerated = regenerateRanklistBySolutions(originalRanklist, solutions);

    assert.deepEqual(regenerated.rows[0].score, { value: 1, time: [2400000, 'ms'] });
    assert.deepEqual(regenerated.rows[0].statuses[0], {
      result: 'AC',
      solutions: [
        { result: 'WA', time: [10, 'min'] },
        { result: 'AC', time: [20, 'min'] },
        { result: 'WA', time: [30, 'min'] },
        { result: 'FB', time: [40, 'min'] },
      ],
      tries: 2,
      time: [20, 'min'],
    });
    assert.deepEqual(regenerated.problems[0].statistics, { accepted: 1, submitted: 2 });
  });

  test('regenerateRanklistBySolutions applies timePrecision and timeRounding before penalty calculation', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
      sorter: {
        algorithm: 'ICPC',
        config: {
          timePrecision: 'min',
          timeRounding: 'ceil',
        },
      },
    });

    const regenerated = regenerateRanklistBySolutions(originalRanklist, [['u1', 0, 'AC', [125, 's']]]);

    assert.deepEqual(regenerated.rows[0].score, { value: 1, time: [180000, 'ms'] });
  });

  test('regenerateRanklistBySolutions sorts rows using ranking time precision when configured', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('slow-original-first', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }]),
        makeRow('fast-original-second', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }]),
      ],
      sorter: {
        algorithm: 'ICPC',
        config: {
          rankingTimePrecision: 'h',
          rankingTimeRounding: 'floor',
        },
      },
    });
    const solutions: CalculatedSolutionTetrad[] = [
      ['slow-original-first', 0, 'AC', [359, 'min']],
      ['fast-original-second', 0, 'AC', [301, 'min']],
    ];

    const regenerated = regenerateRanklistBySolutions(originalRanklist, solutions);

    assert.deepEqual(
      regenerated.rows.map((row) => row.user.id),
      ['slow-original-first', 'fast-original-second'],
    );
  });

  test('regenerateRowsByIncrementalSolutions applies submissions without mutating the original rows', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }]),
        makeRow('u2', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }]),
      ],
    });
    const solutions: CalculatedSolutionTetrad[] = [
      ['u1', 0, 'WA', [10, 'min']],
      ['u1', 0, 'CE', [15, 'min']],
      ['u2', 0, 'AC', [20, 'min']],
      ['u1', 0, 'AC', [35, 'min']],
    ];

    const regeneratedRows = regenerateRowsByIncrementalSolutions(originalRanklist, solutions);

    assert.deepEqual(
      regeneratedRows.map((row) => row.user.id),
      ['u2', 'u1'],
    );
    assert.deepEqual(regeneratedRows[1].score, { value: 1, time: [3300000, 'ms'] });
    assert.deepEqual(regeneratedRows[1].statuses[0], {
      result: 'AC',
      solutions: [
        { result: 'WA', time: [10, 'min'] },
        { result: 'CE', time: [15, 'min'] },
        { result: 'AC', time: [35, 'min'] },
      ],
      tries: 2,
      time: [35, 'min'],
    });
    assert.deepEqual(originalRanklist.rows[0].statuses[0], { result: null, solutions: [] });
  });

  test('regenerateRowsByIncrementalSolutions records submissions after AC without changing solved score', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [
        makeRow('u1', { value: 1, time: [20, 'min'] }, [
          { result: 'AC', time: [20, 'min'], tries: 1, solutions: [{ result: 'AC', time: [20, 'min'] }] },
        ]),
      ],
    });

    const regeneratedRows = regenerateRowsByIncrementalSolutions(originalRanklist, [
      ['u1', 0, 'WA', [30, 'min']],
      ['u1', 0, 'AC', [40, 'min']],
    ]);

    assert.deepEqual(regeneratedRows[0].score, { value: 1, time: [20, 'min'] });
    assert.deepEqual(regeneratedRows[0].statuses[0], {
      result: 'AC',
      time: [20, 'min'],
      tries: 1,
      solutions: [
        { result: 'AC', time: [20, 'min'] },
        { result: 'WA', time: [30, 'min'] },
        { result: 'AC', time: [40, 'min'] },
      ],
    });
  });

  test('regenerateRowsByIncrementalSolutions counts unknown results as submitted tries', () => {
    const originalRanklist = makeRanklist({
      problems: [{ alias: 'A' }],
      rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
    });

    const regeneratedRows = regenerateRowsByIncrementalSolutions(originalRanklist, [
      ['u1', 0, 'WA', [1, 'min']],
      ['u1', 0, 'CE', [2, 'min']],
      ['u1', 0, 'NOUT', [3, 'min']],
      ['u1', 0, 'UKE', [4, 'min']],
      ['u1', 0, 'WA', [5, 'min']],
      ['u1', 0, '?', [6, 'min']],
      ['u1', 0, '?', [7, 'min']],
      ['u1', 0, '?', [8, 'min']],
    ]);

    assert.deepEqual(regeneratedRows[0].score, { value: 0, time: [0, 'ms'] });
    assert.deepEqual(regeneratedRows[0].statuses[0], {
      result: '?',
      solutions: [
        { result: 'WA', time: [1, 'min'] },
        { result: 'CE', time: [2, 'min'] },
        { result: 'NOUT', time: [3, 'min'] },
        { result: 'UKE', time: [4, 'min'] },
        { result: 'WA', time: [5, 'min'] },
        { result: '?', time: [6, 'min'] },
        { result: '?', time: [7, 'min'] },
        { result: '?', time: [8, 'min'] },
      ],
      tries: 5,
    });
  });

  test('convertToStaticRanklist calculates rank values for Normal, UniqByUserField, and ICPC series', () => {
    const ranklist = makeRanklist({
      series: [
        { title: 'Overall', rule: { preset: 'Normal' } },
        { title: 'Official', rule: { preset: 'Normal', options: { includeOfficialOnly: true } } },
        { title: 'School', rule: { preset: 'UniqByUserField', options: { field: 'organization' } } },
        {
          title: 'Medals',
          segments: [{ title: 'Gold' }, { title: 'Silver' }],
          rule: { preset: 'ICPC', options: { count: { value: [1, 1], noTied: true } } },
        },
      ],
      rows: [
        makeRow('u1', { value: 2, time: [100, 'min'] }, undefined, { organization: 'School A' }),
        makeRow('u2', { value: 2, time: [100, 'min'] }, undefined, { organization: 'School A' }),
        makeRow('u3', { value: 1, time: [50, 'min'] }, undefined, {
          organization: 'School B',
          official: false,
        }),
        makeRow('u4', { value: 1, time: [60, 'min'] }, undefined, { organization: 'School B' }),
      ],
    });

    const staticRanklist = convertToStaticRanklist(ranklist);

    assert.deepEqual(
      staticRanklist.rows.map((row) => row.rankValues),
      [
        [
          { rank: 1, segmentIndex: null },
          { rank: 1, segmentIndex: null },
          { rank: 1, segmentIndex: null },
          { rank: 1, segmentIndex: 0 },
        ],
        [
          { rank: 1, segmentIndex: null },
          { rank: 1, segmentIndex: null },
          { rank: null, segmentIndex: null },
          { rank: 1, segmentIndex: 1 },
        ],
        [
          { rank: 3, segmentIndex: null },
          { rank: null, segmentIndex: null },
          { rank: 2, segmentIndex: null },
          { rank: null, segmentIndex: null },
        ],
        [
          { rank: 4, segmentIndex: null },
          { rank: 3, segmentIndex: null },
          { rank: null, segmentIndex: null },
          { rank: 3, segmentIndex: null },
        ],
      ],
    );
  });

  test('convertToStaticRanklist applies ICPC marker filters with markers precedence over marker', () => {
    const ranklist = makeRanklist({
      series: [
        {
          title: 'Girls',
          segments: [{ title: 'Gold' }, { title: 'Silver' }],
          rule: { preset: 'ICPC', options: { filter: { byMarker: 'girls' }, count: { value: [1, 1] } } },
        },
      ],
      rows: [
        makeRow('modern-marker', { value: 3, time: [10, 'min'] }, undefined, { markers: ['girls'] }),
        makeRow('empty-modern-marker', { value: 2, time: [20, 'min'] }, undefined, {
          marker: 'girls',
          markers: [],
        }),
        makeRow('legacy-marker', { value: 1, time: [30, 'min'] }, undefined, { marker: 'girls' }),
      ],
    });

    const staticRanklist = convertToStaticRanklist(ranklist);

    assert.deepEqual(
      staticRanklist.rows.map((row) => row.rankValues[0]),
      [
        { rank: 1, segmentIndex: 0 },
        { rank: null, segmentIndex: null },
        { rank: 2, segmentIndex: 1 },
      ],
    );
  });

  test('convertToStaticRanklist treats invalid user-field filters as non-matching', () => {
    const ranklist = makeRanklist({
      series: [
        {
          title: 'Invalid filter',
          segments: [{ title: 'Gold' }],
          rule: {
            preset: 'ICPC',
            options: {
              filter: { byUserFields: [{ field: 'organization', rule: '(' }] },
              count: { value: [1] },
            },
          },
        },
      ],
      rows: [makeRow('u1', { value: 1, time: [10, 'min'] }, undefined, { organization: 'SDUT' })],
    });

    const originalWarn = console.warn;
    try {
      console.warn = () => {};
      assert.deepEqual(convertToStaticRanklist(ranklist).rows[0].rankValues[0], {
        rank: null,
        segmentIndex: null,
      });
    } finally {
      console.warn = originalWarn;
    }
  });
});
