import type * as srk from '@algoux/standard-ranklist';
import semver from 'semver';
import BigNumber from 'bignumber.js';
import { MIN_REGEN_SUPPORTED_VERSION } from './constants';
import { formatTimeDuration } from './formatters';
import { CalculatedSolutionTetrad, RankValue, StaticRanklist } from './types';

/**
 * Check whether a ranklist can be regenerated from solution history by this package.
 *
 * Regeneration currently requires an srk version at or above `MIN_REGEN_SUPPORTED_VERSION` and an ICPC sorter.
 *
 * @param ranklist - Ranklist to inspect.
 * @returns `true` when regeneration is supported.
 */
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

/**
 * Extract a sorted solution timeline from ranklist rows.
 *
 * Detailed `status.solutions` are used when present. For summarized accepted statuses without solutions, rejected
 * attempts are synthesized from `tries` before the final `AC`/`FB` result.
 *
 * @param rows - Ranklist rows to scan.
 * @returns Solution tetrads sorted by submission time, then by result priority.
 */
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

/**
 * Return all solutions submitted at or before a cutoff time.
 *
 * The input is expected to already be sorted in ascending time order, such as the output of
 * `getSortedCalculatedRawSolutions`.
 *
 * @param solutions - Sorted solution tetrads.
 * @param time - Inclusive cutoff time.
 * @returns Prefix of the solution array up to the cutoff.
 */
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

/**
 * Sort ranklist rows by ICPC score order.
 *
 * Rows are ordered by solved count descending, then total penalty time ascending. Ranking-time precision options can be
 * used to compare penalty times at a coarser precision. The input array is sorted in place.
 *
 * @param rows - Rows to sort.
 * @param options - Optional precision controls used when comparing penalty times.
 * @returns The same row array after sorting.
 */
export function sortRows(
  rows: srk.RanklistRow[],
  options: {
    rankingTimePrecision?: srk.TimeUnit;
    rankingTimeRounding?: 'floor' | 'ceil' | 'round';
  } = {},
): srk.RanklistRow[] {
  const rankingTimePrecision = options.rankingTimePrecision || 'ms';
  const rankingTimeRoundingFn =
    options.rankingTimeRounding === 'ceil'
      ? Math.ceil
      : options.rankingTimeRounding === 'round'
      ? Math.round
      : Math.floor;
  rows.sort((a, b) => {
    if (a.score.value !== b.score.value) {
      return b.score.value - a.score.value;
    }
    const timeA = a.score.time ? formatTimeDuration(a.score.time, rankingTimePrecision, rankingTimeRoundingFn) : 0;
    const timeB = b.score.time ? formatTimeDuration(b.score.time, rankingTimePrecision, rankingTimeRoundingFn) : 0;
    return timeA - timeB;
  });
  return rows;
}

/**
 * Deep-clone plain JSON-like data used in ranklist objects.
 *
 * @internal
 * @param obj - Value to clone.
 * @returns Cloned value.
 */
function cloneDeep<T extends any>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    // @ts-ignore
    return obj.map((item) => cloneDeep(item));
  }
  // @ts-ignore
  const clonedObj: T = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      // @ts-ignore
      clonedObj[key] = cloneDeep(obj[key]);
    }
  }
  return clonedObj;
}

/**
 * Calculate accepted and submitted totals for every problem from row summaries.
 *
 * @param ranklist - Ranklist whose row statuses should be aggregated.
 * @returns Problem statistics aligned with `ranklist.problems`.
 */
export function calculateProblemStatistics(ranklist: srk.Ranklist): srk.ProblemStatistics[] {
  const problemCount = ranklist.problems.length;
  const problemAcceptedCount = new Array(problemCount).fill(0);
  const problemSubmittedCount = new Array(problemCount).fill(0);
  for (const row of ranklist.rows) {
    for (let i = 0; i < problemCount; i++) {
      const status = row.statuses[i];
      if (!status) {
        continue;
      }
      if (status.result === 'AC' || status.result === 'FB') {
        problemAcceptedCount[i] += 1;
      }
      problemSubmittedCount[i] += status.tries || 0;
    }
  }
  return ranklist.problems.map((_, index) => ({
    accepted: problemAcceptedCount[index],
    submitted: problemSubmittedCount[index],
  }));
}

/**
 * Regenerate a complete ICPC ranklist from a solution timeline.
 *
 * The returned ranklist keeps non-row metadata from the original ranklist, rebuilds row statuses and scores from the
 * provided solutions, sorts the rows, and refreshes problem statistics.
 *
 * @param originalRanklist - Source ranklist metadata and user/problem definitions.
 * @param solutions - Solution tetrads to apply in chronological order.
 * @returns New ranklist with regenerated rows and problem statistics.
 * @throws If the ranklist version or sorter is not supported.
 */
