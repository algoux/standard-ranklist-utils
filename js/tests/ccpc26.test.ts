import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import { getCCPC26ProblemLayout, getCCPC26RowProblemOrder } from '../src/ccpc26';
import type { CCPC26ProblemLayout } from '../src/ccpc26';
import { filterSolutionsUntil, getSortedCalculatedRawSolutions, regenerateRanklistBySolutions } from '../src/ranklist';

type Threshold = srk.SorterICPCExtendedAlgorithmCCPC26['config']['problemRevealAcceptedThreshold'];

function row(id: string, statuses: srk.RankProblemStatus[], score = 0, official?: boolean): srk.RanklistRow {
  return { user: { id, name: id, official }, statuses, score: { value: score } };
}

function ranklist(threshold: Threshold, rows: srk.RanklistRow[] = [], problemCount = 2): srk.Ranklist {
  return {
    type: 'general',
    version: '0.3.14',
    contest: { title: 'CCPC26 fixture', startAt: '2026-01-01T00:00:00Z', duration: [5, 'h'] },
    problems: Array.from({ length: problemCount }, (_, index) => ({ alias: `P${problemCount - index}` })),
    series: [],
    rows,
    sorter: {
      algorithm: 'ICPC',
      config: { extendedAlgorithms: [{ algorithm: 'CCPC26', config: { problemRevealAcceptedThreshold: threshold } }] },
    },
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

const acceptedRows = () => [
  row('a', [{ result: 'AC' }, { result: 'FB' }], 2),
  row('b', [{ result: 'FB' }, { result: null }], 1),
  row('c', [{ result: null }, { result: null }]),
  row('d', [{ result: null }, { result: null }]),
];

describe('CCPC26 problem layout', () => {
  test('only recognizes standard ICPC extended-algorithm configuration', () => {
    const data = ranklist({ count: 1 });
    assert.deepEqual(getCCPC26ProblemLayout(data), { revealedProblemIndexes: [], hiddenProblemIndexes: [0, 1] });
    assert.equal(getCCPC26ProblemLayout({ ...data, sorter: undefined }), undefined);
    assert.equal(getCCPC26ProblemLayout({ ...data, sorter: { algorithm: 'score', config: {} } }), undefined);
    assert.equal(getCCPC26ProblemLayout({ ...data, sorter: { algorithm: 'ICPC', config: {} } }), undefined);
    const flat = {
      algorithm: 'CCPC26',
      config: { count: 50, ratio: 0.2 },
    } as unknown as srk.SorterICPCExtendedAlgorithm;
    assert.equal(
      getCCPC26ProblemLayout({ ...data, sorter: { algorithm: 'ICPC', config: { extendedAlgorithms: [flat] } } }),
      undefined,
    );
  });

  test('counts AC and FB users and combines configured thresholds with OR', () => {
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ count: 2 }, acceptedRows())), {
      revealedProblemIndexes: [0],
      hiddenProblemIndexes: [1],
    });
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ count: 3 }, acceptedRows()))?.revealedProblemIndexes, []);
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ count: 3, ratio: 0.5 }, acceptedRows()))?.revealedProblemIndexes,
      [0],
    );
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ count: 1, ratio: 1 }, acceptedRows()))?.revealedProblemIndexes,
      [0, 1],
    );
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({}, acceptedRows()))?.revealedProblemIndexes, []);
  });

  test('defaults to all users and floor rounding and supports ceil and round', () => {
    const rows = acceptedRows();
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ ratio: 0.6 }, rows))?.revealedProblemIndexes, [0]);
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 0.6, rounding: 'ceil' }, rows))?.revealedProblemIndexes,
      [],
    );
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 0.6, rounding: 'round' }, rows))?.revealedProblemIndexes,
      [0],
    );
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 0.7, rounding: 'round' }, rows))?.revealedProblemIndexes,
      [],
    );
  });

  test('applies zero thresholds literally, including a ratio with an empty denominator', () => {
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ count: 0 }))?.revealedProblemIndexes, [0, 1]);
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ ratio: 0.2 }))?.revealedProblemIndexes, [0, 1]);
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ ratio: 0.2 }, [row('a', [])]))?.revealedProblemIndexes, [0, 1]);
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ count: 0 }, [], 0)), {
      revealedProblemIndexes: [],
      hiddenProblemIndexes: [],
    });
  });

  test('submitted denominator counts teams, including CE-only and summary-only submissions', () => {
    const rows = [
      row('a', [{ result: 'AC', tries: 7 }], 1),
      row('b', [{ result: 'AC' }], 1),
      row('ce', [{ result: null, solutions: [{ result: 'CE', time: [10, 's'] }] }]),
      row('idle', [{ result: null }]),
    ];
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ ratio: 0.75 }, rows))?.revealedProblemIndexes, []);
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 0.75, denominator: 'submitted' }, rows))?.revealedProblemIndexes,
      [0],
    );
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 1, denominator: 'submitted' }, rows))?.revealedProblemIndexes,
      [],
    );
    rows[2] = row('summary', [{ result: 'RJ' }]);
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 1, denominator: 'submitted' }, rows))?.revealedProblemIndexes,
      [],
    );
    rows[2] = row('tries-only', [{ result: null, tries: 1 }]);
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 1, denominator: 'submitted' }, rows))?.revealedProblemIndexes,
      [],
    );
  });

  test('scored denominator uses positive row scores without filtering the accepted numerator', () => {
    const rows = [row('a', [{ result: 'AC' }], 1), row('b', [{ result: 'AC' }], 0), row('idle', [], 0)];
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 2, denominator: 'scored' }, rows))?.revealedProblemIndexes,
      [0],
    );
    rows.push(row('positive', [], 3));
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 2, denominator: 'scored' }, rows))?.revealedProblemIndexes,
      [],
    );
  });

  test('official-only filters both counts and denominator while undefined official means true', () => {
    const rows = [row('a', [{ result: 'AC' }], 1), row('guest', [{ result: 'FB' }], 1, false)];
    assert.deepEqual(getCCPC26ProblemLayout(ranklist({ count: 2 }, rows))?.revealedProblemIndexes, [0]);
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ count: 2, includeOfficialOnly: true }, rows))?.revealedProblemIndexes,
      [],
    );
    assert.deepEqual(
      getCCPC26ProblemLayout(ranklist({ ratio: 1, includeOfficialOnly: true }, rows))?.revealedProblemIndexes,
      [0],
    );
  });

  test('uses current rows instead of declared problem statistics and preserves original index order', () => {
    const data = ranklist({ count: 1 }, [row('a', [{ result: 'AC' }, { result: null }, { result: 'AC' }])], 3);
    data.problems[1].statistics = { accepted: 100, submitted: 100 };
    assert.deepEqual(getCCPC26ProblemLayout(data), { revealedProblemIndexes: [0, 2], hiddenProblemIndexes: [1] });
  });

  test('works with regenerated timeline slices, including reverse travel across a reveal boundary', () => {
    const data = ranklist(
      { count: 2 },
      [
        row('a', [{ result: 'AC', solutions: [{ result: 'AC', time: [10, 's'] }] }], 1),
        row(
          'b',
          [
            {
              result: 'AC',
              solutions: [
                { result: 'WA', time: [5, 's'] },
                { result: 'AC', time: [20, 's'] },
              ],
            },
          ],
          1,
        ),
      ],
      1,
    );
    const solutions = getSortedCalculatedRawSolutions(data.rows);
    for (const [seconds, revealed] of [
      [19, []],
      [20, [0]],
      [19, []],
    ] as Array<[number, number[]]>) {
      const sliced = regenerateRanklistBySolutions(data, filterSolutionsUntil(solutions, [seconds, 's']));
      assert.deepEqual(getCCPC26ProblemLayout(sliced)?.revealedProblemIndexes, revealed);
    }
  });
});

