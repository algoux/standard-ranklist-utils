import type * as srk from '@algoux/standard-ranklist';
import { formatTimeDuration } from './formatters';
import { sortRows } from './ranklist';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type DiagnosticConfidence = 'low' | 'medium' | 'high' | 'certain';
export type CompletenessLevel = 'missing' | 'partial' | 'mostly' | 'complete' | 'notApplicable';
export type DiagnosticCheckStatus = 'pass' | 'warning' | 'fail' | 'notApplicable';

export interface RanklistDiagnosticIssue {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  confidence: DiagnosticConfidence;
  section: 'summary' | 'completeness' | 'correctness' | 'suggestions';
  item?: string;
  path?: string;
  rowIndex?: number;
  problemIndex?: number;
  userId?: string;
  details?: Record<string, any>;
}

export interface RanklistDiagnosticPrecision {
  actualUnit: srk.TimeUnit | null;
  declaredUnits: srk.TimeUnit[];
  sampleCount: number;
  invalidCount: number;
  zeroCount: number;
}

export interface RanklistDiagnosticCompletenessItem {
  key: string;
  label: string;
  level: CompletenessLevel;
  presentCount: number;
  totalCount: number;
  ratio: number | null;
  details: Record<string, any>;
}

export interface RanklistDiagnosticCheck {
  key: string;
  label: string;
  status: DiagnosticCheckStatus;
  checkedCount: number;
  failedCount: number;
  details: Record<string, any>;
}

export interface RanklistFirstBloodSuggestion {
  problemIndex: number;
  problemAlias?: string;
  userId: string;
  rowIndex: number;
  time: srk.TimeDuration;
}

export interface RanklistSorterSuggestion {
  config: Partial<srk.SorterICPC['config']>;
  confidence: DiagnosticConfidence;
  resolvedIssues: string[];
  details: Record<string, any>;
}

export interface RanklistProblemStatisticsSuggestion {
  problemIndex: number;
  problemAlias?: string;
  actual: srk.ProblemStatistics;
  expected: srk.ProblemStatistics;
  confidence: DiagnosticConfidence;
  reason: string;
  details: Record<string, any>;
}

export interface RanklistCompletenessItems {
  banner: RanklistDiagnosticCompletenessItem;
  firstBlood: RanklistDiagnosticCompletenessItem;
  problemColors: RanklistDiagnosticCompletenessItem;
  icpcSeries: RanklistDiagnosticCompletenessItem;
  userAvatar: RanklistDiagnosticCompletenessItem;
  userPhoto: RanklistDiagnosticCompletenessItem;
  teamMembers: RanklistDiagnosticCompletenessItem;
  coachRole: RanklistDiagnosticCompletenessItem;
  i18n: RanklistDiagnosticCompletenessItem;
  statuses: RanklistDiagnosticCompletenessItem;
  solutions: RanklistDiagnosticCompletenessItem;
  rowUserConsistency: RanklistDiagnosticCompletenessItem;
}

export interface RanklistCorrectnessChecks {
  firstBlood: RanklistDiagnosticCheck;
  problemStatistics: RanklistDiagnosticCheck;
  mockSolutions: RanklistDiagnosticCheck;
  statuses: RanklistDiagnosticCheck;
  statusSummaries: RanklistDiagnosticCheck;
  scores: RanklistDiagnosticCheck;
  rowOrder: RanklistDiagnosticCheck;
  sorterConfig: RanklistDiagnosticCheck;
  markers: RanklistDiagnosticCheck;
}

export interface RanklistDiagnostics {
  summary: {
    precision: {
      solutionTime: RanklistDiagnosticPrecision;
      statusTime: RanklistDiagnosticPrecision;
      scoreTime: RanklistDiagnosticPrecision;
    };
  };
  completeness: {
    items: RanklistCompletenessItems;
  };
  correctness: {
    checks: RanklistCorrectnessChecks;
  };
  suggestions: {
    firstBlood: RanklistFirstBloodSuggestion[];
    sorter: RanklistSorterSuggestion[];
    problemStatistics: RanklistProblemStatisticsSuggestion[];
  };
  issues: RanklistDiagnosticIssue[];
}

export interface DiagnoseRanklistOptions {}

type TimeParseResult = { valid: true; value: number; unit: srk.TimeUnit; ms: number } | { valid: false };

interface ResolvedSorterConfig {
  penalty: srk.TimeDuration;
  noPenaltyResults: Array<srk.SolutionResultFull | srk.SolutionResultCustom>;
  timePrecision?: srk.TimeUnit;
  timeRounding: 'floor' | 'ceil' | 'round';
}

interface CalculatedStatusSummary {
  result: srk.SolutionResultLite;
  tries: number;
  time?: srk.TimeDuration;
}

const TIME_UNITS: srk.TimeUnit[] = ['ms', 's', 'min', 'h', 'd'];
const ACTUAL_UNIT_ORDER: srk.TimeUnit[] = ['d', 'h', 'min', 's', 'ms'];
const TIME_UNIT_MS: Record<srk.TimeUnit, number> = {
  ms: 1,
  s: 1000,
  min: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};
const DEFAULT_NO_PENALTY_RESULTS: Array<srk.SolutionResultFull | srk.SolutionResultCustom> = [
  'FB',
  'AC',
  '?',
  'NOUT',
  'CE',
  'UKE',
  null,
];
const SORTER_NO_PENALTY_BASE_RESULTS: Array<srk.SolutionResultFull | srk.SolutionResultCustom> = ['FB', 'AC', '?'];
const SORTER_NO_PENALTY_OPTIONAL_RESULTS: Array<srk.SolutionResultFull | srk.SolutionResultCustom> = [
  'NOUT',
  'CE',
  'UKE',
];
const PROBLEM_STATISTICS_SUSPECT_NO_PENALTY_RESULTS: Array<srk.SolutionResultFull | srk.SolutionResultCustom> = [
  'CE',
  'NOUT',
  'UKE',
];
const LITE_RESULTS = new Set<any>(['FB', 'AC', 'RJ', '?']);
const FULL_ONLY_RESULTS = new Set<any>(['WA', 'PE', 'TLE', 'MLE', 'OLE', 'IDLE', 'RTE', 'NOUT', 'CE', 'UKE']);

/**
 * Diagnose structural completeness and ICPC-oriented correctness of an srk ranklist.
 *
 * The function is read-only: it never mutates the provided ranklist.
 *
 * @param ranklist - Ranklist to inspect.
 * @param _options - Reserved diagnostic options.
 * @returns Structured diagnostics plus a flat issue index.
 */
