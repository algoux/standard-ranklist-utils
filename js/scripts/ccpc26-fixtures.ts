import type * as srk from '@algoux/standard-ranklist';
import { getCCPC26ProblemLayout, getCCPC26RowProblemOrder } from '../src/ccpc26';
import type { CCPC26ProblemLayout } from '../src/ccpc26';
import { filterSolutionsUntil, getSortedCalculatedRawSolutions, regenerateRanklistBySolutions } from '../src/ranklist';

function row(id: string, statuses: srk.RankProblemStatus[], value = 0, official?: boolean): srk.RanklistRow {
  return { user: { id, name: id, ...(official === undefined ? {} : { official }) }, score: { value }, statuses };
}

function baseRows(): srk.RanklistRow[] {
  return [
    row('a', [{ result: 'AC' }, { result: 'FB' }], 2),
    row('b', [{ result: 'FB' }, { result: null }], 1),
    row('c', [{ result: null }, { result: null }]),
    row('d', [{ result: null }, { result: null }]),
  ];
}

function ranklist(threshold: unknown, rows = baseRows(), problemCount = 2): srk.Ranklist {
  // Some cases deliberately exercise malformed runtime configuration, not only typed SRK.
  return {
    type: 'general',
    version: '0.3.14',
    contest: { title: 'CCPC26 contract', startAt: '2020-01-01T00:00:00Z', duration: [1, 'h'] },
    problems: Array.from({ length: problemCount }, (_, index) => ({ alias: `P${problemCount - index}` })),
    series: [],
    rows,
    sorter: {
      algorithm: 'ICPC',
      config: { extendedAlgorithms: [{ algorithm: 'CCPC26', config: { problemRevealAcceptedThreshold: threshold } }] },
    },
  } as srk.Ranklist;
}

function layoutCase(name: string, input: srk.Ranklist) {
  return { name, ranklist: input, expected: getCCPC26ProblemLayout(input) ?? null };
}

function orderCase(name: string, statuses: srk.RankProblemStatus[], layout?: CCPC26ProblemLayout) {
  const actualLayout = layout || {
    revealedProblemIndexes: [],
    hiddenProblemIndexes: statuses.map((_, index) => index),
  };
  return { name, statuses, layout: actualLayout, expected: getCCPC26RowProblemOrder(statuses, actualLayout) };
}

