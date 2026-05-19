import type * as srk from '@algoux/standard-ranklist';
import { formatTimeDuration } from './formatters';
import { sortRows } from './ranklist';

export type RanklistDiagnosticSeverity = 'info' | 'warning' | 'error';
export type RanklistDiagnosticConfidence = 'none' | 'partial' | 'full';
export type RanklistTimeRounding = 'floor' | 'ceil' | 'round';

export interface RanklistDiagnosticIssue {
  code: string;
  severity: RanklistDiagnosticSeverity;
  message: string;
  path: string;
  expected?: unknown;
  actual?: unknown;
  context?: Record<string, unknown>;
}

export interface ProblemStatisticsDiagnosticsReport {
  skipped: boolean;
  hasSolutions: boolean;
  confidence: RanklistDiagnosticConfidence;
  computed: srk.ProblemStatistics[];
  declared: Array<srk.ProblemStatistics | undefined>;
  issues: RanklistDiagnosticIssue[];
}

export interface ICPCSeriesConfigSummary {
  seriesIndex: number;
  title?: string;
  path: string;
  segmentCount: number;
  hasCount: boolean;
  countValue?: number[];
  countTotal?: number;
  countIsEmpty: boolean;
  hasRatio: boolean;
  ratioValue?: number[];
  ratioTotal?: number;
  ratioIsEmpty: boolean;
  byMarker?: string;
  hasFilter: boolean;
  hasAllocationConfig: boolean;
  isEmpty: boolean;
}

export interface SeriesDiagnosticsReport {
  icpc: {
    hasICPCSeries: boolean;
    seriesCount: number;
    summaries: ICPCSeriesConfigSummary[];
  };
  issues: RanklistDiagnosticIssue[];
}

export interface FBCandidate {
  problemIndex: number;
  rowIndex: number;
  userId: string;
  time: srk.TimeDuration;
  result: 'AC' | 'FB';
  path: string;
  source: 'solution' | 'status';
  solutionIndex?: number;
}

export interface FBComputedProblem {
  problemIndex: number;
  candidates: FBCandidate[];
  multiplePossible: boolean;
  usable: boolean;
}

export interface FBDeclaredProblem {
  problemIndex: number;
  candidates: FBCandidate[];
  uniqueCandidates: FBCandidate[];
  multipleDeclared: boolean;
  singleDeclaredWithComputedMultiple: boolean;
  declaredHasHigherPrecision: boolean;
}

export interface FBDiagnosticsReport {
  hasDeclaredFB: boolean;
  hasComputedFB: boolean;
  hasComputedMultiplePossible: boolean;
  hasDeclaredMultipleFB: boolean;
  canEnhance: boolean;
  shouldOverride: boolean;
  computedFB: FBComputedProblem[];
  declaredFB: FBCandidate[];
  declaredFBByProblem: FBDeclaredProblem[];
  issues: RanklistDiagnosticIssue[];
}

export interface RanklistComputedStatus {
  result: srk.SolutionResultLite;
  time?: srk.TimeDuration;
  tries: number;
  accepted: boolean;
  acceptedSolutionIndex: number | null;
  confidence: 'solutions' | 'summary' | 'none';
}

export interface RanklistComputedRow {
  rowIndex: number;
  userId: string;
  score: srk.RankScore;
  statuses: RanklistComputedStatus[];
}

export interface ICPCTimePrecisionCandidate {
  timePrecision: srk.TimeUnit;
  timeRounding: RanklistTimeRounding;
}

export interface ICPCTimePrecisionDiagnostics {
  checked: boolean;
  declared?: ICPCTimePrecisionCandidate;
  possible: ICPCTimePrecisionCandidate[];
  matchedDeclared: boolean | null;
}

export interface RanklistMetadataAnalysis {
  submissionPrecision: srk.TimeUnit | null;
  FB: {
    hasDeclared: boolean;
    computedAvailable: boolean;
    availability: 'none' | 'declared-valid' | 'declared-invalid' | 'computed-only' | 'ambiguous';
  };
  hasProblemColors: boolean;
  problemColorCount: number;
  hasDetailedSolutions: boolean;
  solutionCoverage: RanklistDiagnosticConfidence;
  solutionsAreLikelyMocked: boolean;
  mockedSolutionCount: number;
  hasPreciseSolutionResults: boolean;
  hasFuzzyRJResults: boolean;
  hasCustomSolutionResults: boolean;
  hasFrozenSubmissions: boolean;
  hasTeamMembers: boolean;
  hasUserAvatar: boolean;
  hasUserPhoto: boolean;
  hasUserLocation: boolean;
  issues: RanklistDiagnosticIssue[];
}

export interface RanklistDataValidityReport {
  confidence: RanklistDiagnosticConfidence;
  timePrecision?: ICPCTimePrecisionDiagnostics;
  computed?: {
    rows: RanklistComputedRow[];
    statistics: srk.ProblemStatistics[];
    rowOrder: string[];
    rowOrderMatches: boolean;
  };
  issues: RanklistDiagnosticIssue[];
}

export interface RanklistDiagnosticsReport {
  summary: {
    issueCount: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
    hasErrors: boolean;
  };
  metadata: RanklistMetadataAnalysis;
  problemStatistics: ProblemStatisticsDiagnosticsReport;
  series: SeriesDiagnosticsReport;
  FB: FBDiagnosticsReport;
  dataValidity: RanklistDataValidityReport;
  issues: RanklistDiagnosticIssue[];
}

interface ICPCDiagnosticsConfig {
  penalty: srk.TimeDuration;
  noPenaltyResults: Array<srk.SolutionResultFull | srk.SolutionResultCustom | null>;
  timePrecision?: srk.TimeUnit;
  timeRounding?: RanklistTimeRounding;
  rankingTimePrecision?: srk.TimeUnit;
  rankingTimeRounding?: RanklistTimeRounding;
}

const TIME_UNITS: srk.TimeUnit[] = ['ms', 's', 'min', 'h', 'd'];
const TIME_UNIT_MS: Record<srk.TimeUnit, number> = {
  ms: 1,
  s: 1000,
  min: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};
const TIME_ROUNDINGS: RanklistTimeRounding[] = ['floor', 'ceil', 'round'];
const DEFAULT_NO_PENALTY_RESULTS: Array<srk.SolutionResultFull | null> = ['FB', 'AC', '?', 'NOUT', 'CE', 'UKE', null];
const PRECISE_REJECTED_RESULTS = new Set(['WA', 'PE', 'TLE', 'MLE', 'OLE', 'RTE', 'NOUT', 'CE', 'UKE']);
const LITE_RESULTS = new Set(['FB', 'AC', 'RJ', '?']);

function isTimeUnit(unit: unknown): unit is srk.TimeUnit {
  return typeof unit === 'string' && TIME_UNITS.includes(unit as srk.TimeUnit);
}

function isTimeRounding(rounding: unknown): rounding is RanklistTimeRounding {
  return typeof rounding === 'string' && TIME_ROUNDINGS.includes(rounding as RanklistTimeRounding);
}