export function regenerateRanklistBySolutions(
  originalRanklist: srk.Ranklist,
  solutions: CalculatedSolutionTetrad[],
): srk.Ranklist {
  if (!canRegenerateRanklist(originalRanklist)) {
    throw new Error('The ranklist is not supported to regenerate');
  }
  const sorterConfig: srk.SorterICPC['config'] = {
    penalty: [20, 'min'],
    noPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'CE', 'UKE', null],
    timeRounding: 'floor',
    ...cloneDeep(originalRanklist.sorter?.config || {}),
  };
  // @ts-ignore
  const ranklist: srk.Ranklist = {};
  for (const key in originalRanklist) {
    if (key !== 'rows' && originalRanklist.hasOwnProperty(key)) {
      // @ts-ignore
      ranklist[key] = cloneDeep(originalRanklist[key]);
    }
  }
  ranklist.rows = [];
  const rows: srk.RanklistRow[] = [];
  const userRowMap = new Map<string, srk.RanklistRow>();
  const problemCount = ranklist.problems.length;
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
        // @ts-ignore
        const isNoPenaltyResult = (sorterConfig.noPenaltyResults || []).includes(solution.result);
        if (solution.result === 'AC' || solution.result === 'FB') {
          status.result = solution.result;
          status.time = solution.time;
          status.tries = (status.tries || 0) + 1;
          problemAcceptedCount[i] += 1;
          problemSubmittedCount[i] += 1;
          break;
        }
        if (isNoPenaltyResult) {
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
  ranklist.rows = sortRows(rows, {
    rankingTimePrecision: sorterConfig.rankingTimePrecision,
    rankingTimeRounding: sorterConfig.rankingTimeRounding,
  });
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

/**
 * Apply new solution tetrads to an existing ICPC ranklist row set.
 *
 * Only touched rows and statuses are shallow-cloned, so unchanged row objects are preserved. The returned array is
 * sorted by ICPC score order.
 *
 * @param originalRanklist - Ranklist containing the current rows.
 * @param solutions - Incremental solution tetrads to append and score in chronological order.
 * @returns Sorted row array after applying the incremental solutions.
 * @throws If the ranklist version or sorter is not supported.
 */
export function regenerateRowsByIncrementalSolutions(
  originalRanklist: srk.Ranklist,
  solutions: CalculatedSolutionTetrad[],
) {
  if (!canRegenerateRanklist(originalRanklist)) {
    throw new Error('The ranklist is not supported to regenerate');
  }
  const sorterConfig: srk.SorterICPC['config'] = {
    penalty: [20, 'min'],
    noPenaltyResults: ['FB', 'AC', '?', 'NOUT', 'CE', 'UKE', null],
    timeRounding: 'floor',
    ...cloneDeep(originalRanklist.sorter?.config || {}),
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
    // @ts-ignore
    const isNoPenaltyResult = (sorterConfig.noPenaltyResults || []).includes(result);
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
    if (isNoPenaltyResult) {
      continue;
    }
    status.result = 'RJ';
    status.tries = (status.tries || 0) + 1;
  }
  return sortRows(rows, {
    rankingTimePrecision: sorterConfig.rankingTimePrecision,
    rankingTimeRounding: sorterConfig.rankingTimeRounding,
  });
}

/**
 * Build rank calculation functions for each configured rank series.
 *
 * @internal
 * @param series - Series definitions from the ranklist.
 * @param rows - Already sorted ranklist rows.
 * @param ranks - Overall row ranks.
 * @param officialRanks - Ranks computed from official rows only.
 * @returns One rank-value calculator per series.
 */
function genSeriesCalcFns(
  series: srk.RankSeries[],
  rows: srk.RanklistRow[],
  ranks: number[],
  officialRanks: (number | null)[],
) {
  const filterableUserFields = ['id', 'name', 'organization'];
  const groupableUserFields = ['id', 'name', 'organization'];
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
          const isValidField = groupableUserFields.includes(field);
          const value = stringify(row.user[field]);
          if (!isValidField || (value && !valueSet.has(value))) {
            const outerRank = options.includeOfficialOnly ? (officialRanks[index] as number) : ranks[index];
            isValidField && valueSet.add(value);
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
        let filteredRows = rows.filter((row) => row.user.official === undefined || row.user.official === true);
        let filteredOfficialRanks = [...officialRanks];
        if (options.filter) {
          const filterTests: ((row: srk.RanklistRow) => boolean)[] = [];
          if (Array.isArray(options.filter.byUserFields) && options.filter.byUserFields.length) {
            options.filter.byUserFields.forEach((filter) => {
              const { field, rule } = filter;
              if (!filterableUserFields.includes(field)) {
                return;
              }
              let regexp: RegExp;
              try {
                regexp = new RegExp(rule);
              } catch (e) {
                console.warn(`Invalid regexp ${rule} for field ${field} in ICPC series filter, skipping this filter`);
                filterTests.push(() => false);
                return;
              }
              filterTests.push((row) => {
                const value = row.user[field];
                if (value === undefined) {
                  return false;
                }
                if (typeof value === 'object') {
                  return Object.values(value).some((v) => regexp.test(`${v}`));
                }
                if (Array.isArray(value)) {
                  return value.some((v) => regexp.test(`${v}`));
                }
                return regexp.test(`${value}`);
              });
            });
          }
          if (options.filter.byMarker) {
            const marker = options.filter.byMarker;
            filterTests.push((row) => {
              return Array.isArray(row.user.markers) ? row.user.markers.includes(marker) : row.user.marker === marker;
            });
          }

          if (filterTests.length) {
            const currentFilteredRows: typeof filteredRows = [];
            filteredOfficialRanks = filteredOfficialRanks.map(() => null);
            let currentRank = 0;
            let currentOfficialRank = 0;
            let currentOfficialRankOld = 0;
            rows.forEach((row, index) => {
              const shouldInclude = filterTests.every((test) => test(row));
              if (shouldInclude) {
                currentFilteredRows.push(row);
                const oldRank = officialRanks[index]!;
                if (oldRank !== null) {
                  currentRank++;
                  if (currentOfficialRankOld !== oldRank) {
                    currentOfficialRank = currentRank;
                    currentOfficialRankOld = oldRank;
                  }
                  filteredOfficialRanks[index] = currentOfficialRank;
                } else {
                  filteredOfficialRanks[index] = null;
                }
              }
            });
            filteredRows = currentFilteredRows.filter(
              (row) => row.user.official === undefined || row.user.official === true,
            );
          }
        }
        const usingEndpointRules: number[][] = [];
        let noTied = false;
        if (options.ratio) {
          const { value, rounding = 'ceil', denominator = 'all' } = options.ratio;
          const officialRows = filteredRows;
          let total =
            denominator === 'submitted'
              ? officialRows.filter((row) => !row.statuses.every((s) => s.result === null)).length
              : denominator === 'scored'
              ? officialRows.filter((row) => row.score.value > 0).length
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
        const officialRanksNoTied: typeof filteredOfficialRanks = [];
        let currentOfficialRank = 0;
        for (let i = 0; i < filteredOfficialRanks.length; i++) {
          officialRanksNoTied.push(filteredOfficialRanks[i] === null ? null : ++currentOfficialRank);
        }
        return (row, index) => {
          if (row.user.official === false || !filteredRows.find((r) => r.user.id === row.user.id)) {
            return {
              rank: null,
              segmentIndex: null,
            };
          }
          const usingSegmentIndex = (seriesConfig.segments || []).findIndex((_, segIndex) => {
            return usingEndpointRules
              .map((e) => e[segIndex])
              .every((endpoints) => (noTied ? officialRanksNoTied : filteredOfficialRanks)[index]! <= endpoints);
          });
          return {
            rank: filteredOfficialRanks[index],
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

/**
 * Generate overall and official-only rank arrays for sorted rows.
 *
 * @internal
 * @param rows - Sorted ranklist rows.
 * @param options - Optional precision controls used when comparing tied penalty times.
 * @returns Overall ranks and official-only ranks aligned with the original row indexes.
 */
function genRowRanks(
  rows: srk.RanklistRow[],
  options: {
    rankingTimePrecision?: srk.TimeUnit;
    rankingTimeRounding?: 'floor' | 'ceil' | 'round';
  } = {},
) {
  const compareScoreEqual = (a: srk.RankScore, b: srk.RankScore) => {
    if (a.value !== b.value) {
      return false;
    }
    const rankingTimePrecision = options.rankingTimePrecision || 'ms';
    const rankingTimeRoundingFn =
      options.rankingTimeRounding === 'ceil'
        ? Math.ceil
        : options.rankingTimeRounding === 'round'
        ? Math.round
        : Math.floor;
    const da = a.time ? formatTimeDuration(a.time, rankingTimePrecision, rankingTimeRoundingFn) : 0;
    const db = b.time ? formatTimeDuration(b.time, rankingTimePrecision, rankingTimeRoundingFn) : 0;
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

/**
 * Convert a dynamic ranklist into a static ranklist with precomputed rank values.
 *
 * Each row receives a `rankValues` array aligned with `ranklist.series`, including series-specific ranks and segment
 * indexes for renderers that do not want to calculate them at display time.
 *
 * @param ranklist - Ranklist to convert.
 * @returns Ranklist copy whose rows include precomputed rank values.
 */
export function convertToStaticRanklist(ranklist: srk.Ranklist): StaticRanklist {
  if (!ranklist) {
    return ranklist;
  }
  const { series, rows } = ranklist;
  const rowRanks = genRowRanks(rows, {
    rankingTimePrecision: ranklist.sorter?.config?.rankingTimePrecision,
    rankingTimeRounding: ranklist.sorter?.config?.rankingTimeRounding,
  });
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
