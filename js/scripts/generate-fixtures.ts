import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as srk from '@algoux/standard-ranklist';
import {
  EnumTheme,
  MIN_REGEN_SUPPORTED_VERSION,
  alphabetToNumber,
  convertToStaticRanklist,
  formatTimeDuration,
  numberToAlphabet,
  preZeroFill,
  regenerateRanklistBySolutions,
  regenerateRowsByIncrementalSolutions,
  resolveColor,
  resolveContributor,
  resolveStyle,
  resolveText,
  resolveThemeColor,
  resolveUserMarkers,
  secToTimeStr,
  sortRows,
} from '../src';
import type { CalculatedSolutionTetrad } from '../src';
import packageJson from '../package.json';

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

const regenerationInput = makeRanklist({
  rows: [
    makeRow('u1'),
    makeRow('u2'),
    makeRow('u3', { value: 0, time: [0, 'ms'] }, undefined, { official: false }),
  ],
  problems: [{ alias: 'A', statistics: { accepted: 0, submitted: 0 } }, { alias: 'B' }],
});
const regenerationSolutions: CalculatedSolutionTetrad[] = [
  ['u1', 0, 'WA', [10, 'min']],
  ['u1', 0, 'CE', [15, 'min']],
  ['u3', 0, 'AC', [20, 'min']],
  ['u2', 0, 'AC', [30, 'min']],
  ['u1', 0, 'AC', [50, 'min']],
  ['u2', 1, 'WA', [100, 'min']],
  ['u1', 1, 'AC', [120, 'min']],
];

const defaultNoPenaltyInput = makeRanklist({
  problems: [{ alias: 'A' }],
  rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
});
const defaultNoPenaltySolutions: CalculatedSolutionTetrad[] = [
  ['u1', 0, 'WA', [10, 'min']],
  ['u1', 0, 'CE', [15, 'min']],
  ['u1', 0, 'WA', [20, 'min']],
  ['u1', 0, '?', [25, 'min']],
  ['u1', 0, 'AC', [30, 'min']],
];

const customNoPenaltyInput = makeRanklist({
  problems: [{ alias: 'A' }],
  rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
  sorter: {
    algorithm: 'ICPC',
    config: {
      noPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'UKE', null],
    },
  },
});

const postAcInput = makeRanklist({
  problems: [{ alias: 'A' }],
  rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
});
const postAcSolutions: CalculatedSolutionTetrad[] = [
  ['u1', 0, 'WA', [10, 'min']],
  ['u1', 0, 'AC', [20, 'min']],
  ['u1', 0, 'WA', [30, 'min']],
  ['u1', 0, 'FB', [40, 'min']],
];

const incrementalInput = makeRanklist({
  problems: [{ alias: 'A' }],
  rows: [
    makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }]),
    makeRow('u2', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }]),
  ],
});
const incrementalSolutions: CalculatedSolutionTetrad[] = [
  ['u1', 0, 'WA', [10, 'min']],
  ['u1', 0, 'CE', [15, 'min']],
  ['u2', 0, 'AC', [20, 'min']],
  ['u1', 0, 'AC', [35, 'min']],
];