/** Small JSON-only inputs plus outputs from the JS behavior baseline. */
export function makeCCPC26ContractFixtures() {
  const layouts = [
    layoutCase('count-boundary-ac-and-fb', ranklist({ count: 2 })),
    layoutCase('count-not-reached', ranklist({ count: 3 })),
    layoutCase('ratio-default-floor', ranklist({ ratio: 0.6 })),
    layoutCase('ratio-ceil', ranklist({ ratio: 0.6, rounding: 'ceil' })),
    layoutCase('ratio-round-down', ranklist({ ratio: 0.6, rounding: 'round' })),
    layoutCase('ratio-round-half-up', ranklist({ ratio: 0.625, rounding: 'round' })),
    layoutCase('or-ratio-reveals', ranklist({ count: 3, ratio: 0.5 })),
    layoutCase('or-count-reveals', ranklist({ count: 1, ratio: 1 })),
    layoutCase('empty-threshold-no-defaults', ranklist({})),
    layoutCase('zero-count', ranklist({ count: 0 })),
    layoutCase('empty-denominator-zero-ratio-threshold', ranklist({ ratio: 0.2 }, [])),
    layoutCase('small-denominator-zero-ratio-threshold', ranklist({ ratio: 0.2 }, [row('idle', [])])),
    layoutCase('no-problems', ranklist({ count: 0 }, [], 0)),
    layoutCase('numeric-thresholds-only', ranklist({ count: true, ratio: '0.2' })),
    layoutCase('null-thresholds-ignored', ranklist({ count: null, ratio: null })),
    layoutCase('invalid-threshold-array', ranklist([])),
    layoutCase('invalid-threshold-null', ranklist(null)),
    layoutCase('round-just-below-half', ranklist({ ratio: 0.49999999999999994, rounding: 'round' }, [row('idle', [])])),
    layoutCase('round-negative-half', ranklist({ ratio: -0.5, rounding: 'round' }, [row('idle', [])])),
    layoutCase('finite-ratio-product-overflow', ranklist({ ratio: 1e308, rounding: 'round' })),
  ];

  const participants = [
    row('a', [{ result: 'AC', tries: 20 }], 1),
    row('b', [{ result: 'FB' }], 1),
    row('ce', [{ result: null, solutions: [{ result: 'CE', time: [1, 's'] }] }]),
    row('rejected', [{ result: 'RJ' }]),
    row('tries-only', [{ result: null, tries: 1 }]),
    row('idle', [{ result: null }]),
  ];
  for (const denominator of ['all', 'submitted', 'scored']) {
    layouts.push(layoutCase(`denominator-${denominator}`, ranklist({ ratio: 0.5, denominator }, participants)));
  }
  layouts.push(
    layoutCase(
      'scored-does-not-filter-numerator',
      ranklist({ ratio: 2, denominator: 'scored' }, [
        row('positive', [{ result: 'AC' }], 1),
        row('zero-score-ac', [{ result: 'FB' }]),
      ]),
    ),
  );
  const officialRows = [row('default-official', [{ result: 'AC' }], 1), row('guest', [{ result: 'FB' }], 1, false)];
  layouts.push(layoutCase('unofficial-included-by-default', ranklist({ count: 2 }, officialRows)));
  layouts.push(layoutCase('official-only-numerator', ranklist({ count: 2, includeOfficialOnly: true }, officialRows)));
  layouts.push(
    layoutCase(
      'official-only-denominator',
      ranklist({ ratio: 1, includeOfficialOnly: true }, [
        row('default-official', [{ result: 'AC' }], 1),
        row('guest-idle', [], 0, false),
      ]),
    ),
  );

  const staleStats = ranklist({ count: 2 });
  staleStats.problems.forEach((problem) => {
    problem.statistics = { accepted: 999, submitted: 1000 };
  });
  layouts.push(layoutCase('ignores-cached-statistics', staleStats));
  layouts.push(layoutCase('no-sorter', { ...ranklist({ count: 1 }), sorter: undefined }));
  layouts.push(layoutCase('score-sorter', { ...ranklist({ count: 1 }), sorter: { algorithm: 'score', config: {} } }));
  layouts.push(layoutCase('no-extension', { ...ranklist({ count: 1 }), sorter: { algorithm: 'ICPC', config: {} } }));
  const flat = ranklist({ count: 1 });
  if (flat.sorter?.algorithm === 'ICPC') {
    flat.sorter.config.extendedAlgorithms = [
      { algorithm: 'CCPC26', config: { count: 1, ratio: 0.2 } } as unknown as srk.SorterICPCExtendedAlgorithm,
    ];
  }
  layouts.push(layoutCase('legacy-flat-config-is-absent', flat));

  const replay = ranklist(
    { count: 2 },
    [
      row('a', [{ result: 'AC', solutions: [{ result: 'FB', time: [10, 's'] }] }], 1),
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
  const timeline = getSortedCalculatedRawSolutions(replay.rows);
  for (const [name, seconds] of [
    ['before', 19],
    ['at', 20],
    ['rewind', 19],
  ] as const) {
    layouts.push(
      layoutCase(
        `replay-${name}`,
        regenerateRanklistBySolutions(replay, filterSolutionsUntil(timeline, [seconds, 's'])),
      ),
    );
  }

  const first: srk.RankProblemStatus[] = [
    { result: null },
    { result: 'AC', time: [20, 's'] },
    { result: 'FB', time: [10, 's'] },
    { result: 'RJ', solutions: [{ result: 'WA', time: [40, 's'] }] },
    { result: null },
    { result: null },
    { result: null, solutions: [{ result: 'CE', time: [30, 's'] }] },
    { result: null },
  ];
  const sharedLayout = { revealedProblemIndexes: [0, 4, 5], hiddenProblemIndexes: [1, 2, 3, 6, 7] };
  const second = first.map((status) => ({ ...status }));
  second[1].time = [5, 's'];
  second[3].solutions = [{ result: 'WA', time: [1, 's'] }];
  const orders = [
    orderCase('shared-prefix-first-row', first, sharedLayout),
    orderCase('shared-prefix-second-row', second, sharedLayout),
    orderCase('accepted-summary-history-and-post-ac', [
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
    ]),
    orderCase('last-attempt-includes-nonpenalty-and-summary-only-without-history', [
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
    ]),
    orderCase(
      'mixed-units-ties-zero-unknown',
      [
        { result: 'AC', time: [1, 'min'] },
        { result: 'FB', time: [60, 's'] },
        { result: 'AC', time: [0, 'ms'] },
        { result: 'AC' },
        { result: 'RJ' },
        { result: 'RJ', time: [0, 's'] },
        { result: null },
      ],
      { revealedProblemIndexes: [], hiddenProblemIndexes: [6, 5, 4, 3, 2, 1, 0] },
    ),
    orderCase('invalid-summary-times-fall-back-or-remain-unknown', [
      { result: 'AC', time: [true, 's'] },
      { result: 'AC', time: ['0', 's'] },
      { result: 'AC', time: [null, 's'] },
      { result: 'AC', time: [-1, 's'], solutions: [{ result: 'AC', time: [10, 's'] }] },
      { result: 'FB', time: [1, 'week'] },
      { result: 'AC', time: [20, 's'] },
    ] as unknown as srk.RankProblemStatus[]),
    orderCase('invalid-history-never-uses-stale-summary', [
      {
        result: 'RJ',
        time: [0, 's'],
        solutions: [
          { result: 'CE', time: [true, 's'] },
          { result: 'WA', time: ['1', 's'] },
        ],
      },
      { result: 'RJ', time: [2, 's'] },
    ] as unknown as srk.RankProblemStatus[]),
    orderCase('summary-determines-accepted-group', [
      { result: 'RJ', solutions: [{ result: 'AC', time: [1, 's'] }] },
      { result: 'AC', time: [10, 's'] },
      { result: 'FB' },
    ]),
    orderCase('missing-statuses-retain-columns', [], { revealedProblemIndexes: [1], hiddenProblemIndexes: [0, 2, 3] }),
    orderCase('empty-layout', first, { revealedProblemIndexes: [], hiddenProblemIndexes: [] }),
    orderCase('revealed-prefix-is-copied', [], { revealedProblemIndexes: [2, 0, 1], hiddenProblemIndexes: [] }),
    orderCase('untouched-original-index-order', [{ result: null }, { result: null }], {
      revealedProblemIndexes: [],
      hiddenProblemIndexes: [3, 2, 1, 0],
    }),
  ];
  return { layouts, orders };
}
