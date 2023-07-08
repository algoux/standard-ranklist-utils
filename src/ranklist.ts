import type * as srk from '@algoux/standard-ranklist';
import semver from 'semver';
import BigNumber from 'bignumber.js';
import { MIN_REGEN_SUPPORTED_VERSION } from './constants';
import { formatTimeDuration } from './formatters';
import { CalculatedSolutionTetrad, RankValue, StaticRanklist } from './types';

export function canRegenerateRanklist(ranklist: srk.Ranklist): boolean {
  try {
    if (!semver.gte(ranklist.version, MIN_REGEN_SUPPORTED_VERSION)) {
      return false;
    }
    if (ranklist.sorter?.algorithm !== 'ICPC') {
      return false;
    }
  } catch (e) {
    return false;
  }
  return true;
}

export function getSortedCalculatedRawSolutions(rows: srk.RanklistRow[]): CalculatedSolutionTetrad[] {
  const solutions: CalculatedSolutionTetrad[] = [];
  for (const row of rows) {
    const { user, statuses } = row;
    const userId =
      (user.id && `${user.id}`) || `${typeof user.name === 'string' ? user.name : JSON.stringify(user.name)}`;
    statuses.forEach((status, index) => {
      if (Array.isArray(status.solutions) && status.solutions.length) {
        solutions.push(
          ...status.solutions.map(
            (solution) => [userId, index, solution.result, solution.time] as CalculatedSolutionTetrad,
          ),
        );
      } else if (status.result && status.time?.[0]) {
        // use status.result as partial solutions
        if (status.result === 'AC' || status.result === 'FB') {
          // push a series of mocked rejected solutions based on tries
          for (let i = 1; i < (status.tries || 0); i++) {
            solutions.push([userId, index, 'RJ', status.time]);
          }
          solutions.push([userId, index, status.result, status.time]);
        }
      }
    });
  }
  return solutions.sort((a, b) => {
    const ta = a[3];
    const tb = b[3];
    // if time duration unit is same, directly compare their value; else convert to minimum unit to compare
    const timeComp = ta[1] === tb[1] ? ta[0] - tb[0] : formatTimeDuration(ta) - formatTimeDuration(tb);
    if (timeComp !== 0) {
      return timeComp;
    }
    const resultValue: Record<string, number> = {
      FB: 998,
      AC: 999,
      '?': 1000,
    };
    const resultA = resultValue[a[2]] || 0;
    const resultB = resultValue[b[2]] || 0;
    return resultA - resultB;
  });
}