function getDefaultICPCConfig(overrides: Partial<ICPCDiagnosticsConfig> = {}): ICPCDiagnosticsConfig {
  return {
    penalty: overrides.penalty && isValidTimeDuration(overrides.penalty) ? overrides.penalty : [20, 'min'],
    noPenaltyResults: Array.isArray(overrides.noPenaltyResults)
      ? overrides.noPenaltyResults
      : DEFAULT_NO_PENALTY_RESULTS,
    timePrecision: isTimeUnit(overrides.timePrecision) ? overrides.timePrecision : undefined,
    timeRounding: isTimeRounding(overrides.timeRounding) ? overrides.timeRounding : undefined,
    rankingTimePrecision: isTimeUnit(overrides.rankingTimePrecision) ? overrides.rankingTimePrecision : undefined,
    rankingTimeRounding: isTimeRounding(overrides.rankingTimeRounding) ? overrides.rankingTimeRounding : undefined,
  };
}

function makeIssue(
  code: string,
  severity: RanklistDiagnosticSeverity,
  message: string,
  path: string,
  extra: Omit<RanklistDiagnosticIssue, 'code' | 'severity' | 'message' | 'path'> = {},
): RanklistDiagnosticIssue {
  return {
    code,
    severity,
    message,
    path,
    ...extra,
  };
}

function getUserId(row: srk.RanklistRow, index: number): string {
  const id = row.user?.id;
  return id === undefined || id === null || id === '' ? `#row-${index}` : `${id}`;
}

function isAcceptedResult(result: unknown): result is 'AC' | 'FB' {
  return result === 'AC' || result === 'FB';
}

function isRejectedResult(result: unknown): boolean {
  return typeof result === 'string' && !isAcceptedResult(result) && result !== '?';
}

function isICPCSeries(series: srk.RankSeries): series is srk.RankSeries & { rule: srk.RankSeriesRulePresetICPC } {
  return series.rule?.preset === 'ICPC';
}

function sumNumericValues(values: unknown): number | undefined {
  if (!Array.isArray(values)) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0);
}

function getRoundingFn(rounding?: 'floor' | 'ceil' | 'round') {
  return rounding === 'ceil' ? Math.ceil : rounding === 'round' ? Math.round : Math.floor;
}

function getICPCConfig(ranklist: srk.Ranklist): ICPCDiagnosticsConfig | null {
  if (ranklist.sorter?.algorithm !== 'ICPC') {
    return null;
  }
  const config = ranklist.sorter.config || {};
  return getDefaultICPCConfig({
    penalty: config.penalty,
    noPenaltyResults: config.noPenaltyResults || DEFAULT_NO_PENALTY_RESULTS,
    timePrecision: config.timePrecision,
    timeRounding: config.timeRounding,
    rankingTimePrecision: config.rankingTimePrecision,
    rankingTimeRounding: config.rankingTimeRounding,
  });
}

function hasDetailedSolutions(ranklist: srk.Ranklist): boolean {
  return ranklist.rows.some((row) =>
    row.statuses.some((status) => Array.isArray(status.solutions) && status.solutions.length > 0),
  );
}

function getSolutionCoverage(ranklist: srk.Ranklist): RanklistDiagnosticConfidence {
  let submittedStatusCount = 0;
  let submittedStatusWithSolutionsCount = 0;
  for (const row of ranklist.rows) {
    for (const status of row.statuses) {
      const hasSolutions = Array.isArray(status.solutions) && status.solutions.length > 0;
      const hasSummarySubmission = status.result !== null || !!status.tries || !!status.time;
      if (hasSolutions || hasSummarySubmission) {
        submittedStatusCount++;
        if (hasSolutions) {
          submittedStatusWithSolutionsCount++;
        }
      }
    }
  }
  if (submittedStatusWithSolutionsCount === 0) {
    return 'none';
  }
  return submittedStatusWithSolutionsCount === submittedStatusCount ? 'full' : 'partial';
}

function timeToMs(time: srk.TimeDuration | undefined): number | null {
  if (!time) {
    return null;
  }
  try {
    return formatTimeDuration(time, 'ms');
  } catch (e) {
    return null;
  }
}

function isValidTimeDuration(time: unknown): time is srk.TimeDuration {
  if (!Array.isArray(time) || time.length !== 2 || !TIME_UNITS.includes(time[1])) {
    return false;
  }
  try {
    formatTimeDuration(time as srk.TimeDuration, 'ms');
    return true;
  } catch (e) {
    return false;
  }
}

function getTrueTimePrecision(time: srk.TimeDuration | undefined): srk.TimeUnit | null {
  const ms = timeToMs(time);
  if (ms === null || ms === 0) {
    return null;
  }
  const coarsestToFinest = [...TIME_UNITS].reverse();
  return coarsestToFinest.find((unit) => Number.isInteger(ms / TIME_UNIT_MS[unit])) || 'ms';
}

function compareTime(a: srk.TimeDuration, b: srk.TimeDuration): number | null {
  const aValue = timeToMs(a);
  const bValue = timeToMs(b);
  return aValue === null || bValue === null ? null : aValue - bValue;
}

function timeEqual(a: srk.TimeDuration | undefined, b: srk.TimeDuration | undefined): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return compareTime(a, b) === 0;
}

function isNoPenaltyResult(result: unknown, config: ICPCDiagnosticsConfig): boolean {
  return config.noPenaltyResults.some((item) => item === result);
}

function computeStatus(
  status: srk.RankProblemStatus | undefined,
  config: ICPCDiagnosticsConfig,
): RanklistComputedStatus {
  if (!status) {
    return {
      result: null,
      tries: 0,
      accepted: false,
      acceptedSolutionIndex: null,
      confidence: 'none',
    };
  }
  const solutions = Array.isArray(status.solutions) ? status.solutions : [];
  if (!solutions.length) {
    return {
      result: status.result ?? null,
      time: isValidTimeDuration(status.time) ? status.time : undefined,
      tries: Number.isInteger(status.tries) && status.tries! > 0 ? status.tries! : 0,
      accepted: isAcceptedResult(status.result),
      acceptedSolutionIndex: null,
      confidence: status.result !== null || !!status.tries || !!status.time ? 'summary' : 'none',
    };
  }

  let result: srk.SolutionResultLite = null;
  let time: srk.TimeDuration | undefined;
  let tries = 0;
  let accepted = false;
  let acceptedSolutionIndex: number | null = null;
  for (let i = 0; i < solutions.length; i++) {
    const solution = solutions[i];
    if (typeof solution.result !== 'string') {
      continue;
    }
    const solutionResult = solution.result;
    const noPenalty = isNoPenaltyResult(solutionResult, config);
    if (solutionResult === '?') {
      result = solutionResult;
      if (!noPenalty) {
        tries++;
      }
      continue;
    }
    if (isAcceptedResult(solutionResult)) {
      result = solutionResult;
      time = isValidTimeDuration(solution.time) ? solution.time : undefined;
      tries++;
      accepted = true;
      acceptedSolutionIndex = i;
      break;
    }
    if (noPenalty) {
      continue;
    }
    result = 'RJ';
    tries++;
  }
  return {
    result,
    time,
    tries,
    accepted,
    acceptedSolutionIndex,
    confidence: 'solutions',
  };
}