export function diagnoseRanklist(ranklist: srk.Ranklist, _options: DiagnoseRanklistOptions = {}): RanklistDiagnostics {
  const issues: RanklistDiagnosticIssue[] = [];
  const suggestions: RanklistDiagnostics['suggestions'] = {
    firstBlood: [],
    sorter: [],
    problemStatistics: [],
  };
  const addIssue = (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => {
    const normalized = {
      section: 'correctness' as const,
      ...issue,
    };
    issues.push(normalized);
    return normalized;
  };

  const precision = collectPrecisionSummary(ranklist, addIssue);
  const completenessItems = buildCompletenessItems(ranklist, addIssue);
  const firstBloodCheck = checkFirstBlood(ranklist, addIssue, suggestions.firstBlood);
  const statusesCheck = checkStatuses(ranklist, addIssue);
  const problemStatisticsCheck = checkProblemStatistics(ranklist, addIssue, suggestions.problemStatistics);
  const mockSolutionsCheck = checkMockSolutions(ranklist, addIssue);
  const statusSummariesCheck = checkStatusSummaries(ranklist, addIssue);
  const scoresCheck = checkScores(ranklist, addIssue);
  const rowOrderCheck = checkRowOrder(ranklist, addIssue);
  const sorterConfigCheck = checkSorterConfig(ranklist, precision, addIssue, suggestions.sorter);
  const markersCheck = checkMarkers(ranklist, addIssue);

  return {
    summary: {
      precision,
    },
    completeness: {
      items: completenessItems,
    },
    correctness: {
      checks: {
        firstBlood: firstBloodCheck,
        problemStatistics: problemStatisticsCheck,
        mockSolutions: mockSolutionsCheck,
        statuses: statusesCheck,
        statusSummaries: statusSummariesCheck,
        scores: scoresCheck,
        rowOrder: rowOrderCheck,
        sorterConfig: sorterConfigCheck,
        markers: markersCheck,
      },
    },
    suggestions,
    issues,
  };
}

function collectPrecisionSummary(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistDiagnostics['summary']['precision'] {
  const solutionTimes: Array<{ value: any; path: string; rowIndex?: number; problemIndex?: number; userId?: string }> = [];
  const statusTimes: Array<{ value: any; path: string; rowIndex?: number; problemIndex?: number; userId?: string }> = [];
  const scoreTimes: Array<{ value: any; path: string; rowIndex?: number; userId?: string }> = [];
  (ranklist.rows || []).forEach((row, rowIndex) => {
    if (row.score?.time) {
      scoreTimes.push({ value: row.score.time, path: `rows[${rowIndex}].score.time`, rowIndex, userId: getRowUserId(row) });
    }
    (row.statuses || []).forEach((status, problemIndex) => {
      if (status?.time) {
        statusTimes.push({
          value: status.time,
          path: `rows[${rowIndex}].statuses[${problemIndex}].time`,
          rowIndex,
          problemIndex,
          userId: getRowUserId(row),
        });
      }
      (status?.solutions || []).forEach((solution, solutionIndex) => {
        if (solution?.time) {
          solutionTimes.push({
            value: solution.time,
            path: `rows[${rowIndex}].statuses[${problemIndex}].solutions[${solutionIndex}].time`,
            rowIndex,
            problemIndex,
            userId: getRowUserId(row),
          });
        }
      });
    });
  });
  const sorterConfig = ranklist.sorter?.algorithm === 'ICPC' ? ranklist.sorter.config : undefined;
  if (sorterConfig?.penalty && !parseTimeDuration(sorterConfig.penalty).valid) {
    addIssue({
      section: 'summary',
      code: 'TIME_DURATION_INVALID',
      message: 'Invalid TimeDuration at sorter.config.penalty',
      severity: 'error',
      confidence: 'certain',
      path: 'sorter.config.penalty',
      details: {
        value: sorterConfig.penalty,
      },
    });
  }
  return {
    solutionTime: detectTimePrecision(solutionTimes, addIssue),
    statusTime: detectTimePrecision(statusTimes, addIssue),
    scoreTime: detectTimePrecision(scoreTimes, addIssue),
  };
}

function detectTimePrecision(
  values: Array<{ value: any; path: string; rowIndex?: number; problemIndex?: number; userId?: string }>,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistDiagnosticPrecision {
  const declaredUnits = new Set<srk.TimeUnit>();
  const nonZeroMs: number[] = [];
  let sampleCount = 0;
  let invalidCount = 0;
  let zeroCount = 0;
  for (const sample of values) {
    const parsed = parseTimeDuration(sample.value);
    if (!parsed.valid) {
      invalidCount++;
      addIssue({
        section: 'summary',
        code: 'TIME_DURATION_INVALID',
        message: `Invalid TimeDuration at ${sample.path}`,
        severity: 'error',
        confidence: 'certain',
        path: sample.path,
        rowIndex: sample.rowIndex,
        problemIndex: sample.problemIndex,
        userId: sample.userId,
        details: {
          value: sample.value,
        },
      });
      continue;
    }
    sampleCount++;
    declaredUnits.add(parsed.unit);
    if (isNearlyZero(parsed.ms)) {
      zeroCount++;
    } else {
      nonZeroMs.push(parsed.ms);
    }
  }
  let actualUnit: srk.TimeUnit | null = null;
  if (nonZeroMs.length) {
    actualUnit = ACTUAL_UNIT_ORDER.find((unit) => nonZeroMs.every((ms) => isMultipleOf(ms, TIME_UNIT_MS[unit]))) || 'ms';
  }
  return {
    actualUnit,
    declaredUnits: TIME_UNITS.filter((unit) => declaredUnits.has(unit)),
    sampleCount,
    invalidCount,
    zeroCount,
  };
}

function buildCompletenessItems(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistCompletenessItems {
  const rows = ranklist.rows || [];
  const problems = ranklist.problems || [];
  const optionalSupplementItems = new Set<keyof RanklistCompletenessItems>(['banner', 'userAvatar', 'userPhoto']);
  const lowSeverityIncompleteItems = new Set<keyof RanklistCompletenessItems>([
    ...optionalSupplementItems,
    'problemColors',
    'teamMembers',
    'coachRole',
  ]);
  const makeItem = (
    key: keyof RanklistCompletenessItems,
    label: string,
    presentCount: number,
    totalCount: number,
    details: Record<string, any> = {},
    levelOverride?: CompletenessLevel,
  ): RanklistDiagnosticCompletenessItem => {
    const ratio = totalCount > 0 ? presentCount / totalCount : null;
    const level = levelOverride || levelFromCoverage(presentCount, totalCount);
    const normalizedDetails = {
      ...(optionalSupplementItems.has(key) ? { optional: true } : {}),
      ...details,
    };
    if (level !== 'complete' && level !== 'notApplicable') {
      addIssue({
        section: 'completeness',
        item: key,
        code: `COMPLETENESS_${camelToConstant(`${key}`)}`,
        message: `${label} completeness is ${level}`,
        severity: lowSeverityIncompleteItems.has(key) || level === 'mostly' ? 'info' : 'warning',
        confidence: 'certain',
        details: {
          presentCount,
          totalCount,
          ratio,
          ...normalizedDetails,
        },
      });
    }
    return {
      key,
      label,
      level,
      presentCount,
      totalCount,
      ratio,
      details: normalizedDetails,
    };
  };

  const fbProblemIndexes = new Set<number>();
  rows.forEach((row) => {
    (row.statuses || []).forEach((status, problemIndex) => {
      if (status.result === 'FB' || (status.solutions || []).some((solution) => solution.result === 'FB')) {
        fbProblemIndexes.add(problemIndex);
      }
    });
  });
  const acceptedProblemIndexes = collectAcceptedProblemIndexes(ranklist);
  const noAcceptedProblemIndexes = problems
    .map((_, problemIndex) => problemIndex)
    .filter((problemIndex) => !acceptedProblemIndexes.has(problemIndex));
  const expectedFirstBloodProblemIndexes = [...acceptedProblemIndexes].sort((a, b) => a - b);
  const presentFirstBloodProblemCount = expectedFirstBloodProblemIndexes.filter((problemIndex) => {
    return fbProblemIndexes.has(problemIndex);
  }).length;

  const icpcSeriesDetails = getICPCSeriesDetails(ranklist.series || []);
  for (const invalidSeries of icpcSeriesDetails.invalidSeries) {
    addIssue({
      item: 'icpcSeries',
      code: 'ICPC_SERIES_INVALID',
      message: `ICPC series configuration is invalid at series[${invalidSeries.index}]`,
      severity: invalidSeries.severity,
      confidence: 'certain',
      path: `series[${invalidSeries.index}].rule.options`,
      details: invalidSeries,
    });
  }
  const icpcLevel =
    icpcSeriesDetails.icpcSeriesCount === 0
      ? 'missing'
      : icpcSeriesDetails.usableICPCSeriesCount === 0
      ? 'partial'
      : icpcSeriesDetails.incompleteSeries.length
      ? 'mostly'
      : 'complete';

  const i18nDetails = collectI18nDetails(ranklist);
  const statusRowsValid = rows.filter((row) => Array.isArray(row.statuses) && row.statuses.length === problems.length)
    .length;
  const solutionDetails = collectSolutionCompletenessDetails(ranklist);
  const consistencyDetails = collectRowUserConsistencyDetails(rows);

  return {
    banner: makeItem('banner', 'Contest banner', ranklist.contest?.banner ? 1 : 0, 1, {
      hasBanner: Boolean(ranklist.contest?.banner),
    }),
    firstBlood: makeItem(
      'firstBlood',
      'Problem first-blood declarations',
      presentFirstBloodProblemCount,
      expectedFirstBloodProblemIndexes.length,
      {
        problemIndexes: [...fbProblemIndexes].sort((a, b) => a - b),
        expectedProblemIndexes: expectedFirstBloodProblemIndexes,
        noAcceptedProblemIndexes,
      },
    ),
    problemColors: makeItem(
      'problemColors',
      'Problem background colors',
      problems.filter((problem) => Boolean(problem.style?.backgroundColor)).length,
      problems.length,
    ),
    icpcSeries: makeItem(
      'icpcSeries',
      'ICPC series configuration',
      icpcSeriesDetails.usableICPCSeriesCount,
      icpcSeriesDetails.icpcSeriesCount || 1,
      icpcSeriesDetails,
      icpcLevel,
    ),
    userAvatar: makeItem(
      'userAvatar',
      'User avatars',
      rows.filter((row) => Boolean(row.user?.avatar)).length,
      rows.length,
    ),
    userPhoto: makeItem(
      'userPhoto',
      'User photos',
      rows.filter((row) => Boolean((row.user as any)?.photo)).length,
      rows.length,
    ),
    teamMembers: makeItem(
      'teamMembers',
      'Team member information',
      rows.filter((row) => Array.isArray(row.user?.teamMembers) && row.user.teamMembers.length > 0).length,
      rows.length,
    ),
    coachRole: makeItem(
      'coachRole',
      'Coach team member role',
      rows.filter((row) => {
        return (row.user?.teamMembers || []).some((member) => (member as any).role === 'coach');
      }).length,
      rows.length,
    ),
    i18n: makeItem('i18n', 'i18n text coverage', i18nDetails.i18nCount, i18nDetails.totalTextCount, i18nDetails),
    statuses: makeItem('statuses', 'Problem status arrays', statusRowsValid, rows.length, {
      problemCount: problems.length,
      invalidRows: rows
        .map((row, rowIndex) => ({ rowIndex, length: Array.isArray(row.statuses) ? row.statuses.length : null }))
        .filter((row) => row.length !== problems.length),
    }),
    solutions: makeItem(
      'solutions',
      'Submission solution histories',
      solutionDetails.statusesWithSolutions,
      solutionDetails.submittedStatuses,
      solutionDetails,
      solutionDetails.submittedStatuses === 0
        ? 'notApplicable'
        : levelFromCoverage(solutionDetails.statusesWithSolutions, solutionDetails.submittedStatuses),
    ),
    rowUserConsistency: makeItem(
      'rowUserConsistency',
      'Row user field consistency',
      consistencyDetails.rowsWithAllFields,
      rows.length,
      consistencyDetails,
      rows.length <= 1 ? 'notApplicable' : levelFromCoverage(consistencyDetails.rowsWithAllFields, rows.length),
    ),
  };
}

function checkFirstBlood(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
  suggestions: RanklistFirstBloodSuggestion[],
): RanklistDiagnosticCheck {
  if (!isICPCSorter(ranklist)) {
    return makeCheck('firstBlood', 'First-blood declarations', 'notApplicable', 0, 0, {
      reason: 'Ranklist sorter is not ICPC',
    });
  }
  const problems = ranklist.problems || [];
  let failedCount = 0;
  let checkedCount = 0;
  for (let problemIndex = 0; problemIndex < problems.length; problemIndex++) {
    const declaredCells = collectDeclaredFirstBloodCells(ranklist, problemIndex);
    const acceptedSolutions = collectAcceptedSolutions(ranklist, problemIndex);
    const uniqueEarliest = getUniqueEarliestAcceptedSolution(acceptedSolutions);
    if (declaredCells.length > 1) {
      failedCount++;
      addIssue({
        code: 'FIRST_BLOOD_MULTIPLE',
        message: `Problem ${problemLabel(ranklist, problemIndex)} has multiple first-blood declarations`,
        severity: 'error',
        confidence: 'certain',
        item: 'firstBlood',
        problemIndex,
        details: {
          declarations: declaredCells,
        },
      });
    }
    if (!acceptedSolutions.length) {
      continue;
    }
    checkedCount++;
    if (!uniqueEarliest) {
      continue;
    }
    if (!declaredCells.length) {
      failedCount++;
      const confidence: DiagnosticConfidence = uniqueEarliest.source === 'solution' ? 'high' : 'medium';
      addIssue({
        code: 'FIRST_BLOOD_MISSING',
        message: `Problem ${problemLabel(ranklist, problemIndex)} has a unique earliest accepted solution but no first-blood declaration`,
        severity: 'warning',
        confidence,
        item: 'firstBlood',
        problemIndex,
        rowIndex: uniqueEarliest.rowIndex,
        userId: uniqueEarliest.userId,
      });
      pushFirstBloodSuggestion(ranklist, suggestions, problemIndex, uniqueEarliest);
      continue;
    }
    const declared = declaredCells[0];
    if (declared.rowIndex !== uniqueEarliest.rowIndex) {
      failedCount++;
      const confidence: DiagnosticConfidence = uniqueEarliest.source === 'solution' ? 'high' : 'medium';
      addIssue({
        code: 'FIRST_BLOOD_CONFLICT',
        message: `Problem ${problemLabel(ranklist, problemIndex)} first-blood declaration conflicts with the earliest accepted solution`,
        severity: 'error',
        confidence,
        item: 'firstBlood',
        problemIndex,
        rowIndex: declared.rowIndex,
        userId: declared.userId,
        details: {
          declared,
          expected: uniqueEarliest,
        },
      });
      pushFirstBloodSuggestion(ranklist, suggestions, problemIndex, uniqueEarliest);
    } else if (declaredCells.length > 1) {
      pushFirstBloodSuggestion(ranklist, suggestions, problemIndex, uniqueEarliest);
    }
  }
  return makeCheck('firstBlood', 'First-blood declarations', failedCount ? 'fail' : 'pass', checkedCount, failedCount, {
    suggestionCount: suggestions.length,
  });
}

function checkProblemStatistics(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
  suggestions: RanklistProblemStatisticsSuggestion[],
): RanklistDiagnosticCheck {
  const config = isICPCSorter(ranklist) ? getSorterConfig(ranklist) : undefined;
  const expected = calculateProblemStatisticsFromBestAvailableData(ranklist, config);
  const mismatches = collectProblemStatisticsMismatches(ranklist, config, expected);
  if (config) {
    suggestions.push(...collectProblemStatisticsSuggestions(ranklist, config, mismatches));
  }
  const checkedCount = countProblemsWithStatistics(ranklist);
  for (const mismatch of mismatches) {
    addIssue({
      code: 'PROBLEM_STATISTICS_MISMATCH',
      message: `Problem ${problemLabel(ranklist, mismatch.problemIndex)} statistics do not match row statuses`,
      severity: 'error',
      confidence: 'certain',
      item: 'problemStatistics',
      problemIndex: mismatch.problemIndex,
      path: `problems[${mismatch.problemIndex}].statistics`,
      details: mismatch,
    });
  }
  return makeCheck(
    'problemStatistics',
    'Problem statistics',
    checkedCount === 0 ? 'notApplicable' : mismatches.length ? 'fail' : 'pass',
    checkedCount,
    mismatches.length,
    { expected },
  );
}

function checkStatuses(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistDiagnosticCheck {
  const problemCount = (ranklist.problems || []).length;
  const mismatches = (ranklist.rows || [])
    .map((row, rowIndex) => {
      return {
        rowIndex,
        userId: getRowUserId(row),
        expectedLength: problemCount,
        actualLength: Array.isArray(row.statuses) ? row.statuses.length : null,
      };
    })
    .filter((row) => row.actualLength !== problemCount);
  for (const mismatch of mismatches) {
    addIssue({
      code: 'STATUSES_LENGTH_MISMATCH',
      message: `Row statuses length does not match problems length for user ${mismatch.userId}`,
      severity: 'error',
      confidence: 'certain',
      item: 'statuses',
      rowIndex: mismatch.rowIndex,
      userId: mismatch.userId,
      path: `rows[${mismatch.rowIndex}].statuses`,
      details: mismatch,
    });
  }
  return makeCheck(
    'statuses',
    'Problem status array lengths',
    mismatches.length ? 'fail' : 'pass',
    (ranklist.rows || []).length,
    mismatches.length,
    { problemCount, mismatches },
  );
}

function checkMockSolutions(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistDiagnosticCheck {
  const examples: any[] = [];
  let checkedCount = 0;
  let suspiciousCount = 0;
  (ranklist.rows || []).forEach((row, rowIndex) => {
    (row.statuses || []).forEach((status, problemIndex) => {
      const rjTimes = (status.solutions || [])
        .filter((solution) => solution.result === 'RJ')
        .map((solution) => parseTimeDuration(solution.time))
        .filter((parsed): parsed is Extract<TimeParseResult, { valid: true }> => parsed.valid)
        .map((parsed) => parsed.ms);
      if (rjTimes.length < 2) {
        return;
      }
      checkedCount++;
      const pattern = detectMockTimePattern(rjTimes);
      if (pattern) {
        suspiciousCount++;
        examples.push({
          rowIndex,
          problemIndex,
          userId: getRowUserId(row),
          pattern,
          count: rjTimes.length,
        });
      }
    });
  });
  const ratio = checkedCount ? suspiciousCount / checkedCount : 0;
  const confidence: DiagnosticConfidence = suspiciousCount >= 2 && ratio >= 0.8 ? 'high' : suspiciousCount ? 'medium' : 'low';
  if (suspiciousCount) {
    addIssue({
      code: 'MOCK_SOLUTIONS_SUSPECTED',
      message: 'Rejected solution timestamps look synthetically expanded from status summaries',
      severity: confidence === 'high' ? 'warning' : 'info',
      confidence,
      item: 'mockSolutions',
      details: {
        checkedCount,
        suspiciousCount,
        ratio,
        examples,
      },
    });
  }
  return makeCheck(
    'mockSolutions',
    'Mock solution expansion',
    checkedCount === 0 ? 'notApplicable' : suspiciousCount ? 'warning' : 'pass',
    checkedCount,
    suspiciousCount,
    { suspiciousCount, ratio, examples },
  );
}

function checkStatusSummaries(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistDiagnosticCheck {
  if (!isICPCSorter(ranklist)) {
    return makeCheck('statusSummaries', 'Status summaries from solutions', 'notApplicable', 0, 0, {
      reason: 'Ranklist sorter is not ICPC',
    });
  }
  const config = getSorterConfig(ranklist);
  const mismatches = collectStatusSummaryMismatches(ranklist, config);
  for (const mismatch of mismatches) {
    addIssue({
      code: 'STATUS_SUMMARY_MISMATCH',
      message: `Status summary does not match detailed solutions for problem ${problemLabel(ranklist, mismatch.problemIndex)}`,
      severity: 'warning',
      confidence: 'high',
      item: 'statusSummaries',
      rowIndex: mismatch.rowIndex,
      problemIndex: mismatch.problemIndex,
      userId: mismatch.userId,
      path: `rows[${mismatch.rowIndex}].statuses[${mismatch.problemIndex}]`,
      details: mismatch,
    });
  }
  const checkedCount = countStatusesWithSolutions(ranklist);
  return makeCheck(
    'statusSummaries',
    'Status summaries from solutions',
    checkedCount === 0 ? 'notApplicable' : mismatches.length ? 'warning' : 'pass',
    checkedCount,
    mismatches.length,
    { mismatches },
  );
}

function checkScores(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistDiagnosticCheck {
  if (!isICPCSorter(ranklist)) {
    return makeCheck('scores', 'ICPC score calculation', 'notApplicable', 0, 0, {
      reason: 'Ranklist sorter is not ICPC',
    });
  }
  const config = getSorterConfig(ranklist);
  const mismatches = collectScoreMismatches(ranklist, config);
  for (const mismatch of mismatches) {
    addIssue({
      code: 'SCORE_MISMATCH',
      message: `Row score does not match status calculation for user ${mismatch.userId}`,
      severity: 'error',
      confidence: 'certain',
      item: 'scores',
      rowIndex: mismatch.rowIndex,
      userId: mismatch.userId,
      path: `rows[${mismatch.rowIndex}].score`,
      details: mismatch,
    });
  }
  return makeCheck('scores', 'ICPC score calculation', mismatches.length ? 'fail' : 'pass', ranklist.rows.length, mismatches.length, {
    mismatches,
  });
}

function checkRowOrder(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistDiagnosticCheck {
  if (!isICPCSorter(ranklist)) {
    return makeCheck('rowOrder', 'ICPC row order', 'notApplicable', 0, 0, {
      reason: 'Ranklist sorter is not ICPC',
    });
  }
  const expectedOrder = sortRows([...ranklist.rows]).map((row) => getRowUserId(row));
  const mismatches = collectRowOrderMismatches(ranklist);
  for (const mismatch of mismatches) {
    addIssue({
      code: 'ROW_ORDER_MISMATCH',
      message: `Rows ${mismatch.rowIndex} and ${mismatch.nextRowIndex} are out of ICPC score order`,
      severity: 'error',
      confidence: 'certain',
      item: 'rowOrder',
      rowIndex: mismatch.rowIndex,
      userId: mismatch.userId,
      details: mismatch,
    });
  }
  return makeCheck(
    'rowOrder',
    'ICPC row order',
    mismatches.length ? 'fail' : 'pass',
    Math.max(0, ranklist.rows.length - 1),
    mismatches.length,
    {
      expectedOrder,
      mismatches,
    },
  );
}

function checkSorterConfig(
  ranklist: srk.Ranklist,
  precision: RanklistDiagnostics['summary']['precision'],
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
  suggestions: RanklistSorterSuggestion[],
): RanklistDiagnosticCheck {
  if (!isICPCSorter(ranklist)) {
    return makeCheck('sorterConfig', 'Sorter configuration', 'notApplicable', 0, 0, {
      reason: 'Ranklist sorter is not ICPC',
    });
  }
  const current = getSorterConfig(ranklist);
  const baseline = evaluateSorterConfig(ranklist, current);
  if (baseline.issueCount === 0) {
    return makeCheck('sorterConfig', 'Sorter configuration', 'pass', baseline.checkedCount, 0, {
      baseline,
    });
  }
  const candidateSuggestions = collectSorterSuggestions(ranklist, current, precision, baseline);
  suggestions.push(...candidateSuggestions);
  if (candidateSuggestions.length) {
    addIssue({
      code: 'SORTER_CONFIG_MISMATCH',
      message: 'Alternative sorter configuration matches the declared ranklist better',
      severity: 'warning',
      confidence: candidateSuggestions[0].confidence,
      item: 'sorterConfig',
      details: {
        baseline,
        suggestions: candidateSuggestions,
      },
    });
  }
  return makeCheck('sorterConfig', 'Sorter configuration', candidateSuggestions.length ? 'warning' : 'fail', baseline.checkedCount, baseline.issueCount, {
    baseline,
    suggestions: candidateSuggestions,
  });
}

function checkMarkers(
  ranklist: srk.Ranklist,
  addIssue: (issue: Omit<RanklistDiagnosticIssue, 'section'> & { section?: RanklistDiagnosticIssue['section'] }) => void,
): RanklistDiagnosticCheck {
  const markerIds = new Set((ranklist.markers || []).map((marker) => marker.id));
  let checkedCount = 0;
  let failedCount = 0;
  (ranklist.rows || []).forEach((row, rowIndex) => {
    const rowMarkerIds = collectRowMarkerIds(row.user);
    for (const markerId of rowMarkerIds) {
      checkedCount++;
      if (!markerIds.has(markerId)) {
        failedCount++;
        addIssue({
          code: 'MARKER_UNDECLARED',
          message: `User marker "${markerId}" is not declared in ranklist.markers`,
          severity: 'warning',
          confidence: 'certain',
          item: 'markers',
          rowIndex,
          userId: getRowUserId(row),
          path: `rows[${rowIndex}].user`,
          details: {
            markerId,
          },
        });
      }
    }
  });
  (ranklist.series || []).forEach((seriesConfig, seriesIndex) => {
    if (seriesConfig.rule?.preset !== 'ICPC') {
      return;
    }
    const byMarker = (seriesConfig.rule as srk.RankSeriesRulePresetICPC).options?.filter?.byMarker;
    if (!byMarker) {
      return;
    }
    checkedCount++;
    if (!markerIds.has(byMarker)) {
      failedCount++;
      addIssue({
        code: 'MARKER_UNDECLARED',
        message: `Series marker filter "${byMarker}" is not declared in ranklist.markers`,
        severity: 'warning',
        confidence: 'certain',
        item: 'markers',
        path: `series[${seriesIndex}].rule.options.filter.byMarker`,
        details: {
          markerId: byMarker,
          seriesIndex,
        },
      });
    }
  });
  return makeCheck('markers', 'Marker declarations', checkedCount === 0 ? 'notApplicable' : failedCount ? 'fail' : 'pass', checkedCount, failedCount, {
    declaredMarkerIds: [...markerIds],
  });
}

function collectStatusSummaryMismatches(ranklist: srk.Ranklist, config: ResolvedSorterConfig) {
  const mismatches: any[] = [];
  (ranklist.rows || []).forEach((row, rowIndex) => {
    (row.statuses || []).forEach((status, problemIndex) => {
      if (!Array.isArray(status.solutions) || !status.solutions.length) {
        return;
      }
      const expected = calculateStatusSummaryFromSolutions(status.solutions, config);
      const current = normalizeStatusSummary(status);
      const mismatchReasons: string[] = [];
      if (current.result !== expected.result) {
        mismatchReasons.push('result');
      }
      if (current.tries !== expected.tries) {
        mismatchReasons.push('tries');
      }
      if (!sameStatusSummaryOptionalTime(current.time, expected.time)) {
        mismatchReasons.push('time');
      }
      if (mismatchReasons.length) {
        mismatches.push({
          rowIndex,
          problemIndex,
          userId: getRowUserId(row),
          actual: current,
          expected,
          solutions: summarizeSolutionResults(status.solutions),
          mismatchReasons,
        });
      }
    });
  });
  return mismatches;
}

function summarizeSolutionResults(solutions: srk.Solution[]) {
  return solutions.map((solution) => solution.result);
}

function calculateProblemStatisticsFromBestAvailableData(
  ranklist: srk.Ranklist,
  config?: ResolvedSorterConfig,
): srk.ProblemStatistics[] {
  const problemCount = (ranklist.problems || []).length;
  const accepted = new Array(problemCount).fill(0);
  const submitted = new Array(problemCount).fill(0);
  for (const row of ranklist.rows || []) {
    for (let problemIndex = 0; problemIndex < problemCount; problemIndex++) {
      const status = row.statuses?.[problemIndex];
      if (!status) {
        continue;
      }
      const summary =
        config && Array.isArray(status.solutions) && status.solutions.length
          ? calculateStatusSummaryFromSolutions(status.solutions, config)
          : normalizeStatusSummary(status);
      if (summary.result === 'AC' || summary.result === 'FB') {
        accepted[problemIndex]++;
      }
      if (config && Array.isArray(status.solutions) && status.solutions.length) {
        submitted[problemIndex] += summary.tries || 0;
      } else if (Array.isArray(status.solutions) && status.solutions.length) {
        submitted[problemIndex] += status.solutions.length;
      } else {
        submitted[problemIndex] += status.tries || 0;
      }
    }
  }
  return (ranklist.problems || []).map((_, problemIndex) => ({
    accepted: accepted[problemIndex],
    submitted: submitted[problemIndex],
  }));
}

function collectProblemStatisticsMismatches(
  ranklist: srk.Ranklist,
  config?: ResolvedSorterConfig,
  expected = calculateProblemStatisticsFromBestAvailableData(ranklist, config),
) {
  const mismatches: any[] = [];
  (ranklist.problems || []).forEach((problem, problemIndex) => {
    if (!problem.statistics) {
      return;
    }
    const actual = problem.statistics;
    const expectedStatistics = expected[problemIndex];
    if (actual.accepted !== expectedStatistics.accepted || actual.submitted !== expectedStatistics.submitted) {
      mismatches.push({
        problemIndex,
        actual,
        expected: expectedStatistics,
      });
    }
  });
  return mismatches;
}

function collectProblemStatisticsSuggestions(
  ranklist: srk.Ranklist,
  config: ResolvedSorterConfig,
  mismatches: ReturnType<typeof collectProblemStatisticsMismatches>,
): RanklistProblemStatisticsSuggestion[] {
  const removedResults = PROBLEM_STATISTICS_SUSPECT_NO_PENALTY_RESULTS.filter((result) => {
    return config.noPenaltyResults.some((item) => item === result);
  });
  if (!removedResults.length || !mismatches.length) {
    return [];
  }
  const suspectConfig: ResolvedSorterConfig = {
    ...config,
    noPenaltyResults: config.noPenaltyResults.filter((result) => {
      return !PROBLEM_STATISTICS_SUSPECT_NO_PENALTY_RESULTS.some((item) => item === result);
    }),
  };
  const suspectStatistics = calculateProblemStatisticsFromBestAvailableData(ranklist, suspectConfig);
  return mismatches
    .filter((mismatch) => sameProblemStatistics(suspectStatistics[mismatch.problemIndex], mismatch.actual))
    .map((mismatch) => ({
      problemIndex: mismatch.problemIndex,
      problemAlias: ranklist.problems?.[mismatch.problemIndex]?.alias,
      actual: mismatch.actual,
      expected: mismatch.expected,
      confidence: 'high' as const,
      reason: 'declared statistics match a calculation where CE/NOUT/UKE count as penalty submissions',
      details: {
        withoutNoPenaltyResults: [...PROBLEM_STATISTICS_SUSPECT_NO_PENALTY_RESULTS],
      },
    }));
}

function sameProblemStatistics(left: srk.ProblemStatistics | undefined, right: srk.ProblemStatistics | undefined) {
  return Boolean(left && right && left.accepted === right.accepted && left.submitted === right.submitted);
}

function countProblemsWithStatistics(ranklist: srk.Ranklist) {
  return (ranklist.problems || []).filter((problem) => Boolean(problem.statistics)).length;
}

function collectScoreMismatches(ranklist: srk.Ranklist, config: ResolvedSorterConfig) {
  const mismatches: any[] = [];
  (ranklist.rows || []).forEach((row, rowIndex) => {
    const expected = calculateScoreFromStatuses(row.statuses || [], config);
    if (!expected) {
      return;
    }
    const currentTime = row.score.time ? parseTimeDuration(row.score.time) : { valid: true as const, value: 0, unit: 'ms' as const, ms: 0 };
    const expectedTime = parseTimeDuration(expected.time);
    const currentMs = currentTime.valid ? currentTime.ms : NaN;
    const expectedMs = expectedTime.valid ? expectedTime.ms : NaN;
    const mismatchReasons: string[] = [];
    if (row.score.value !== expected.value) {
      mismatchReasons.push('value');
    }
    if (!isNearlyEqual(currentMs, expectedMs)) {
      mismatchReasons.push('time');
    }
    if (mismatchReasons.length) {
      mismatches.push({
        rowIndex,
        userId: getRowUserId(row),
        actual: row.score,
        expected,
        mismatchReasons,
      });
    }
  });
  return mismatches;
}

function collectStatusTriesMismatches(ranklist: srk.Ranklist, config: ResolvedSorterConfig) {
  const mismatches: any[] = [];
  (ranklist.rows || []).forEach((row, rowIndex) => {
    (row.statuses || []).forEach((status, problemIndex) => {
      if (!Array.isArray(status.solutions) || !status.solutions.length) {
        return;
      }
      const expected = calculateStatusSummaryFromSolutions(status.solutions, config);
      const current = normalizeStatusSummary(status);
      if (current.tries !== expected.tries) {
        mismatches.push({
          rowIndex,
          problemIndex,
          userId: getRowUserId(row),
          actual: current,
          expected,
          mismatchReasons: ['tries'],
        });
      }
    });
  });
  return mismatches;
}

function collectRowOrderMismatches(ranklist: srk.Ranklist) {
  const mismatches: any[] = [];
  for (let rowIndex = 0; rowIndex < ranklist.rows.length - 1; rowIndex++) {
    const current = ranklist.rows[rowIndex];
    const next = ranklist.rows[rowIndex + 1];
    if (compareRowsByScore(current, next) > 0) {
      mismatches.push({
        rowIndex,
        nextRowIndex: rowIndex + 1,
        userId: getRowUserId(current),
        nextUserId: getRowUserId(next),
        currentScore: current.score,
        nextScore: next.score,
      });
    }
  }
  return mismatches;
}

function evaluateSorterConfig(ranklist: srk.Ranklist, config: ResolvedSorterConfig) {
  const statusSummaryMismatchCount = collectStatusSummaryMismatches(ranklist, config).length;
  const problemStatisticsMismatchCount = collectProblemStatisticsMismatches(ranklist, config).length;
  const triesMismatchCount = collectStatusTriesMismatches(ranklist, config).length;
  const scoreMismatchCount = collectScoreMismatches(ranklist, config).length;
  const rowOrderMismatchCount = collectRowOrderMismatches(ranklist).length;
  const issueCount = statusSummaryMismatchCount + problemStatisticsMismatchCount + scoreMismatchCount + rowOrderMismatchCount;
  return {
    statusSummaryMismatchCount,
    problemStatisticsMismatchCount,
    triesMismatchCount,
    statusMismatchCount: triesMismatchCount,
    scoreMismatchCount,
    rowOrderMismatchCount,
    issueCount,
    checkedCount:
      countStatusesWithSolutions(ranklist) +
      countProblemsWithStatistics(ranklist) +
      ranklist.rows.length +
      Math.max(0, ranklist.rows.length - 1),
  };
}

function collectSorterSuggestions(
  ranklist: srk.Ranklist,
  current: ResolvedSorterConfig,
  precision: RanklistDiagnostics['summary']['precision'],
  baseline: ReturnType<typeof evaluateSorterConfig>,
): RanklistSorterSuggestion[] {
  const candidates: ResolvedSorterConfig[] = [];
  const timePrecisionCandidates = uniqueValues<srk.TimeUnit | undefined>([
    current.timePrecision,
    precision.statusTime.actualUnit || undefined,
    precision.solutionTime.actualUnit || undefined,
    'ms',
    's',
    'min',
  ]);
  const roundingCandidates: Array<'floor' | 'ceil' | 'round'> = ['floor', 'ceil', 'round'];
  const noPenaltyCandidates = uniqueNoPenaltyCandidates(current.noPenaltyResults);

  for (const timePrecision of timePrecisionCandidates) {
    for (const timeRounding of roundingCandidates) {
      for (const noPenaltyResults of noPenaltyCandidates) {
        candidates.push({
          ...current,
          timePrecision,
          timeRounding,
          noPenaltyResults,
        });
      }
    }
  }

  const suggestions: RanklistSorterSuggestion[] = [];
  const seen = new Set<string>();
  candidates
    .map((candidate) => ({ candidate, evaluation: evaluateSorterConfig(ranklist, candidate) }))
    .filter(({ evaluation }) => evaluation.issueCount < baseline.issueCount)
    .sort((a, b) => {
      const issueDelta = a.evaluation.issueCount - b.evaluation.issueCount;
      if (issueDelta !== 0) {
        return issueDelta;
      }
      const reductionDelta = sorterIssueReduction(baseline, b.evaluation) - sorterIssueReduction(baseline, a.evaluation);
      if (reductionDelta !== 0) {
        return reductionDelta;
      }
      const noPenaltyDelta =
        noPenaltyDifferenceSize(current.noPenaltyResults, a.candidate.noPenaltyResults) -
        noPenaltyDifferenceSize(current.noPenaltyResults, b.candidate.noPenaltyResults);
      if (noPenaltyDelta !== 0) {
        return noPenaltyDelta;
      }
      const patchSizeDelta =
        sorterConfigPatchSize(current, a.candidate) - sorterConfigPatchSize(current, b.candidate);
      if (patchSizeDelta !== 0) {
        return patchSizeDelta;
      }
      return JSON.stringify(buildSorterConfigPatch(current, a.candidate)).localeCompare(
        JSON.stringify(buildSorterConfigPatch(current, b.candidate)),
      );
    })
    .forEach(({ candidate, evaluation }) => {
      const patch = buildSorterConfigPatch(current, candidate);
      const key = JSON.stringify(patch);
      if (!Object.keys(patch).length || seen.has(key)) {
        return;
      }
      seen.add(key);
      suggestions.push({
        config: patch,
        confidence: sorterSuggestionConfidence(baseline, evaluation),
        resolvedIssues: describeResolvedSorterIssues(baseline, evaluation),
        details: {
          baseline,
          evaluation,
        },
      });
    });
  return suggestions.slice(0, 5);
}

function buildSorterConfigPatch(
  current: ResolvedSorterConfig,
  candidate: ResolvedSorterConfig,
): Partial<srk.SorterICPC['config']> {
  const patch: Partial<srk.SorterICPC['config']> = {};
  if (candidate.timePrecision !== current.timePrecision) {
    patch.timePrecision = candidate.timePrecision;
  }
  if (candidate.timeRounding !== current.timeRounding) {
    patch.timeRounding = candidate.timeRounding;
  }
  if (!sameNoPenaltyResults(candidate.noPenaltyResults, current.noPenaltyResults)) {
    patch.noPenaltyResults = candidate.noPenaltyResults as srk.SolutionResultFull[];
  }
  return patch;
}

function sorterConfigPatchSize(current: ResolvedSorterConfig, candidate: ResolvedSorterConfig) {
  return Object.keys(buildSorterConfigPatch(current, candidate)).length;
}

function describeResolvedSorterIssues(
  baseline: ReturnType<typeof evaluateSorterConfig>,
  evaluation: ReturnType<typeof evaluateSorterConfig>,
) {
  const resolved: string[] = [];
  if (evaluation.statusSummaryMismatchCount < baseline.statusSummaryMismatchCount) {
    resolved.push('statusSummaries');
  }
  if (evaluation.problemStatisticsMismatchCount < baseline.problemStatisticsMismatchCount) {
    resolved.push('problemStatistics');
  }
  if (evaluation.triesMismatchCount < baseline.triesMismatchCount) {
    resolved.push('statusTries');
  }
  if (evaluation.scoreMismatchCount < baseline.scoreMismatchCount) {
    resolved.push('scores');
  }
  if (evaluation.rowOrderMismatchCount < baseline.rowOrderMismatchCount) {
    resolved.push('rowOrder');
  }
  return resolved;
}

function sorterIssueReduction(
  baseline: ReturnType<typeof evaluateSorterConfig>,
  evaluation: ReturnType<typeof evaluateSorterConfig>,
) {
  return baseline.issueCount - evaluation.issueCount;
}

function sorterSuggestionConfidence(
  baseline: ReturnType<typeof evaluateSorterConfig>,
  evaluation: ReturnType<typeof evaluateSorterConfig>,
): DiagnosticConfidence {
  if (evaluation.issueCount === 0) {
    return 'high';
  }
  const reduction = sorterIssueReduction(baseline, evaluation);
  const ratio = baseline.issueCount ? reduction / baseline.issueCount : 0;
  const solvedCategory =
    (baseline.statusSummaryMismatchCount > 0 && evaluation.statusSummaryMismatchCount === 0) ||
    (baseline.problemStatisticsMismatchCount > 0 && evaluation.problemStatisticsMismatchCount === 0) ||
    (baseline.triesMismatchCount > 0 && evaluation.triesMismatchCount === 0) ||
    (baseline.scoreMismatchCount > 0 && evaluation.scoreMismatchCount === 0) ||
    (baseline.rowOrderMismatchCount > 0 && evaluation.rowOrderMismatchCount === 0);
  if (solvedCategory && ratio >= 0.25) {
    return 'medium';
  }
  return 'low';
}

function noPenaltyDifferenceSize(
  left: ResolvedSorterConfig['noPenaltyResults'],
  right: ResolvedSorterConfig['noPenaltyResults'],
) {
  const leftKeys = new Set(left.map(noPenaltyResultKey));
  const rightKeys = new Set(right.map(noPenaltyResultKey));
  let size = 0;
  for (const key of leftKeys) {
    if (!rightKeys.has(key)) {
      size++;
    }
  }
  for (const key of rightKeys) {
    if (!leftKeys.has(key)) {
      size++;
    }
  }
  return size;
}

function noPenaltyResultKey(result: srk.SolutionResultFull | srk.SolutionResultCustom) {
  return result === null ? '__null__' : `value:${result}`;
}

function uniqueNoPenaltyCandidates(_current: ResolvedSorterConfig['noPenaltyResults']) {
  const candidates: ResolvedSorterConfig['noPenaltyResults'][] = [];
  const optionalCount = SORTER_NO_PENALTY_OPTIONAL_RESULTS.length;
  for (let mask = 0; mask < 1 << optionalCount; mask++) {
    const optionalResults = SORTER_NO_PENALTY_OPTIONAL_RESULTS.filter((_, index) => (mask & (1 << index)) !== 0);
    candidates.push([...SORTER_NO_PENALTY_BASE_RESULTS, ...optionalResults, null]);
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function calculateStatusSummaryFromSolutions(
  solutions: srk.Solution[] = [],
  config: ResolvedSorterConfig,
): CalculatedStatusSummary {
  const summary: CalculatedStatusSummary = {
    result: null,
    tries: 0,
  };
  for (const solution of solutions) {
    const result = solution.result;
    if (result === null || result === undefined) {
      continue;
    }
    const isNoPenaltyResult = config.noPenaltyResults.some((item) => item === result);
    if (result === '?') {
      summary.result = '?';
      if (!isNoPenaltyResult) {
        summary.tries++;
      }
      continue;
    }
    if (result === 'AC' || result === 'FB') {
      summary.result = result;
      summary.time = solution.time;
      summary.tries++;
      break;
    }
    if (isNoPenaltyResult) {
      continue;
    }
    summary.result = 'RJ';
    summary.tries++;
  }
  return summary;
}

function calculateScoreFromStatuses(statuses: srk.RankProblemStatus[], config: ResolvedSorterConfig): srk.RankScore | null {
  const penaltyMs = safeFormatTimeDuration(config.penalty, 'ms');
  if (penaltyMs === null) {
    return null;
  }
  let value = 0;
  let timeMs = 0;
  for (const status of statuses) {
    if ((status.result === 'AC' || status.result === 'FB') && status.time) {
      const timePrecision = config.timePrecision || 'ms';
      const targetTimeValue = safeFormatTimeDuration(status.time, timePrecision, roundingFn(config.timeRounding));
      if (targetTimeValue === null) {
        return null;
      }
      const targetTime: srk.TimeDuration = [targetTimeValue, timePrecision];
      value++;
      timeMs += formatTimeDuration(targetTime, 'ms') + Math.max(0, getDeclaredAcceptedTries(status) - 1) * penaltyMs;
    }
  }
  return {
    value,
    time: [timeMs, 'ms'],
  };
}

function getDeclaredAcceptedTries(status: srk.RankProblemStatus) {
  return status.tries || 1;
}

function normalizeStatusSummary(status: srk.RankProblemStatus): CalculatedStatusSummary {
  return {
    result: status.result === undefined ? null : status.result,
    tries: status.tries || 0,
    time: status.time,
  };
}

function getSorterConfig(ranklist: srk.Ranklist): ResolvedSorterConfig {
  const rawConfig = isICPCSorter(ranklist) ? ranklist.sorter.config || {} : {};
  const timeRounding =
    rawConfig.timeRounding === 'ceil' || rawConfig.timeRounding === 'round' || rawConfig.timeRounding === 'floor'
      ? rawConfig.timeRounding
      : 'floor';
  return {
    penalty: rawConfig.penalty || [20, 'min'],
    noPenaltyResults: Array.isArray(rawConfig.noPenaltyResults)
      ? [...rawConfig.noPenaltyResults]
      : [...DEFAULT_NO_PENALTY_RESULTS],
    timePrecision: isTimeUnit(rawConfig.timePrecision) ? rawConfig.timePrecision : undefined,
    timeRounding,
  };
}

function compareRowsByScore(a: srk.RanklistRow, b: srk.RanklistRow) {
  if (a.score.value !== b.score.value) {
    return b.score.value - a.score.value;
  }
  const timeA = a.score.time ? parseTimeDuration(a.score.time) : { valid: true as const, ms: 0 };
  const timeB = b.score.time ? parseTimeDuration(b.score.time) : { valid: true as const, ms: 0 };
  if (!timeA.valid || !timeB.valid) {
    return 0;
  }
  return timeA.ms - timeB.ms;
}

function collectDeclaredFirstBloodCells(ranklist: srk.Ranklist, problemIndex: number) {
  const cells = new Map<string, any>();
  (ranklist.rows || []).forEach((row, rowIndex) => {
    const status = row.statuses?.[problemIndex];
    if (!status) {
      return;
    }
    const key = `${rowIndex}:${problemIndex}`;
    const add = (source: 'status' | 'solution', time?: srk.TimeDuration, solutionIndex?: number) => {
      const current = cells.get(key) || {
        rowIndex,
        problemIndex,
        userId: getRowUserId(row),
        sources: [],
      };
      current.sources.push(source);
      if (time) {
        current.time = time;
      }
      if (solutionIndex !== undefined) {
        current.solutionIndex = solutionIndex;
      }
      cells.set(key, current);
    };
    if (status.result === 'FB') {
      add('status', status.time);
    }
    (status.solutions || []).forEach((solution, solutionIndex) => {
      if (solution.result === 'FB') {
        add('solution', solution.time, solutionIndex);
      }
    });
  });
  return [...cells.values()];
}

function collectAcceptedProblemIndexes(ranklist: srk.Ranklist) {
  const indexes = new Set<number>();
  (ranklist.problems || []).forEach((problem, problemIndex) => {
    if ((problem.statistics?.accepted || 0) > 0) {
      indexes.add(problemIndex);
    }
  });
  (ranklist.rows || []).forEach((row) => {
    (row.statuses || []).forEach((status, problemIndex) => {
      if (status.result === 'AC' || status.result === 'FB') {
        indexes.add(problemIndex);
        return;
      }
      if ((status.solutions || []).some((solution) => solution.result === 'AC' || solution.result === 'FB')) {
        indexes.add(problemIndex);
      }
    });
  });
  return indexes;
}

function collectAcceptedSolutions(ranklist: srk.Ranklist, problemIndex: number) {
  const accepted: Array<{
    rowIndex: number;
    problemIndex: number;
    solutionIndex: number;
    userId: string;
    result: string;
    source: 'solution' | 'status';
    time: srk.TimeDuration;
    ms: number;
  }> = [];
  (ranklist.rows || []).forEach((row, rowIndex) => {
    const status = row.statuses?.[problemIndex];
    const solutions = status?.solutions || [];
    if (solutions.length) {
      solutions.forEach((solution, solutionIndex) => {
        if (solution.result !== 'AC' && solution.result !== 'FB') {
          return;
        }
        const parsed = parseTimeDuration(solution.time);
        if (!parsed.valid) {
          return;
        }
        accepted.push({
          rowIndex,
          problemIndex,
          solutionIndex,
          userId: getRowUserId(row),
          result: solution.result,
          source: 'solution',
          time: solution.time,
          ms: parsed.ms,
        });
      });
      return;
    }
    if (!status || (status.result !== 'AC' && status.result !== 'FB') || !status.time) {
      return;
    }
    const parsed = parseTimeDuration(status.time);
    if (!parsed.valid) {
      return;
    }
    accepted.push({
      rowIndex,
      problemIndex,
      solutionIndex: -1,
      userId: getRowUserId(row),
      result: status.result,
      source: 'status',
      time: status.time,
      ms: parsed.ms,
    });
  });
  return accepted.sort((a, b) => a.ms - b.ms);
}

function getUniqueEarliestAcceptedSolution(acceptedSolutions: ReturnType<typeof collectAcceptedSolutions>) {
  if (!acceptedSolutions.length) {
    return null;
  }
  if (acceptedSolutions.length > 1 && isNearlyEqual(acceptedSolutions[0].ms, acceptedSolutions[1].ms)) {
    return null;
  }
  return acceptedSolutions[0];
}

function pushFirstBloodSuggestion(
  ranklist: srk.Ranklist,
  suggestions: RanklistFirstBloodSuggestion[],
  problemIndex: number,
  accepted: NonNullable<ReturnType<typeof getUniqueEarliestAcceptedSolution>>,
) {
  if (suggestions.some((suggestion) => suggestion.problemIndex === problemIndex)) {
    return;
  }
  suggestions.push({
    problemIndex,
    problemAlias: ranklist.problems?.[problemIndex]?.alias,
    userId: accepted.userId,
    rowIndex: accepted.rowIndex,
    time: accepted.time,
  });
}

function collectSolutionCompletenessDetails(ranklist: srk.Ranklist) {
  let submittedStatuses = 0;
  let statusesWithSolutions = 0;
  let solutionCount = 0;
  let exactResultCount = 0;
  let liteResultCount = 0;
  let predefinedFullOnlyResultCount = 0;
  let customResultCount = 0;
  let invalidNullSolutionResultCount = 0;
  (ranklist.rows || []).forEach((row) => {
    (row.statuses || []).forEach((status) => {
      const solutions = status.solutions || [];
      if (status.result !== null || (status.tries || 0) > 0 || solutions.length > 0) {
        submittedStatuses++;
      }
      if (solutions.length > 0) {
        statusesWithSolutions++;
      }
      for (const solution of solutions) {
        solutionCount++;
        if (solution.result === null || solution.result === undefined) {
          invalidNullSolutionResultCount++;
        } else if (LITE_RESULTS.has(solution.result)) {
          liteResultCount++;
        } else if (FULL_ONLY_RESULTS.has(solution.result)) {
          predefinedFullOnlyResultCount++;
          exactResultCount++;
        } else {
          customResultCount++;
          exactResultCount++;
        }
      }
    });
  });
  return {
    submittedStatuses,
    statusesWithSolutions,
    solutionCount,
    exactResultCount,
    liteResultCount,
    predefinedLiteResultCount: liteResultCount,
    predefinedFullOnlyResultCount,
    customResultCount,
    invalidNullSolutionResultCount,
  };
}

function collectI18nDetails(ranklist: srk.Ranklist) {
  const texts: Array<{ path: string; text: srk.Text | undefined }> = [
    {
      path: 'contest.title',
      text: ranklist.contest?.title,
    },
  ];
  (ranklist.rows || []).forEach((row, rowIndex) => {
    texts.push({
      path: `rows[${rowIndex}].user.name`,
      text: row.user?.name,
    });
    if (row.user?.organization !== undefined) {
      texts.push({
        path: `rows[${rowIndex}].user.organization`,
        text: row.user.organization,
      });
    }
  });
  const languageCounts: Record<string, number> = {};
  const i18nPaths: string[] = [];
  for (const item of texts) {
    if (isI18nText(item.text)) {
      i18nPaths.push(item.path);
      for (const lang of Object.keys(item.text)) {
        languageCounts[lang] = (languageCounts[lang] || 0) + 1;
      }
    }
  }
  return {
    totalTextCount: texts.length,
    i18nCount: i18nPaths.length,
    plainTextCount: texts.length - i18nPaths.length,
    i18nPaths,
    languageCounts,
  };
}

function collectRowUserConsistencyDetails(rows: srk.RanklistRow[]) {
  const fieldSet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row.user || {}).forEach((key) => fieldSet.add(key));
  });
  const fields = [...fieldSet].sort();
  const missingByRow = rows
    .map((row, rowIndex) => {
      const missingFields = fields.filter((field) => !Object.prototype.hasOwnProperty.call(row.user || {}, field));
      return {
        rowIndex,
        userId: getRowUserId(row),
        missingFields,
      };
    })
    .filter((item) => item.missingFields.length > 0);
  return {
    fields,
    rowsWithAllFields: rows.length - missingByRow.length,
    missingByRow,
  };
}

function getICPCSeriesDetails(series: srk.RankSeries[]) {
  const icpcSeries = series
    .map((seriesConfig, index) => ({ seriesConfig, index }))
    .filter(({ seriesConfig }) => seriesConfig.rule?.preset === 'ICPC');
  const incompleteSeries: any[] = [];
  const invalidSeries: any[] = [];
  let usableICPCSeriesCount = 0;
  for (const { seriesConfig, index } of icpcSeries) {
    const options = (seriesConfig.rule as srk.RankSeriesRulePresetICPC).options || {};
    const countValues = options.count?.value || [];
    const ratioValues = options.ratio?.value || [];
    const hasUsableCount = countValues.some((value) => value > 0);
    const hasUsableRatio = ratioValues.some((value) => value > 0);
    if (hasUsableCount || hasUsableRatio) {
      usableICPCSeriesCount++;
    } else {
      incompleteSeries.push({
        index,
        title: seriesConfig.title,
        count: countValues,
        ratio: ratioValues,
      });
    }
    countValues.forEach((value, valueIndex) => {
      if (!Number.isInteger(value) || value < 0) {
        invalidSeries.push({
          index,
          valueIndex,
          field: 'count.value',
          value,
          severity: 'error',
        });
      }
    });
    ratioValues.forEach((value, valueIndex) => {
      if (typeof value !== 'number' || value <= 0 || value > 1) {
        invalidSeries.push({
          index,
          valueIndex,
          field: 'ratio.value',
          value,
          severity: 'error',
        });
      }
    });
    const ratioSum = ratioValues.reduce((sum, value) => sum + value, 0);
    if (ratioSum > 1) {
      invalidSeries.push({
        index,
        field: 'ratio.value',
        value: ratioValues,
        severity: 'warning',
        reason: 'ratio sum exceeds 1',
      });
    }
  }
  return {
    seriesCount: series.length,
    icpcSeriesCount: icpcSeries.length,
    usableICPCSeriesCount,
    incompleteSeries,
    invalidSeries,
  };
}

function countStatusesWithSolutions(ranklist: srk.Ranklist) {
  let count = 0;
  for (const row of ranklist.rows || []) {
    for (const status of row.statuses || []) {
      if (Array.isArray(status.solutions) && status.solutions.length) {
        count++;
      }
    }
  }
  return count;
}

function collectRowMarkerIds(user: srk.User) {
  if (Array.isArray(user.markers)) {
    return uniqueValues(user.markers.filter(Boolean));
  }
  const ids: string[] = [];
  if (user.marker) {
    ids.push(user.marker);
  }
  return uniqueValues(ids);
}

function detectMockTimePattern(times: number[]) {
  if (times.every((time) => isNearlyEqual(time, times[0]))) {
    return 'identical';
  }
  const sorted = [...times].sort((a, b) => a - b);
  const deltas = sorted.slice(1).map((time, index) => time - sorted[index]);
  if (deltas.length && deltas.every((delta) => isNearlyEqual(delta, deltas[0]))) {
    if (isNearlyEqual(deltas[0], 1000)) {
      return 'uniform-1s';
    }
    if (isNearlyEqual(deltas[0], 60 * 1000)) {
      return 'uniform-1min';
    }
  }
  return null;
}

function makeCheck(
  key: keyof RanklistCorrectnessChecks,
  label: string,
  status: DiagnosticCheckStatus,
  checkedCount: number,
  failedCount: number,
  details: Record<string, any>,
): RanklistDiagnosticCheck {
  return {
    key,
    label,
    status,
    checkedCount,
    failedCount,
    details,
  };
}

function levelFromCoverage(presentCount: number, totalCount: number): CompletenessLevel {
  if (totalCount <= 0) {
    return 'notApplicable';
  }
  if (presentCount <= 0) {
    return 'missing';
  }
  const ratio = presentCount / totalCount;
  if (ratio >= 1) {
    return 'complete';
  }
  if (ratio >= 0.8) {
    return 'mostly';
  }
  return 'partial';
}

function parseTimeDuration(value: any): TimeParseResult {
  if (!Array.isArray(value) || value.length !== 2) {
    return { valid: false };
  }
  const [durationValue, unit] = value;
  if (!Number.isFinite(durationValue) || durationValue < 0 || !TIME_UNITS.includes(unit)) {
    return { valid: false };
  }
  try {
    return {
      valid: true,
      value: durationValue,
      unit,
      ms: formatTimeDuration(value as srk.TimeDuration, 'ms'),
    };
  } catch (e) {
    return { valid: false };
  }
}

function safeFormatTimeDuration(
  value: any,
  targetUnit: srk.TimeUnit,
  fmt: (num: number) => number = (num) => num,
) {
  if (!parseTimeDuration(value).valid) {
    return null;
  }
  try {
    return formatTimeDuration(value as srk.TimeDuration, targetUnit, fmt);
  } catch (e) {
    return null;
  }
}

function isTimeUnit(value: any): value is srk.TimeUnit {
  return TIME_UNITS.includes(value);
}

function sameStatusSummaryOptionalTime(
  statusTime: srk.TimeDuration | undefined,
  solutionTime: srk.TimeDuration | undefined,
) {
  if (!statusTime && !solutionTime) {
    return true;
  }
  if (!solutionTime) {
    return isZeroTimeDuration(statusTime);
  }
  if (!statusTime) {
    return false;
  }
  return sameStatusSummaryTime(statusTime, solutionTime);
}

function sameStatusSummaryTime(statusTime: srk.TimeDuration, solutionTime: srk.TimeDuration) {
  const parsedStatus = parseTimeDuration(statusTime);
  if (!parsedStatus.valid) {
    return false;
  }
  const solutionValue = safeFormatTimeDuration(solutionTime, parsedStatus.unit, Math.floor);
  return solutionValue !== null && isNearlyEqual(parsedStatus.value, solutionValue);
}

function isZeroTimeDuration(value: srk.TimeDuration | undefined) {
  if (!value) {
    return true;
  }
  const parsed = parseTimeDuration(value);
  return parsed.valid && isNearlyZero(parsed.ms);
}

function isICPCSorter(ranklist: srk.Ranklist): ranklist is srk.Ranklist & { sorter: srk.SorterICPC } {
  return ranklist.sorter?.algorithm === 'ICPC';
}

function problemLabel(ranklist: srk.Ranklist, problemIndex: number) {
  return ranklist.problems?.[problemIndex]?.alias || `${problemIndex}`;
}

function getRowUserId(row: srk.RanklistRow) {
  const id = row.user?.id;
  if (id) {
    return `${id}`;
  }
  const name = row.user?.name;
  return typeof name === 'string' ? name : JSON.stringify(name);
}

function isI18nText(text: srk.Text | undefined): text is srk.I18NStringSet {
  return Boolean(text && typeof text === 'object' && !Array.isArray(text));
}

function roundingFn(name: 'floor' | 'ceil' | 'round') {
  if (name === 'ceil') {
    return Math.ceil;
  }
  if (name === 'round') {
    return Math.round;
  }
  return Math.floor;
}

function uniqueValues<T>(values: T[]) {
  const result: T[] = [];
  for (const value of values) {
    if (!result.some((item) => item === value)) {
      result.push(value);
    }
  }
  return result;
}

function sameNoPenaltyResults(
  a: ResolvedSorterConfig['noPenaltyResults'],
  b: ResolvedSorterConfig['noPenaltyResults'],
) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isNearlyZero(value: number) {
  return Math.abs(value) < 1e-9;
}

function isNearlyEqual(a: number, b: number) {
  return Math.abs(a - b) < 1e-9;
}

function isMultipleOf(value: number, unit: number) {
  return isNearlyEqual(value / unit, Math.round(value / unit));
}

function camelToConstant(value: string) {
  return value.replace(/[A-Z]/g, (match) => `_${match}`).toUpperCase();
}