describe('CCPC26 per-row problem order', () => {
  test('keeps the shared revealed prefix and gives different rows their own accepted/attempted suffix', () => {
    const layout: CCPC26ProblemLayout = { revealedProblemIndexes: [0, 4, 5], hiddenProblemIndexes: [1, 2, 3, 6, 7] };
    const first: srk.RankProblemStatus[] = [
      { result: null },
      { result: 'AC', time: [20, 's'] },
      { result: 'FB', time: [10, 's'] },
      { result: 'RJ', solutions: [{ result: 'WA', time: [40, 's'] }] },
      { result: null },
      { result: null },
      { result: 'RJ', solutions: [{ result: 'WA', time: [30, 's'] }] },
      { result: null },
    ];
    assert.deepEqual(getCCPC26RowProblemOrder(first, layout), [0, 4, 5, 2, 1, 6, 3, 7]);
    const second = first.map((status) => ({ ...status }));
    second[1].time = [5, 's'];
    second[3].solutions = [{ result: 'WA', time: [1, 's'] }];
    assert.deepEqual(getCCPC26RowProblemOrder(second, layout), [0, 4, 5, 1, 2, 3, 6, 7]);
  });

  test('accepted summaries take precedence, fall back to first accepted history, and ignore post-AC attempts', () => {
    const statuses: srk.RankProblemStatus[] = [
      { result: 'AC', time: [40, 's'], solutions: [{ result: 'AC', time: [1, 's'] }] },
      {
        result: 'FB',
        solutions: [
          { result: 'WA', time: [1, 's'] },
          { result: 'AC', time: [20, 's'] },
          { result: 'FB', time: [30, 's'] },
          { result: 'WA', time: [100, 's'] },
        ],
      },
      { result: 'AC', time: [0, 's'] },
      { result: 'AC' },
    ];
    assert.deepEqual(
      getCCPC26RowProblemOrder(statuses, { revealedProblemIndexes: [], hiddenProblemIndexes: [0, 1, 2, 3] }),
      [2, 1, 0, 3],
    );
  });

  test('attempts use latest detailed submission including no-penalty results and only fall back without history', () => {
    const statuses: srk.RankProblemStatus[] = [
      {
        result: 'RJ',
        time: [0, 's'],
        solutions: [
          { result: 'WA', time: [2, 's'] },
          { result: 'CE', time: [60, 's'] },
        ],
      },
      { result: 'RJ', time: [40, 's'] },
      {
        result: null,
        solutions: [
          { result: 'NOUT', time: [20, 's'] },
          { result: 'UKE', time: [30, 's'] },
        ],
      },
      { result: '?', time: [10, 's'], solutions: [] },
      { result: 'RJ', time: [0, 's'], solutions: [{ result: 'WA', time: [-1, 's'] }] },
      { result: 'RJ' },
      { result: null },
    ];
    assert.deepEqual(
      getCCPC26RowProblemOrder(statuses, { revealedProblemIndexes: [], hiddenProblemIndexes: [0, 1, 2, 3, 4, 5, 6] }),
      [3, 2, 1, 0, 4, 5, 6],
    );
  });

  test('compares mixed units, keeps zero times, and breaks equal or missing times by original index', () => {
    const statuses: srk.RankProblemStatus[] = [
      { result: 'AC', time: [1, 'min'] },
      { result: 'AC', time: [60, 's'] },
      { result: 'AC', time: [0, 'ms'] },
      { result: 'FB' },
      { result: 'AC', time: [Number.NaN, 's'] },
      { result: 'RJ' },
      { result: 'RJ', time: [0, 's'] },
      { result: null },
    ];
    assert.deepEqual(
      getCCPC26RowProblemOrder(statuses, {
        revealedProblemIndexes: [],
        hiddenProblemIndexes: [7, 6, 5, 4, 3, 2, 1, 0],
      }),
      [2, 0, 1, 3, 4, 6, 5, 7],
    );
  });

  test('keeps columns for missing statuses and does not mutate frozen inputs', () => {
    const data = freezeDeep(
      ranklist({ count: 1 }, [row('a', [{ result: null }, { result: 'AC', time: [1, 's'] }])], 4),
    );
    const before = JSON.stringify(data);
    const layout = freezeDeep(getCCPC26ProblemLayout(data)!);
    assert.deepEqual(layout, { revealedProblemIndexes: [1], hiddenProblemIndexes: [0, 2, 3] });
    const order = getCCPC26RowProblemOrder(data.rows[0].statuses, layout);
    assert.deepEqual(order, [1, 0, 2, 3]);
    assert.equal(new Set(order).size, data.problems.length);
    assert.equal(JSON.stringify(data), before);
    assert.deepEqual(getCCPC26RowProblemOrder([], layout), [1, 0, 2, 3]);
    assert.deepEqual(getCCPC26RowProblemOrder([], { revealedProblemIndexes: [], hiddenProblemIndexes: [] }), []);
  });
});