const staticRanklist = makeRanklist({
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

const markerRanklist = makeRanklist({
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

const invalidFilterRanklist = makeRanklist({
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

const ratioRanklist = makeRanklist({
  series: [
    {
      title: 'Ratio',
      segments: [{ title: 'A' }, { title: 'B' }],
      rule: { preset: 'ICPC', options: { ratio: { value: [0.1, 0.2], rounding: 'ceil' } } },
    },
  ],
  rows: new Array(10)
    .fill(null)
    .map((_, index) => makeRow(`ratio-u${index + 1}`, { value: 10 - index, time: [index, 'min'] })),
});

const strictIdRanklist = makeRanklist({
  series: [
    {
      title: 'Strict ID',
      segments: [{ title: 'Only' }],
      rule: { preset: 'ICPC', options: { filter: { byMarker: 'girls' }, count: { value: [2] } } },
    },
  ],
  rows: [
    makeRow('fallback-a', { value: 2, time: [10, 'min'] }, undefined, {
      id: undefined,
      name: 'No ID A',
      marker: 'girls',
    } as unknown as srk.User),
    makeRow('fallback-b', { value: 1, time: [20, 'min'] }, undefined, {
      id: undefined,
      name: 'No ID B',
    } as unknown as srk.User),
  ],
});

const originalWarn = console.warn;
console.warn = () => {};

const fixtures = {
  constants: {
    minRegenSupportedVersion: MIN_REGEN_SUPPORTED_VERSION,
    srkSupportedVersions: packageJson.srkSupportedVersions,
    enumTheme: EnumTheme,
  },
  formatters: {
    formatTimeDuration: {
      hoursToMinutes: formatTimeDuration([1.5, 'h'], 'min'),
      secondsToMinutesCeil: formatTimeDuration([61, 's'], 'min', Math.ceil),
      secondsToMillisecondsIgnoresFormatter: formatTimeDuration([2, 's'], 'ms', () => 0),
    },
    preZeroFill: {
      short: preZeroFill(7, 3),
      long: preZeroFill(1234, 3),
    },
    secToTimeStr: {
      fillHour: secToTimeStr(3661, { fillHour: true }),
      showDay: secToTimeStr(90061, { showDay: true }),
      negative: secToTimeStr(-1),
    },
    alphabet: {
      zero: numberToAlphabet(0),
      z: numberToAlphabet(25),
      aa: numberToAlphabet(26),
      acFromString: numberToAlphabet('28'),
      zz: numberToAlphabet(701),
      aaa: numberToAlphabet(702),
      numberA: alphabetToNumber('A'),
      numberAA: alphabetToNumber('AA'),
      numberLowerAc: alphabetToNumber('ac'),
      numberEmpty: alphabetToNumber(''),
    },
  },
  resolvers: {
    text: {
      undefined: resolveText(undefined),
      plain: resolveText('plain'),
      zhCN: resolveText({ fallback: 'Fallback', 'en-US': 'English', 'zh-CN': '中文' }, ['zh-CN']),
      enGB: resolveText({ fallback: 'Fallback', 'en-US': 'English', 'zh-CN': '中文' }, ['en-GB']),
      zhHansCN: resolveText({ fallback: 'Fallback', 'zh-CN': '中文' }, ['zh-Hans-CN']),
      fallback: resolveText({ fallback: 'Fallback', 'en-US': 'English' }, ['fr-FR']),
      emptyMatch: resolveText({ fallback: 'Fallback', 'en-US': '' }, ['en-US']),
    },
    contributor: {
      missing: resolveContributor(undefined),
      nameOnly: resolveContributor('Alice'),
      nameEmail: resolveContributor('Bob <bob@example.com>'),
      full: resolveContributor('bLue <mail@example.com> (https://example.com/)'),
      nameUrl: resolveContributor('John Smith (https://example.com/)'),
    },
    color: {
      string: resolveColor('#123456'),
      empty: resolveColor('' as srk.Color),
      rgbaTuple: resolveColor([1, 2, 3, 0.5] as unknown as srk.Color),
    },
    themeColor: {
      single: resolveThemeColor('#abcdef'),
      pair: resolveThemeColor({ light: '#ffffff', dark: '#000000' }),
    },
    style: {
      explicit: resolveStyle({ textColor: '#111111', backgroundColor: '#eeeeee' }),
      auto: resolveStyle({ backgroundColor: { light: '#ffffff', dark: '#000000' } }),
      autoGreen: resolveStyle({ backgroundColor: '#00c000' }),
      autoShortHex: resolveStyle({ backgroundColor: '#0c0' }),
    },
    markers: {
      modernPrecedence: resolveUserMarkers(
        { id: 'u1', name: 'U1', marker: 'official', markers: ['girls', 'none'] },
        [
          { id: 'official', label: 'Official', style: 'blue' },
          { id: 'girls', label: 'Girls', style: 'pink' },
        ],
      ),
      emptyModern: resolveUserMarkers(
        { id: 'u2', name: 'U2', marker: 'official', markers: [] },
        [
          { id: 'official', label: 'Official', style: 'blue' },
          { id: 'girls', label: 'Girls', style: 'pink' },
        ],
      ),
      legacy: resolveUserMarkers(
        { id: 'u2', name: 'U2', marker: 'official' },
        [
          { id: 'official', label: 'Official', style: 'blue' },
          { id: 'girls', label: 'Girls', style: 'pink' },
        ],
      ),
      missingConfig: resolveUserMarkers({ id: 'u3', name: 'U3', markers: ['girls'] }, undefined),
    },
  },
  ranklist: {
    sortedRows: sortRows([
      makeRow('slow', { value: 1, time: [30, 'min'] }),
      makeRow('fast', { value: 1, time: [20, 'min'] }),
      makeRow('solved-more', { value: 2, time: [90, 'min'] }),
    ]).map((row) => row.user.id),
    regenerated: regenerateRanklistBySolutions(regenerationInput, regenerationSolutions),
    defaultNoPenalty: regenerateRanklistBySolutions(defaultNoPenaltyInput, defaultNoPenaltySolutions),
    customNoPenalty: regenerateRanklistBySolutions(customNoPenaltyInput, [
      ['u1', 0, 'CE', [10, 'min']],
      ['u1', 0, 'AC', [30, 'min']],
    ]),
    postAc: regenerateRanklistBySolutions(postAcInput, postAcSolutions),
    timePrecision: regenerateRanklistBySolutions(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [makeRow('u1', { value: 0, time: [0, 'ms'] }, [{ result: null, solutions: [] }])],
        sorter: {
          algorithm: 'ICPC',
          config: {
            timePrecision: 'min',
            timeRounding: 'ceil',
          },
        },
      }),
      [['u1', 0, 'AC', [125, 's']]],
    ),
    rankingPrecisionOrder: regenerateRanklistBySolutions(
      makeRanklist({
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
      }),
      [
        ['slow-original-first', 0, 'AC', [359, 'min']],
        ['fast-original-second', 0, 'AC', [301, 'min']],
      ],
    ).rows.map((row) => row.user.id),
    incrementalRows: regenerateRowsByIncrementalSolutions(incrementalInput, incrementalSolutions),
    incrementalPostAcRows: regenerateRowsByIncrementalSolutions(
      makeRanklist({
        problems: [{ alias: 'A' }],
        rows: [
          makeRow('u1', { value: 1, time: [20, 'min'] }, [
            { result: 'AC', time: [20, 'min'], tries: 1, solutions: [{ result: 'AC', time: [20, 'min'] }] },
          ]),
        ],
      }),
      [
        ['u1', 0, 'WA', [30, 'min']],
        ['u1', 0, 'AC', [40, 'min']],
      ],
    ),
    staticRankValues: convertToStaticRanklist(staticRanklist).rows.map((row) => row.rankValues),
    markerRankValues: convertToStaticRanklist(markerRanklist).rows.map((row) => row.rankValues[0]),
    invalidFilterRankValue: convertToStaticRanklist(invalidFilterRanklist).rows[0].rankValues[0],
    ratioRankValues: convertToStaticRanklist(ratioRanklist).rows.map((row) => row.rankValues[0]),
    strictIdRankValues: convertToStaticRanklist(strictIdRanklist).rows.map((row) => row.rankValues[0]),
  },
};

console.warn = originalWarn;

const outputPath = fileURLToPath(new URL('../../testdata/contract-fixtures.json', import.meta.url));
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`);