function computeRanklist(
  ranklist: srk.Ranklist,
  configOverride?: ICPCDiagnosticsConfig,
): { rows: RanklistComputedRow[]; statistics: srk.ProblemStatistics[] } | null {
  const config = configOverride || getICPCConfig(ranklist);
  if (!config) {
    return null;
  }
  const problemCount = ranklist.problems.length;
  const acceptedCounts = new Array(problemCount).fill(0);
  const submittedCounts = new Array(problemCount).fill(0);
  const rows: RanklistComputedRow[] = ranklist.rows.map((row, rowIndex) => {
    const statuses: RanklistComputedStatus[] = [];
    let scoreValue = 0;
    let totalTimeMs = 0;
    for (let problemIndex = 0; problemIndex < problemCount; problemIndex++) {
      const computedStatus = computeStatus(row.statuses[problemIndex], config);
      statuses.push(computedStatus);
      if (computedStatus.accepted) {
        acceptedCounts[problemIndex]++;
        scoreValue++;
      }
      submittedCounts[problemIndex] += computedStatus.tries;
      if (computedStatus.accepted && computedStatus.time) {
        const targetUnit = config.timePrecision || 'ms';
        const targetTime: srk.TimeDuration = [
          formatTimeDuration(computedStatus.time, targetUnit, getRoundingFn(config.timeRounding)),
          targetUnit,
        ];
        totalTimeMs +=
          formatTimeDuration(targetTime, 'ms') + (computedStatus.tries - 1) * formatTimeDuration(config.penalty, 'ms');
      }
    }
    return {
      rowIndex,
      userId: getUserId(row, rowIndex),
      score: {
        value: scoreValue,
        time: [totalTimeMs, 'ms'],
      },
      statuses,
    };
  });
  return {
    rows,
    statistics: ranklist.problems.map((_, index) => ({
      accepted: acceptedCounts[index],
      submitted: submittedCounts[index],
    })),
  };
}

function computeSummaryScoreTime(row: srk.RanklistRow, candidate: ICPCTimePrecisionCandidate): srk.TimeDuration | null {
  const config = getDefaultICPCConfig({
    timePrecision: candidate.timePrecision,
    timeRounding: candidate.timeRounding,
  });
  let totalTimeMs = 0;
  for (const status of row.statuses) {
    if (!isAcceptedResult(status.result)) {
      continue;
    }
    if (!isValidTimeDuration(status.time)) {
      return null;
    }
    const tries = Number.isInteger(status.tries) && status.tries! > 0 ? status.tries! : 1;
    const targetTime: srk.TimeDuration = [
      formatTimeDuration(status.time, candidate.timePrecision, getRoundingFn(candidate.timeRounding)),
      candidate.timePrecision,
    ];
    totalTimeMs += formatTimeDuration(targetTime, 'ms') + (tries - 1) * formatTimeDuration(config.penalty, 'ms');
  }
  return [totalTimeMs, 'ms'];
}

function getDeclaredTimePrecision(ranklist: srk.Ranklist): ICPCTimePrecisionCandidate | undefined {
  if (ranklist.sorter?.algorithm !== 'ICPC') {
    return undefined;
  }
  const config = ranklist.sorter.config || {};
  const hasDeclaredTimePrecision = isTimeUnit(config.timePrecision);
  const hasDeclaredTimeRounding = isTimeRounding(config.timeRounding);
  if (!hasDeclaredTimePrecision && !hasDeclaredTimeRounding) {
    return undefined;
  }
  return {
    timePrecision: hasDeclaredTimePrecision ? config.timePrecision! : 'ms',
    timeRounding: hasDeclaredTimeRounding ? config.timeRounding! : 'floor',
  };
}

function analyzeICPCTimePrecision(ranklist: srk.Ranklist): ICPCTimePrecisionDiagnostics | undefined {
  if (ranklist.sorter?.algorithm !== 'ICPC') {
    return undefined;
  }
  const declared = getDeclaredTimePrecision(ranklist);
  const candidates: ICPCTimePrecisionCandidate[] = TIME_UNITS.flatMap((timePrecision) =>
    TIME_ROUNDINGS.map((timeRounding) => ({ timePrecision, timeRounding })),
  );
  const validityProbe: ICPCTimePrecisionCandidate = { timePrecision: 'ms', timeRounding: 'floor' };
  const checkableRows = ranklist.rows.filter((row) => {
    if (row.score?.time !== undefined && !isValidTimeDuration(row.score.time)) {
      return false;
    }
    return !!computeSummaryScoreTime(row, validityProbe);
  });
  const possible = candidates.filter((candidate) => {
    for (const row of checkableRows) {
      const computedTime = computeSummaryScoreTime(row, candidate);
      if (!computedTime) {
        return false;
      }
      if (!scoreTimeEqual(row.score?.time, computedTime)) {
        return false;
      }
    }
    return checkableRows.length > 0;
  });
  const checked = checkableRows.length > 0;
  const matchedDeclared = declared
    ? possible.some(
        (candidate) =>
          candidate.timePrecision === declared.timePrecision && candidate.timeRounding === declared.timeRounding,
      )
    : null;
  return {
    checked,
    declared,
    possible,
    matchedDeclared,
  };
}

function getComputedRowOrder(ranklist: srk.Ranklist, computedRows: RanklistComputedRow[]): string[] {
  if (ranklist.sorter?.algorithm === 'ICPC') {
    const config = getICPCConfig(ranklist);
    const rowsForSort = computedRows.map((computedRow) => ({
      user: ranklist.rows[computedRow.rowIndex].user,
      statuses: ranklist.rows[computedRow.rowIndex].statuses,
      score: computedRow.score,
    }));
    sortRows(rowsForSort, {
      rankingTimePrecision: config?.rankingTimePrecision,
      rankingTimeRounding: config?.rankingTimeRounding,
    });
    return rowsForSort.map((row, index) => {
      const originalIndex = ranklist.rows.findIndex((originalRow) => originalRow.user === row.user);
      return getUserId(row as srk.RanklistRow, originalIndex === -1 ? index : originalIndex);
    });
  }
  if (ranklist.sorter?.algorithm === 'score') {
    return [...ranklist.rows]
      .sort((a, b) => b.score.value - a.score.value)
      .map((row, index) => getUserId(row, ranklist.rows.indexOf(row) === -1 ? index : ranklist.rows.indexOf(row)));
  }
  return ranklist.rows.map((row, index) => getUserId(row, index));
}