export function filterSolutionsUntil(
  solutions: CalculatedSolutionTetrad[],
  time: srk.TimeDuration,
): CalculatedSolutionTetrad[] {
  const timeValue = formatTimeDuration(time);
  const check = (tetrad: CalculatedSolutionTetrad) => formatTimeDuration(tetrad[3]) <= timeValue;
  let lastIndex = -1;
  let low = 0;
  let high = solutions.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (check(solutions[mid])) {
      lastIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return solutions.slice(0, lastIndex + 1);
}

export function sortRows(rows: srk.RanklistRow[]): srk.RanklistRow[] {
  rows.sort((a, b) => {
    if (a.score.value !== b.score.value) {
      return b.score.value - a.score.value;
    }
    return formatTimeDuration(a.score.time!) - formatTimeDuration(b.score.time!);
  });
  return rows;
}

export function regenerateRanklistBySolutions(
  originalRanklist: srk.Ranklist,
  solutions: CalculatedSolutionTetrad[],
): srk.Ranklist {
  if (!canRegenerateRanklist(originalRanklist)) {
    throw new Error('The ranklist is not supported to regenerate');
  }
  const sorterConfig: srk.SorterICPC['config'] = {
    penalty: [20, 'min'],
    noPenaltyResults: ['FB', 'AC', '?', 'CE', 'UKE', null],
    timeRounding: 'floor',
    ...JSON.parse(JSON.stringify(originalRanklist.sorter?.config || {})),
  };
  const ranklist: srk.Ranklist = {
    ...originalRanklist,
    rows: [],
  };
  const rows: srk.RanklistRow[] = [];
  const userRowMap = new Map<string, srk.RanklistRow>();
  const problemCount = originalRanklist.problems.length;
  originalRanklist.rows.forEach((row) => {
    const userId =
      (row.user.id && `${row.user.id}`) ||
      `${typeof row.user.name === 'string' ? row.user.name : JSON.stringify(row.user.name)}`;
    userRowMap.set(userId, {
      user: row.user,
      score: {
        value: 0,
      },
      statuses: new Array(problemCount).fill(null).map(() => ({ result: null, solutions: [] })),
    });
  });
  for (const tetrad of solutions) {
    const [userId, problemIndex, result, time] = tetrad;
    let row = userRowMap.get(userId);
    if (!row) {
      console.error(`Invalid user id ${userId} found when regenerating ranklist`);
      break;
    }
    const status = row.statuses[problemIndex];
    status.solutions!.push({ result, time });
  }
  const problemAcceptedCount = new Array(problemCount).fill(0);
  const problemSubmittedCount = new Array(problemCount).fill(0);
  for (const row of userRowMap.values()) {
    const { statuses } = row;
    let scoreValue = 0;
    let totalTimeMs = 0;
    for (let i = 0; i < statuses.length; ++i) {
      const status = statuses[i];
      // calculate for each problem
      const solutions = status.solutions!;
      for (const solution of solutions) {
        if (!solution.result) {
          continue;
        }
        if (solution.result === '?') {
          status.result = solution.result;
          status.tries = (status.tries || 0) + 1;
          problemSubmittedCount[i] += 1;
          continue;
        }
        if (solution.result === 'AC' || solution.result === 'FB') {
          status.result = solution.result;
          status.time = solution.time;
          status.tries = (status.tries || 0) + 1;
          problemAcceptedCount[i] += 1;
          problemSubmittedCount[i] += 1;
          break;
        }
        // @ts-ignore
        if ((sorterConfig.noPenaltyResults || []).includes(solution.result)) {
          continue;
        }
        status.result = 'RJ';
        status.tries = (status.tries || 0) + 1;
        problemSubmittedCount[i] += 1;
      }
      if (status.result === 'AC' || status.result === 'FB') {
        const targetTime: srk.TimeDuration = [
          formatTimeDuration(
            status.time!,
            sorterConfig.timePrecision || 'ms',
            sorterConfig.timeRounding === 'ceil'
              ? Math.ceil
              : sorterConfig.timeRounding === 'round'
              ? Math.round
              : Math.floor,
          ),
          sorterConfig.timePrecision || 'ms',
        ];
        scoreValue += 1;
        totalTimeMs +=
          formatTimeDuration(targetTime, 'ms') + (status.tries! - 1) * formatTimeDuration(sorterConfig.penalty!, 'ms');
      }
    }
    row.score = {
      value: scoreValue,
      time: [totalTimeMs, 'ms'],
    };
    rows.push(row);
  }
  ranklist.rows = sortRows(rows);
  ranklist.problems.forEach((problem, index) => {
    if (!problem.statistics) {
      problem.statistics = {
        accepted: 0,
        submitted: 0,
      };
    }
    problem.statistics.accepted = problemAcceptedCount[index];
    problem.statistics.submitted = problemSubmittedCount[index];
  });
  return ranklist;
}

export function regenerateRowsByIncrementalSolutions(
  originalRanklist: srk.Ranklist,
  solutions: CalculatedSolutionTetrad[],
) {
  if (!canRegenerateRanklist(originalRanklist)) {
    throw new Error('The ranklist is not supported to regenerate');
  }
  const sorterConfig: srk.SorterICPC['config'] = {
    penalty: [20, 'min'],
    noPenaltyResults: ['FB', 'AC', '?', 'CE', 'UKE', null],
    timeRounding: 'floor',
    ...JSON.parse(JSON.stringify(originalRanklist.sorter?.config || {})),
  };
  const userRowIndexMap = new Map<string, number>();
  const rows = [...originalRanklist.rows];
  rows.forEach((row, index) => {
    const userId =
      (row.user.id && `${row.user.id}`) ||
      `${typeof row.user.name === 'string' ? row.user.name : JSON.stringify(row.user.name)}`;
    userRowIndexMap.set(userId, index);
  });
  const clonedRowMap = new Set<string>();
  const clonedRowStatusMap = new Set</** `${userId}_${problemIndex}` */ string>();
  for (const tetrad of solutions) {
    const [userId, problemIndex, result, time] = tetrad;
    let rowIndex = userRowIndexMap.get(userId);
    if (rowIndex === undefined) {
      console.error(`Invalid user id ${userId} found when regenerating ranklist`);
      break;
    }
    let row = rows[rowIndex];
    if (!clonedRowMap.has(userId)) {
      row = { ...row };
      row.score = { ...row.score };
      row.statuses = [...row.statuses];
      rows[rowIndex] = row;
      clonedRowMap.add(userId);
    }
    if (!clonedRowStatusMap.has(`${userId}_${problemIndex}`)) {
      row.statuses[problemIndex] = { ...row.statuses[problemIndex] };
      row.statuses[problemIndex].solutions = [...row.statuses[problemIndex].solutions!];
      clonedRowStatusMap.add(`${userId}_${problemIndex}`);
    }
    const status = row.statuses[problemIndex];
    status.solutions!.push({ result, time });
    if (status.result === 'AC' || status.result === 'FB') {
      continue;
    }
    if (result === '?') {
      status.result = result;
      status.tries = (status.tries || 0) + 1;
      continue;
    }
    if (result === 'AC' || result === 'FB') {
      status.result = result;
      status.time = time;
      status.tries = (status.tries || 0) + 1;
      row.score.value += 1;
      const targetTime: srk.TimeDuration = [
        formatTimeDuration(
          status.time!,
          sorterConfig.timePrecision || 'ms',
          sorterConfig.timeRounding === 'ceil'
            ? Math.ceil
            : sorterConfig.timeRounding === 'round'
            ? Math.round
            : Math.floor,
        ),
        sorterConfig.timePrecision || 'ms',
      ];
      const totalTime = formatTimeDuration(row.score.time!, 'ms') || 0;
      row.score.time = [
        totalTime +
          formatTimeDuration(targetTime, 'ms') +
          (status.tries! - 1) * formatTimeDuration(sorterConfig.penalty!, 'ms'),
        'ms',
      ];
      continue;
    }
    // @ts-ignore
    if ((sorterConfig.noPenaltyResults || []).includes(result)) {
      continue;
    }
    status.result = 'RJ';
    status.tries = (status.tries || 0) + 1;
  }
  return sortRows(rows);
}

function genSeriesCalcFns(
  series: srk.RankSeries[],
  rows: srk.RanklistRow[],
  ranks: number[],
  officialRanks: (number | null)[],
) {
  const fallbackSeriesCalcFn = () => ({
    rank: null,
    segmentIndex: null,
  });
  const fns: Array<(row: srk.RanklistRow, index: number) => RankValue> = series.map((seriesConfig) => {
    const { rule } = seriesConfig;
    if (!rule) {
      return fallbackSeriesCalcFn;
    }
    const { preset } = rule;
    switch (preset) {
      case 'Normal': {
        const options = rule.options as srk.RankSeriesRulePresetNormal['options'];
        return (row, index) => {
          if (options?.includeOfficialOnly && row.user.official === false) {
            return {
              rank: null,
              segmentIndex: null,
            };
          }
          return {
            rank: options?.includeOfficialOnly ? officialRanks[index] : ranks[index],
            segmentIndex: null,
          };
        };
      }
      case 'UniqByUserField': {
        const options = rule.options as srk.RankSeriesRulePresetUniqByUserField['options'];
        const field = options?.field;
        const assignedRanksMap = new Map<number, number>();
        const valueSet = new Set<string>();
        const stringify = (v: any) => (typeof v === 'object' ? JSON.stringify(v) : `${v}`);
        let lastOuterRank = 0;
        let lastRank = 0;
        rows.forEach((row, index) => {
          if (options.includeOfficialOnly && row.user.official === false) {
            return;
          }
          const value = stringify(row.user[field]);
          if (value && !valueSet.has(value)) {
            const outerRank = options.includeOfficialOnly ? (officialRanks[index] as number) : ranks[index];
            valueSet.add(value);
            if (outerRank !== lastOuterRank) {
              lastOuterRank = outerRank;
              lastRank = assignedRanksMap.size + 1;
              assignedRanksMap.set(index, lastRank);
            }
            assignedRanksMap.set(index, lastRank);
          }
        });
        return (row, index) => {
          return {
            rank: assignedRanksMap.get(index) ?? null,
            segmentIndex: null,
          };
        };
      }
      case 'ICPC': {
        const options = rule.options as srk.RankSeriesRulePresetICPC['options'];
        const usingEndpointRules: number[][] = [];
        let noTied = false;
        if (options.ratio) {
          const { value, rounding = 'ceil', denominator = 'all' } = options.ratio;
          const officialRows = rows.filter((row) => row.user.official === undefined || row.user.official === true);
          let total =
            denominator === 'submitted'
              ? officialRows.filter((row) => !row.statuses.every((s) => s.result === null)).length
              : officialRows.length;
          const accValues: BigNumber[] = [];
          for (let i = 0; i < value.length; i++) {
            if (i === 0) {
              accValues[i] = new BigNumber(value[i]);
            } else {
              accValues[i] = accValues[i - 1].plus(new BigNumber(value[i]));
            }
          }
          const segmentRawEndpoints = accValues.map((v) => v.times(total).toNumber());
          usingEndpointRules.push(
            segmentRawEndpoints.map((v) => {
              return rounding === 'floor' ? Math.floor(v) : rounding === 'round' ? Math.round(v) : Math.ceil(v);
            }),
          );
          if (options.ratio.noTied) {
            noTied = true;
          }
        }
        if (options.count) {
          const { value } = options.count;
          const accValues: number[] = [];
          for (let i = 0; i < value.length; i++) {
            accValues[i] = (i > 0 ? accValues[i - 1] : 0) + value[i];
          }
          usingEndpointRules.push(accValues);
          if (options.count.noTied) {
            noTied = true;
          }
        }
        const officialRanksNoTied: typeof officialRanks = [];
        let currentOfficialRank = 0;
        for (let i = 0; i < officialRanks.length; i++) {
          officialRanksNoTied.push(officialRanks[i] === null ? null : ++currentOfficialRank);
        }
        return (row, index) => {
          if (row.user.official === false) {
            return {
              rank: null,
              segmentIndex: null,
            };
          }
          const usingSegmentIndex = (seriesConfig.segments || []).findIndex((_, segIndex) => {
            return usingEndpointRules
              .map((e) => e[segIndex])
              .every((endpoints) => (noTied ? officialRanksNoTied : officialRanks)[index]! <= endpoints);
          });
          return {
            rank: officialRanks[index],
            segmentIndex: usingSegmentIndex > -1 ? usingSegmentIndex : null,
          };
        };
      }
      default:
        console.warn('Unknown series rule preset：', preset);
        return fallbackSeriesCalcFn;
    }
  });
  return fns;
}

function genRowRanks(rows: srk.RanklistRow[]) {
  const compareScoreEqual = (a: srk.RankScore, b: srk.RankScore) => {
    if (a.value !== b.value) {
      return false;
    }
    const da = a.time ? formatTimeDuration(a.time) : 0;
    const db = b.time ? formatTimeDuration(b.time) : 0;
    return da === db;
  };
  const genRanks = (rows: srk.RanklistRow[]) => {
    let ranks: number[] = new Array(rows.length).fill(null);
    for (let i = 0; i < rows.length; ++i) {
      if (i === 0) {
        ranks[i] = 1;
        continue;
      }
      if (compareScoreEqual(rows[i].score, rows[i - 1].score)) {
        ranks[i] = ranks[i - 1];
      } else {
        ranks[i] = i + 1;
      }
    }
    return ranks;
  };
  const ranks = genRanks(rows);
  const officialPartialRows: srk.RanklistRow[] = [];
  const officialIndexBackMap = new Map<number, number>();
  rows.forEach((row, index) => {
    if (row.user.official !== false) {
      officialIndexBackMap.set(index, officialPartialRows.length);
      officialPartialRows.push(row);
    }
  });
  const officialPartialRanks = genRanks(officialPartialRows);
  const officialRanks = new Array(rows.length)
    .fill(null)
    .map((_, index) =>
      officialIndexBackMap.get(index) === undefined ? null : officialPartialRanks[officialIndexBackMap.get(index)!],
    );
  return {
    ranks,
    officialRanks,
  };
}

export function convertToStaticRanklist(ranklist: srk.Ranklist): StaticRanklist {
  if (!ranklist) {
    return ranklist;
  }
  const { series, rows } = ranklist;
  const rowRanks = genRowRanks(rows);
  const seriesCalcFns = genSeriesCalcFns(series, rows, rowRanks.ranks, rowRanks.officialRanks);
  return {
    ...ranklist,
    rows: rows.map((row, index) => {
      return {
        ...row,
        rankValues: seriesCalcFns.map((fn) => fn(row, index)),
      };
    }),
  };
}
