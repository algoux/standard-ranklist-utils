import type * as srk from '@algoux/standard-ranklist';
import { formatTimeDuration } from './formatters';

/** Problem indexes for the shared revealed prefix and the per-row anonymous suffix. */
export interface CCPC26ProblemLayout {
  revealedProblemIndexes: number[];
  hiddenProblemIndexes: number[];
}

/**
 * Resolve CCPC26 problem visibility from the complete current ranklist snapshot.
 *
 * Only the standard ICPC extended-algorithm configuration is recognized. The caller decides whether the display mode
 * is active; this helper does not inspect contest time or retain previously revealed problems. Display filters must
 * be applied after this calculation so they cannot change the participating population.
 *
 * @returns A layout in original problem order, or undefined when standard CCPC26 configuration is absent.
 */
export function getCCPC26ProblemLayout(ranklist: srk.Ranklist): CCPC26ProblemLayout | undefined {
  if (ranklist.sorter?.algorithm !== 'ICPC') {
    return undefined;
  }
  const extendedAlgorithms = ranklist.sorter.config?.extendedAlgorithms;
  const algorithm = Array.isArray(extendedAlgorithms)
    ? extendedAlgorithms.find((item) => item?.algorithm === 'CCPC26')
    : undefined;
  const threshold = algorithm?.config?.problemRevealAcceptedThreshold;
  if (!threshold || typeof threshold !== 'object' || Array.isArray(threshold)) {
    return undefined;
  }

  const acceptedCounts = new Array<number>(ranklist.problems.length).fill(0);
  let denominatorCount = 0;
  for (const row of ranklist.rows) {
    if (threshold.includeOfficialOnly && row.user.official === false) {
      continue;
    }
    const contributesToDenominator =
      threshold.denominator === 'submitted'
        ? row.statuses.some(hasSubmission)
        : threshold.denominator === 'scored'
        ? row.score.value > 0
        : true;
    if (contributesToDenominator) {
      denominatorCount += 1;
    }
    for (let index = 0; index < acceptedCounts.length; index++) {
      if (isAccepted(row.statuses[index])) {
        acceptedCounts[index] += 1;
      }
    }
  }

  const round = threshold.rounding === 'ceil' ? Math.ceil : threshold.rounding === 'round' ? Math.round : Math.floor;
  const countThreshold = isFiniteNumber(threshold.count) ? threshold.count : undefined;
  const ratioThreshold = isFiniteNumber(threshold.ratio) ? round(denominatorCount * threshold.ratio) : undefined;
  const layout: CCPC26ProblemLayout = { revealedProblemIndexes: [], hiddenProblemIndexes: [] };
  acceptedCounts.forEach((accepted, index) => {
    const revealed =
      (countThreshold !== undefined && accepted >= countThreshold) ||
      (ratioThreshold !== undefined && accepted >= ratioThreshold);
    (revealed ? layout.revealedProblemIndexes : layout.hiddenProblemIndexes).push(index);
  });
  return layout;
}

/**
 * Return problem indexes in CCPC26 display order without rearranging source statuses.
 *
 * Revealed problems come first. Hidden problems follow in accepted-time order, then latest-submission-time order,
 * then unsubmitted problem order. Missing times sort after known times within the same group; ties use original
 * problem indexes. The layout, rather than the statuses array length, determines which problem columns exist.
 */
export function getCCPC26RowProblemOrder(
  statuses: readonly srk.RankProblemStatus[],
  layout: CCPC26ProblemLayout,
): number[] {
  const hidden = layout.hiddenProblemIndexes.map((problemIndex) => {
    const status = statuses[problemIndex];
    const accepted = isAccepted(status);
    return {
      problemIndex,
      group: accepted ? 0 : hasSubmission(status) ? 1 : 2,
      time: accepted ? getAcceptedTime(status!) : getLastSubmissionTime(status),
    };
  });
  hidden.sort((left, right) => {
    if (left.group !== right.group) {
      return left.group - right.group;
    }
    if (left.group !== 2) {
      if (left.time === undefined && right.time !== undefined) {
        return 1;
      }
      if (left.time !== undefined && right.time === undefined) {
        return -1;
      }
      if (left.time !== undefined && right.time !== undefined && left.time !== right.time) {
        return left.time - right.time;
      }
    }
    return left.problemIndex - right.problemIndex;
  });
  return [...layout.revealedProblemIndexes, ...hidden.map((item) => item.problemIndex)];
}

function isAccepted(status: srk.RankProblemStatus | undefined): boolean {
  return status?.result === 'AC' || status?.result === 'FB';
}

function hasSubmission(status: srk.RankProblemStatus | undefined): boolean {
  return Boolean(status && (status.solutions?.length || status.result != null || (status.tries || 0) > 0));
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getTime(time: srk.TimeDuration | undefined): number | undefined {
  if (!time) {
    return undefined;
  }
  try {
    const value = formatTimeDuration(time);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function getAcceptedTime(status: srk.RankProblemStatus): number | undefined {
  const summaryTime = getTime(status.time);
  if (summaryTime !== undefined) {
    return summaryTime;
  }
  let earliest: number | undefined;
  for (const solution of status.solutions || []) {
    if (solution.result !== 'AC' && solution.result !== 'FB') {
      continue;
    }
    const time = getTime(solution.time);
    if (time !== undefined && (earliest === undefined || time < earliest)) {
      earliest = time;
    }
  }
  return earliest;
}

function getLastSubmissionTime(status: srk.RankProblemStatus | undefined): number | undefined {
  if (!status?.solutions?.length) {
    return getTime(status?.time);
  }
  let latest: number | undefined;
  for (const solution of status.solutions) {
    const time = getTime(solution.time);
    if (time !== undefined && (latest === undefined || time > latest)) {
      latest = time;
    }
  }
  return latest;
}