function statisticsEqual(a: srk.ProblemStatistics | undefined, b: srk.ProblemStatistics): boolean {
  return !!a && a.accepted === b.accepted && a.submitted === b.submitted;
}

function scoreTimeEqual(declared: srk.TimeDuration | undefined, computed: srk.TimeDuration | undefined): boolean {
  if (!declared && timeToMs(computed) === 0) {
    return true;
  }
  return timeEqual(declared, computed);
}

function getFBDeclaredByProblem(declaredFB: FBCandidate[], problemIndex: number): FBCandidate[] {
  return declaredFB.filter((candidate) => candidate.problemIndex === problemIndex);
}

function getUniqueFBCandidates(candidates: FBCandidate[]): FBCandidate[] {
  const byIdentity = new Map<string, FBCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.problemIndex}:${candidate.rowIndex}`;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, candidate);
    }
  }
  return [...byIdentity.values()];
}

function candidateResultMatches(a: FBCandidate, b: FBCandidate): boolean {
  return a.problemIndex === b.problemIndex && a.rowIndex === b.rowIndex;
}

function candidateTimeMatches(a: FBCandidate, b: FBCandidate): boolean {
  return compareTime(a.time, b.time) === 0;
}

function getFirstAcceptedSolution(status: srk.RankProblemStatus): { solution: srk.Solution; index: number } | null {
  const solutions = Array.isArray(status.solutions) ? status.solutions : [];
  for (let i = 0; i < solutions.length; i++) {
    if (isAcceptedResult(solutions[i].result)) {
      return {
        solution: solutions[i],
        index: i,
      };
    }
  }
  return null;
}

function needsFBResultOverride(ranklist: srk.Ranklist, candidate: FBCandidate): boolean {
  const status = ranklist.rows[candidate.rowIndex]?.statuses[candidate.problemIndex];
  if (!status) {
    return false;
  }
  if (status.result !== 'FB') {
    return true;
  }
  const acceptedSolution = getFirstAcceptedSolution(status);
  return !!acceptedSolution && acceptedSolution.solution.result !== 'FB';
}

function flattenUniqueIssues(groups: RanklistDiagnosticIssue[][]): RanklistDiagnosticIssue[] {
  const issues: RanklistDiagnosticIssue[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const issue of group) {
      const key = `${issue.code}\n${issue.path}\n${issue.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push(issue);
      }
    }
  }
  return issues;
}

export function checkProblemStatistics(ranklist: srk.Ranklist): ProblemStatisticsDiagnosticsReport {
  const computed = computeRanklist(ranklist, getICPCConfig(ranklist) || getDefaultICPCConfig());
  const declared = ranklist.problems.map((problem) => problem.statistics);
  const hasSolutions = hasDetailedSolutions(ranklist);
  const confidence = getSolutionCoverage(ranklist);
  if (!hasSolutions) {
    return {
      skipped: true,
      hasSolutions,
      confidence: 'none',
      computed: computed?.statistics || ranklist.problems.map(() => ({ accepted: 0, submitted: 0 })),
      declared,
      issues: [],
    };
  }

  const issues: RanklistDiagnosticIssue[] = [];
  if (confidence === 'partial') {
    issues.push(
      makeIssue(
        'problem-statistics-partial-solutions',
        'info',
        'Problem statistics were computed with detailed solutions where available and summary fields elsewhere.',
        'rows',
      ),
    );
  }

  const statistics = computed?.statistics || ranklist.problems.map(() => ({ accepted: 0, submitted: 0 }));
  statistics.forEach((statistic, index) => {
    const declaredStatistic = ranklist.problems[index].statistics;
    if (!declaredStatistic && (statistic.accepted > 0 || statistic.submitted > 0)) {
      issues.push(
        makeIssue(
          'problem-statistics-missing',
          'warning',
          'Problem statistics are missing.',
          `problems[${index}].statistics`,
          {
            expected: statistic,
            actual: undefined,
          },
        ),
      );
      return;
    }
    if (declaredStatistic && !statisticsEqual(declaredStatistic, statistic)) {
      issues.push(
        makeIssue(
          'problem-statistics-mismatch',
          'warning',
          'Problem statistics do not match the computed submission statistics.',
          `problems[${index}].statistics`,
          {
            expected: statistic,
            actual: declaredStatistic,
          },
        ),
      );
    }
  });

  return {
    skipped: false,
    hasSolutions,
    confidence,
    computed: statistics,
    declared,
    issues,
  };
}

export function checkSeriesConfiguration(ranklist: srk.Ranklist): SeriesDiagnosticsReport {
  const issues: RanklistDiagnosticIssue[] = [];
  const summaries: ICPCSeriesConfigSummary[] = [];

  ranklist.series.forEach((series, seriesIndex) => {
    if (!isICPCSeries(series)) {
      return;
    }
    const options = series.rule.options || ({} as srk.RankSeriesRulePresetICPC['options']);
    const count = options.count;
    const ratio = options.ratio;
    const countValue = count && Array.isArray(count.value) ? count.value : undefined;
    const ratioValue = ratio && Array.isArray(ratio.value) ? ratio.value : undefined;
    const countTotal = sumNumericValues(countValue);
    const ratioTotal = sumNumericValues(ratioValue);
    const hasCount = !!countValue;
    const hasRatio = !!ratioValue;
    const countIsEmpty = hasCount && (!countValue.length || countTotal === 0);
    const ratioIsEmpty = hasRatio && (!ratioValue.length || ratioTotal === 0);
    const hasAllocationConfig = hasCount || hasRatio;
    const isEmpty = !hasAllocationConfig || countIsEmpty || ratioIsEmpty;
    const summary: ICPCSeriesConfigSummary = {
      seriesIndex,
      title: series.title,
      path: `series[${seriesIndex}]`,
      segmentCount: Array.isArray(series.segments) ? series.segments.length : 0,
      hasCount,
      countValue,
      countTotal,
      countIsEmpty,
      hasRatio,
      ratioValue,
      ratioTotal,
      ratioIsEmpty,
      byMarker: typeof options.filter?.byMarker === 'string' ? options.filter.byMarker : undefined,
      hasFilter: !!options.filter,
      hasAllocationConfig,
      isEmpty,
    };
    summaries.push(summary);

    if (!hasAllocationConfig) {
      issues.push(
        makeIssue(
          'icpc-series-empty-config',
          'warning',
          'ICPC series does not define count or ratio segment allocation.',
          `series[${seriesIndex}].rule.options`,
          { actual: options },
        ),
      );
    }
    if (countIsEmpty) {
      issues.push(
        makeIssue(
          'icpc-series-count-empty',
          'warning',
          'ICPC series count config does not allocate any segment.',
          `series[${seriesIndex}].rule.options.count.value`,
          { actual: countValue },
        ),
      );
    }
    if (ratioIsEmpty) {
      issues.push(
        makeIssue(
          'icpc-series-ratio-empty',
          'warning',
          'ICPC series ratio config does not allocate any segment.',
          `series[${seriesIndex}].rule.options.ratio.value`,
          { actual: ratioValue },
        ),
      );
    }
  });

  if (!summaries.length) {
    issues.push(
      makeIssue(
        'icpc-series-missing',
        'warning',
        'Ranklist does not define any ICPC series.',
        'series',
        { actual: ranklist.series.length },
      ),
    );
  }

  return {
    icpc: {
      hasICPCSeries: summaries.length > 0,
      seriesCount: summaries.length,
      summaries,
    },
    issues,
  };
}

export function checkFB(ranklist: srk.Ranklist): FBDiagnosticsReport {
  const issues: RanklistDiagnosticIssue[] = [];
  const declaredFB: FBCandidate[] = [];
  const computedFB: FBComputedProblem[] = ranklist.problems.map((_, problemIndex) => ({
    problemIndex,
    candidates: [],
    multiplePossible: false,
    usable: false,
  }));

  for (let rowIndex = 0; rowIndex < ranklist.rows.length; rowIndex++) {
    const row = ranklist.rows[rowIndex];
    const userId = getUserId(row, rowIndex);
    for (let problemIndex = 0; problemIndex < ranklist.problems.length; problemIndex++) {
      const status = row.statuses[problemIndex];
      if (!status) {
        continue;
      }
      const acceptedSolution = getFirstAcceptedSolution(status);
      if (acceptedSolution) {
        const candidate: FBCandidate = {
          problemIndex,
          rowIndex,
          userId,
          time: acceptedSolution.solution.time,
          result: acceptedSolution.solution.result as 'AC' | 'FB',
          source: 'solution',
          solutionIndex: acceptedSolution.index,
          path: `rows[${rowIndex}].statuses[${problemIndex}].solutions[${acceptedSolution.index}]`,
        };
        const current = computedFB[problemIndex].candidates;
        if (!current.length) {
          current.push(candidate);
        } else {
          const comparison = compareTime(candidate.time, current[0].time);
          if (comparison !== null && comparison < 0) {
            computedFB[problemIndex].candidates = [candidate];
          } else if (comparison === 0) {
            current.push(candidate);
          }
        }
      } else if (isAcceptedResult(status.result) && status.time) {
        const candidate: FBCandidate = {
          problemIndex,
          rowIndex,
          userId,
          time: status.time,
          result: status.result,
          source: 'status',
          path: `rows[${rowIndex}].statuses[${problemIndex}]`,
        };
        const current = computedFB[problemIndex].candidates;
        if (!current.length) {
          current.push(candidate);
        } else {
          const comparison = compareTime(candidate.time, current[0].time);
          if (comparison !== null && comparison < 0) {
            computedFB[problemIndex].candidates = [candidate];
          } else if (comparison === 0) {
            current.push(candidate);
          }
        }
      }

      if (status.result === 'FB' && status.time) {
        declaredFB.push({
          problemIndex,
          rowIndex,
          userId,
          time: status.time,
          result: 'FB',
          source: 'status',
          path: `rows[${rowIndex}].statuses[${problemIndex}]`,
        });
        if (acceptedSolution?.solution.result === 'AC') {
          issues.push(
            makeIssue(
              'FB-summary-solution-AC',
              'warning',
              'Status declares FB while the accepted solution is declared as AC.',
              `rows[${rowIndex}].statuses[${problemIndex}]`,
              {
                expected: 'FB',
                actual: 'AC',
                context: { solutionIndex: acceptedSolution.index },
              },
            ),
          );
        } else if (!acceptedSolution && Array.isArray(status.solutions) && status.solutions.length > 0) {
          issues.push(
            makeIssue(
              'FB-declaration-incomplete',
              'warning',
              'Status declares FB but detailed solutions do not contain an accepted submission.',
              `rows[${rowIndex}].statuses[${problemIndex}]`,
            ),
          );
        }
      }
      if (status.result === 'AC' && acceptedSolution?.solution.result === 'FB') {
        issues.push(
          makeIssue(
            'FB-solution-summary-AC',
            'warning',
            'Solution declares FB while the summary status is declared as AC.',
            `rows[${rowIndex}].statuses[${problemIndex}]`,
            {
              expected: 'FB',
              actual: 'AC',
              context: { solutionIndex: acceptedSolution.index },
            },
          ),
        );
      }
      const solutions = Array.isArray(status.solutions) ? status.solutions : [];
      for (let solutionIndex = 0; solutionIndex < solutions.length; solutionIndex++) {
        const solution = solutions[solutionIndex];
        if (solution.result === 'FB' && acceptedSolution?.index === solutionIndex) {
          declaredFB.push({
            problemIndex,
            rowIndex,
            userId,
            time: solution.time,
            result: 'FB',
            source: 'solution',
            solutionIndex,
            path: `rows[${rowIndex}].statuses[${problemIndex}].solutions[${solutionIndex}]`,
          });
        }
      }
    }
  }

  let canEnhance = false;
  let shouldOverride = false;
  for (const computed of computedFB) {
    computed.multiplePossible = computed.candidates.length > 1;
    computed.usable = computed.candidates.length === 1;
    const declaredForProblem = getFBDeclaredByProblem(declaredFB, computed.problemIndex);
    if (computed.candidates.length && !declaredForProblem.length) {
      canEnhance = canEnhance || computed.usable;
      shouldOverride = shouldOverride || computed.usable;
      issues.push(
        makeIssue(
          'FB-missing',
          'warning',
          'This problem has computed FB candidates but no FB declaration.',
          `problems[${computed.problemIndex}]`,
          {
            expected: computed.candidates,
            actual: [],
          },
        ),
      );
    }
    if (computed.multiplePossible) {
      issues.push(
        makeIssue(
          'FB-multiple-possible',
          'warning',
          'Multiple submissions share the earliest accepted time and may all be FB.',
          `problems[${computed.problemIndex}]`,
          {
            expected: computed.candidates,
          },
        ),
      );
    }
    for (const declared of declaredForProblem) {
      const matchedCandidate = computed.candidates.find((candidate) => candidateResultMatches(candidate, declared));
      if (computed.candidates.length && !matchedCandidate) {
        shouldOverride = shouldOverride || computed.usable;
        issues.push(
          makeIssue('FB-declaration-invalid', 'error', 'Declared FB does not match computed FB.', declared.path, {
            expected: computed.candidates,
            actual: declared,
          }),
        );
      } else if (matchedCandidate && !candidateTimeMatches(matchedCandidate, declared)) {
        issues.push(
          makeIssue(
            'FB-declaration-time-mismatch',
            'warning',
            'Declared FB result matches computed FB, but its time differs.',
            declared.path,
            {
              expected: matchedCandidate,
              actual: declared,
            },
          ),
        );
      }
    }
    if (computed.usable) {
      shouldOverride = shouldOverride || needsFBResultOverride(ranklist, computed.candidates[0]);
    }
  }

  const declaredFBByProblem: FBDeclaredProblem[] = computedFB.map((computed) => {
    const candidates = getFBDeclaredByProblem(declaredFB, computed.problemIndex);
    const uniqueCandidates = getUniqueFBCandidates(candidates);
    const singleDeclaredWithComputedMultiple =
      computed.multiplePossible &&
      uniqueCandidates.length === 1 &&
      computed.candidates.some((candidate) => candidateResultMatches(candidate, uniqueCandidates[0]));
    return {
      problemIndex: computed.problemIndex,
      candidates,
      uniqueCandidates,
      multipleDeclared: uniqueCandidates.length > 1,
      singleDeclaredWithComputedMultiple,
      declaredHasHigherPrecision: singleDeclaredWithComputedMultiple,
    };
  });

  return {
    hasDeclaredFB: declaredFB.length > 0,
    hasComputedFB: computedFB.some((computed) => computed.candidates.length > 0),
    hasComputedMultiplePossible: computedFB.some((computed) => computed.multiplePossible),
    hasDeclaredMultipleFB: declaredFBByProblem.some((declared) => declared.multipleDeclared),
    canEnhance,
    shouldOverride,
    computedFB,
    declaredFB,
    declaredFBByProblem,
    issues,
  };
}

export function checkRanklistDataValidity(ranklist: srk.Ranklist): RanklistDataValidityReport {
  const issues: RanklistDiagnosticIssue[] = [];
  const userIdIndexMap = new Map<string, number>();
  const markerIdIndexMap = new Map<string, number>();
  const markerIds = new Set<string>();
  const problemCount = ranklist.problems.length;

  const checkMarkerReference = (markerId: unknown, path: string, code = 'marker-reference-missing') => {
    if (typeof markerId !== 'string' || markerId === '' || markerIds.has(markerId)) {
      return;
    }
    issues.push(
      makeIssue(code, 'warning', 'Marker id must reference a top-level marker definition.', path, {
        actual: markerId,
      }),
    );
  };

  const markers = Array.isArray(ranklist.markers) ? ranklist.markers : [];
  for (let markerIndex = 0; markerIndex < markers.length; markerIndex++) {
    const marker = markers[markerIndex];
    if (!marker.id) {
      issues.push(makeIssue('marker-id-missing', 'error', 'Marker id is required.', `markers[${markerIndex}].id`));
      continue;
    }
    if (markerIdIndexMap.has(marker.id)) {
      issues.push(
        makeIssue('duplicate-marker-id', 'error', 'Marker id must be unique within the ranklist.', `markers[${markerIndex}].id`, {
          actual: marker.id,
          context: { firstMarkerIndex: markerIdIndexMap.get(marker.id) },
        }),
      );
      continue;
    }
    markerIdIndexMap.set(marker.id, markerIndex);
    markerIds.add(marker.id);
  }

  ranklist.series.forEach((series, seriesIndex) => {
    if (!isICPCSeries(series)) {
      return;
    }
    checkMarkerReference(
      series.rule.options?.filter?.byMarker,
      `series[${seriesIndex}].rule.options.filter.byMarker`,
      'series-filter-marker-reference-missing',
    );
  });

  if (ranklist.sorter?.algorithm === 'ICPC') {
    const config = ranklist.sorter.config as {
      penalty?: unknown;
      timePrecision?: unknown;
      timeRounding?: unknown;
      rankingTimePrecision?: unknown;
      rankingTimeRounding?: unknown;
    };
    if (config.penalty !== undefined && !isValidTimeDuration(config.penalty)) {
      issues.push(
        makeIssue(
          'sorter-penalty-invalid',
          'error',
          'ICPC sorter penalty must be a valid TimeDuration.',
          'sorter.config.penalty',
          {
            actual: config.penalty,
          },
        ),
      );
    }
    if (config.timePrecision !== undefined && !isTimeUnit(config.timePrecision)) {
      issues.push(
        makeIssue(
          'sorter-time-precision-invalid',
          'error',
          'ICPC sorter timePrecision must be a valid TimeUnit.',
          'sorter.config.timePrecision',
          {
            actual: config.timePrecision,
          },
        ),
      );
    }
    if (config.timeRounding !== undefined && !isTimeRounding(config.timeRounding)) {
      issues.push(
        makeIssue(
          'sorter-time-rounding-invalid',
          'error',
          'ICPC sorter timeRounding must be floor, ceil, or round.',
          'sorter.config.timeRounding',
          {
            actual: config.timeRounding,
          },
        ),
      );
    }
    if (config.rankingTimePrecision !== undefined && !isTimeUnit(config.rankingTimePrecision)) {
      issues.push(
        makeIssue(
          'sorter-ranking-time-precision-invalid',
          'error',
          'ICPC sorter rankingTimePrecision must be a valid TimeUnit.',
          'sorter.config.rankingTimePrecision',
          {
            actual: config.rankingTimePrecision,
          },
        ),
      );
    }
    if (config.rankingTimeRounding !== undefined && !isTimeRounding(config.rankingTimeRounding)) {
      issues.push(
        makeIssue(
          'sorter-ranking-time-rounding-invalid',
          'error',
          'ICPC sorter rankingTimeRounding must be floor, ceil, or round.',
          'sorter.config.rankingTimeRounding',
          {
            actual: config.rankingTimeRounding,
          },
        ),
      );
    }
  }

  const timePrecision = analyzeICPCTimePrecision(ranklist);
  if (timePrecision?.declared && timePrecision.checked && timePrecision.matchedDeclared === false) {
    issues.push(
      makeIssue(
        'sorter-time-precision-config-mismatch',
        'error',
        'Declared ICPC sorter time precision config does not match score times computed from status summaries.',
        'sorter.config',
        {
          expected: timePrecision.possible,
          actual: timePrecision.declared,
        },
      ),
    );
  }

  for (let problemIndex = 0; problemIndex < ranklist.problems.length; problemIndex++) {
    const statistics = ranklist.problems[problemIndex].statistics;
    if (statistics) {
      if (!Number.isInteger(statistics.accepted) || statistics.accepted < 0) {
        issues.push(
          makeIssue(
            'problem-statistics-accepted-invalid',
            'error',
            'Problem accepted count must be a non-negative integer.',
            `problems[${problemIndex}].statistics.accepted`,
            {
              actual: statistics.accepted,
            },
          ),
        );
      }
      if (!Number.isInteger(statistics.submitted) || statistics.submitted < 0) {
        issues.push(
          makeIssue(
            'problem-statistics-submitted-invalid',
            'error',
            'Problem submitted count must be a non-negative integer.',
            `problems[${problemIndex}].statistics.submitted`,
            {
              actual: statistics.submitted,
            },
          ),
        );
      }
      if (statistics.accepted > statistics.submitted) {
        issues.push(
          makeIssue(
            'problem-statistics-invalid',
            'error',
            'Problem accepted count cannot exceed submitted count.',
            `problems[${problemIndex}].statistics`,
            {
              actual: statistics,
            },
          ),
        );
      }
    }
  }

  for (let rowIndex = 0; rowIndex < ranklist.rows.length; rowIndex++) {
    const row = ranklist.rows[rowIndex];
    const userId = row.user?.id;
    if (!userId) {
      issues.push(makeIssue('user-id-missing', 'error', 'User id is required.', `rows[${rowIndex}].user.id`));
    } else if (userIdIndexMap.has(userId)) {
      issues.push(
        makeIssue(
          'duplicate-user-id',
          'error',
          'User id must be unique within the ranklist.',
          `rows[${rowIndex}].user.id`,
          {
            actual: userId,
            context: { firstRowIndex: userIdIndexMap.get(userId) },
          },
        ),
      );
    } else {
      userIdIndexMap.set(userId, rowIndex);
    }

    const userMarkers = Array.isArray(row.user?.markers) ? row.user.markers : [];
    for (let markerIndex = 0; markerIndex < userMarkers.length; markerIndex++) {
      checkMarkerReference(userMarkers[markerIndex], `rows[${rowIndex}].user.markers[${markerIndex}]`);
    }
    checkMarkerReference(row.user?.marker, `rows[${rowIndex}].user.marker`);

    if (!Number.isFinite(row.score?.value)) {
      issues.push(
        makeIssue(
          'row-score-value-invalid',
          'error',
          'Row score value must be finite.',
          `rows[${rowIndex}].score.value`,
          {
            actual: row.score?.value,
          },
        ),
      );
    }
    if (row.score?.time && !isValidTimeDuration(row.score.time)) {
      issues.push(
        makeIssue(
          'row-score-time-invalid',
          'error',
          'Row score time must be a valid TimeDuration.',
          `rows[${rowIndex}].score.time`,
          { actual: row.score.time },
        ),
      );
    }
    if (row.statuses.length !== problemCount) {
      issues.push(
        makeIssue(
          'statuses-length-mismatch',
          'error',
          'Row statuses length must match problems length.',
          `rows[${rowIndex}].statuses`,
          {
            expected: problemCount,
            actual: row.statuses.length,
          },
        ),
      );
    }
    for (let problemIndex = 0; problemIndex < row.statuses.length; problemIndex++) {
      const status = row.statuses[problemIndex];
      const statusPath = `rows[${rowIndex}].statuses[${problemIndex}]`;
      if (status.result !== null && !LITE_RESULTS.has(status.result as string)) {
        issues.push(
          makeIssue(
            'status-result-invalid',
            'error',
            'Status result must be a lite result value.',
            `${statusPath}.result`,
            {
              actual: status.result,
            },
          ),
        );
      }
      if (status.tries !== undefined && (!Number.isInteger(status.tries) || status.tries < 0)) {
        issues.push(
          makeIssue(
            'status-tries-invalid',
            'error',
            'Status tries must be a non-negative integer.',
            `${statusPath}.tries`,
            {
              actual: status.tries,
            },
          ),
        );
      }
      if (status.time && !isValidTimeDuration(status.time)) {
        issues.push(
          makeIssue('status-time-invalid', 'error', 'Status time must be a valid TimeDuration.', `${statusPath}.time`, {
            actual: status.time,
          }),
        );
      }
      const solutions = Array.isArray(status.solutions) ? status.solutions : [];
      for (let solutionIndex = 0; solutionIndex < solutions.length; solutionIndex++) {
        const solution = solutions[solutionIndex];
        const solutionPath = `${statusPath}.solutions[${solutionIndex}]`;
        if (typeof solution.result !== 'string') {
          issues.push(
            makeIssue(
              'solution-result-invalid',
              'error',
              'Solution result must be a string and must not be null.',
              `${solutionPath}.result`,
              {
                actual: solution.result,
              },
            ),
          );
        }
        if (!isValidTimeDuration(solution.time)) {
          issues.push(
            makeIssue(
              'solution-time-invalid',
              'error',
              'Solution time must be a valid TimeDuration.',
              `${solutionPath}.time`,
              {
                actual: solution.time,
              },
            ),
          );
        }
        if (
          solutionIndex > 0 &&
          isValidTimeDuration(solution.time) &&
          isValidTimeDuration(solutions[solutionIndex - 1].time)
        ) {
          const comparison = compareTime(solutions[solutionIndex - 1].time, solution.time);
          if (comparison !== null && comparison > 0) {
            issues.push(
              makeIssue(
                'solution-order-mismatch',
                'warning',
                'Solutions must be ordered by submission time ascending.',
                `${statusPath}.solutions`,
                {
                  context: { previousIndex: solutionIndex - 1, currentIndex: solutionIndex },
                },
              ),
            );
            break;
          }
        }
      }
    }
  }

  const computed = computeRanklist(ranklist);
  if (computed) {
    for (const computedRow of computed.rows) {
      const row = ranklist.rows[computedRow.rowIndex];
      for (let problemIndex = 0; problemIndex < Math.min(row.statuses.length, problemCount); problemIndex++) {
        const status = row.statuses[problemIndex];
        const computedStatus = computedRow.statuses[problemIndex];
        const statusHasSolutions = Array.isArray(status.solutions) && status.solutions.length > 0;
        if (!statusHasSolutions) {
          continue;
        }
        const statusPath = `rows[${computedRow.rowIndex}].statuses[${problemIndex}]`;
        if (status.result !== computedStatus.result) {
          issues.push(
            makeIssue(
              'status-result-mismatch',
              'warning',
              'Status result does not match computed result from solutions.',
              `${statusPath}.result`,
              {
                expected: computedStatus.result,
                actual: status.result,
              },
            ),
          );
        }
        if (!timeEqual(status.time, computedStatus.time)) {
          issues.push(
            makeIssue(
              'status-time-mismatch',
              'warning',
              'Status time does not match the first accepted solution time.',
              `${statusPath}.time`,
              {
                expected: computedStatus.time,
                actual: status.time,
              },
            ),
          );
        }
        if (
          (status.tries === undefined || (Number.isInteger(status.tries) && status.tries >= 0)) &&
          (status.tries || 0) !== computedStatus.tries
        ) {
          issues.push(
            makeIssue(
              'status-tries-mismatch',
              'warning',
              'Status tries do not match effective tries computed from solutions.',
              `${statusPath}.tries`,
              {
                expected: computedStatus.tries,
                actual: status.tries,
              },
            ),
          );
        }
      }
      if (row.score.value !== computedRow.score.value) {
        issues.push(
          makeIssue(
            'row-score-value-mismatch',
            'warning',
            'Row score value does not match computed solved count.',
            `rows[${computedRow.rowIndex}].score.value`,
            {
              expected: computedRow.score.value,
              actual: row.score.value,
            },
          ),
        );
      }
      if (!scoreTimeEqual(row.score.time, computedRow.score.time)) {
        issues.push(
          makeIssue(
            'row-score-time-mismatch',
            'warning',
            'Row score time does not match computed penalty time.',
            `rows[${computedRow.rowIndex}].score.time`,
            {
              expected: computedRow.score.time,
              actual: row.score.time,
            },
          ),
        );
      }
    }

    for (let problemIndex = 0; problemIndex < computed.statistics.length; problemIndex++) {
      const declared = ranklist.problems[problemIndex].statistics;
      if (declared && !statisticsEqual(declared, computed.statistics[problemIndex])) {
        issues.push(
          makeIssue(
            'problem-statistics-mismatch',
            'warning',
            'Problem statistics do not match the computed submission statistics.',
            `problems[${problemIndex}].statistics`,
            {
              expected: computed.statistics[problemIndex],
              actual: declared,
            },
          ),
        );
      }
    }

    const computedOrder = getComputedRowOrder(ranklist, computed.rows);
    const actualOrder = ranklist.rows.map((row, index) => getUserId(row, index));
    const rowOrderMatches = computedOrder.join('\n') === actualOrder.join('\n');
    if (!rowOrderMatches) {
      issues.push(
        makeIssue(
          'rows-order-mismatch',
          'warning',
          'Rows are not ordered according to the declared sorter and computed scores.',
          'rows',
          {
            expected: computedOrder,
            actual: actualOrder,
          },
        ),
      );
    }
    return {
      confidence: getSolutionCoverage(ranklist),
      timePrecision,
      computed: {
        rows: computed.rows,
        statistics: computed.statistics,
        rowOrder: computedOrder,
        rowOrderMatches,
      },
      issues,
    };
  }

  if (ranklist.sorter?.algorithm === 'score') {
    const computedOrder = getComputedRowOrder(ranklist, []);
    const actualOrder = ranklist.rows.map((row, index) => getUserId(row, index));
    if (computedOrder.join('\n') !== actualOrder.join('\n')) {
      issues.push(
        makeIssue('rows-order-mismatch', 'warning', 'Rows are not ordered according to the score sorter.', 'rows', {
          expected: computedOrder,
          actual: actualOrder,
        }),
      );
    }
  }

  return {
    confidence: getSolutionCoverage(ranklist),
    timePrecision,
    issues,
  };
}

export function analyzeRanklistMetadata(ranklist: srk.Ranklist): RanklistMetadataAnalysis {
  let submissionPrecision: srk.TimeUnit | null = null;
  let hasDetailed = false;
  let hasFuzzyRJResults = false;
  let hasPreciseSolutionResults = false;
  let hasCustomSolutionResults = false;
  let hasFrozenSubmissions = false;
  let mockedSolutionCount = 0;

  const noteTime = (time: srk.TimeDuration | undefined) => {
    const truePrecision = getTrueTimePrecision(time);
    if (!truePrecision) {
      return;
    }
    if (submissionPrecision === null || TIME_UNITS.indexOf(truePrecision) < TIME_UNITS.indexOf(submissionPrecision)) {
      submissionPrecision = truePrecision;
    }
  };

  for (const row of ranklist.rows) {
    for (const status of row.statuses) {
      if (status.result === '?') {
        hasFrozenSubmissions = true;
      }
      const acceptedSolution = getFirstAcceptedSolution(status);
      const acceptedTimeMs = timeToMs(acceptedSolution?.solution.time);
      const solutions = Array.isArray(status.solutions) ? status.solutions : [];
      if (solutions.length) {
        hasDetailed = true;
      } else {
        noteTime(status.time);
      }
      for (const solution of solutions) {
        noteTime(solution.time);
        if (solution.result === '?') {
          hasFrozenSubmissions = true;
        }
        if (solution.result === 'RJ') {
          hasFuzzyRJResults = true;
        } else if (PRECISE_REJECTED_RESULTS.has(solution.result)) {
          hasPreciseSolutionResults = true;
        } else if (isRejectedResult(solution.result) && !PRECISE_REJECTED_RESULTS.has(solution.result)) {
          hasCustomSolutionResults = true;
        }
        const solutionTimeMs = timeToMs(solution.time);
        if (
          isRejectedResult(solution.result) &&
          (solutionTimeMs === 0 || (acceptedTimeMs !== null && solutionTimeMs === acceptedTimeMs))
        ) {
          mockedSolutionCount++;
        }
      }
    }
  }

  const FB = checkFB(ranklist);
  const declaredFBInvalid = FB.issues.some((issue) => issue.code === 'FB-declaration-invalid');
  const unresolvedComputedFBAmbiguity = FB.computedFB.some((computed) => {
    if (!computed.multiplePossible) {
      return false;
    }
    const declared = FB.declaredFBByProblem.find((item) => item.problemIndex === computed.problemIndex);
    return !declared?.declaredHasHigherPrecision;
  });
  const problemColorCount = ranklist.problems.filter((problem) => !!problem.style?.backgroundColor).length;
  const users = ranklist.rows.map((row) => row.user as srk.User & { photo?: srk.Image; location?: string });

  return {
    submissionPrecision,
    FB: {
      hasDeclared: FB.hasDeclaredFB,
      computedAvailable: FB.hasComputedFB,
      availability: declaredFBInvalid
        ? 'declared-invalid'
        : unresolvedComputedFBAmbiguity
        ? 'ambiguous'
        : FB.hasDeclaredFB
        ? 'declared-valid'
        : FB.hasComputedFB
        ? 'computed-only'
        : 'none',
    },
    hasProblemColors: problemColorCount > 0,
    problemColorCount,
    hasDetailedSolutions: hasDetailed,
    solutionCoverage: getSolutionCoverage(ranklist),
    solutionsAreLikelyMocked: mockedSolutionCount > 0,
    mockedSolutionCount,
    hasPreciseSolutionResults: hasPreciseSolutionResults && !hasFuzzyRJResults,
    hasFuzzyRJResults,
    hasCustomSolutionResults,
    hasFrozenSubmissions,
    hasTeamMembers: users.some((user) => Array.isArray(user.teamMembers) && user.teamMembers.length > 0),
    hasUserAvatar: users.some((user) => !!user.avatar),
    hasUserPhoto: users.some((user) => !!user.photo),
    hasUserLocation: users.some((user) => !!user.location),
    issues: [],
  };
}

export function diagnoseRanklist(ranklist: srk.Ranklist): RanklistDiagnosticsReport {
  const problemStatistics = checkProblemStatistics(ranklist);
  const series = checkSeriesConfiguration(ranklist);
  const FB = checkFB(ranklist);
  const dataValidity = checkRanklistDataValidity(ranklist);
  const metadata = analyzeRanklistMetadata(ranklist);
  const issues = flattenUniqueIssues([
    problemStatistics.issues,
    series.issues,
    FB.issues,
    dataValidity.issues,
    metadata.issues,
  ]);
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const infoCount = issues.filter((issue) => issue.severity === 'info').length;
  return {
    summary: {
      issueCount: issues.length,
      errorCount,
      warningCount,
      infoCount,
      hasErrors: errorCount > 0,
    },
    metadata,
    problemStatistics,
    series,
    FB,
    dataValidity,
    issues,
  };
}
