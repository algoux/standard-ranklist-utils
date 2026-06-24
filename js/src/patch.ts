import type * as srk from '@algoux/standard-ranklist';
import {
  diagnoseRanklist,
  type RanklistDiagnostics,
  type RanklistFirstBloodSuggestion,
  type RanklistProblemStatisticsSuggestion,
  type RanklistSorterSuggestion,
} from './diagnostics';

export type RanklistPatchPathSegment = string | number;
export type RanklistPatchPath = RanklistPatchPathSegment[];
export type RanklistPatchPathInput = RanklistPatchPath | string;

export type RanklistPatchTarget =
  | {
      type: 'ranklist';
      path?: RanklistPatchPathInput;
    }
  | {
      type: 'contest';
      path?: RanklistPatchPathInput;
    }
  | ({
      type: 'problem';
      path?: RanklistPatchPathInput;
    } & ProblemLocator)
  | ({
      type: 'row';
      path?: RanklistPatchPathInput;
    } & RowLocator)
  | ({
      type: 'status';
      path?: RanklistPatchPathInput;
    } & RowLocator &
      ProblemLocator)
  | ({
      type: 'solution';
      solutionIndex: number;
      path?: RanklistPatchPathInput;
    } & RowLocator &
      ProblemLocator)
  | {
      type: 'sorter';
      path?: RanklistPatchPathInput;
    }
  | {
      /** @deprecated Use `{ type: 'sorter', path: 'config' }` instead. */
      type: 'sorterConfig';
      path?: RanklistPatchPathInput;
    };

export interface RanklistPatchCondition {
  target?: RanklistPatchTarget;
  exists?: true;
  missing?: true;
  equals?: any;
  in?: any[];
}

export type RanklistPatchOperation =
  | ({
      op: 'set';
      value: any;
    } & RanklistPatchOperationBase)
  | ({
      op: 'merge';
      value: Record<string, any>;
    } & RanklistPatchOperationBase)
  | ({
      op: 'unset';
    } & RanklistPatchOperationBase)
  | ({
      op: 'append';
      value: any;
      uniqueBy?: RanklistPatchPathInput;
    } & RanklistPatchOperationBase);

export interface RanklistPatchOperationBase {
  target: RanklistPatchTarget;
  optional?: boolean;
  when?: RanklistPatchCondition | RanklistPatchCondition[];
  metadata?: Record<string, any>;
}

export interface RanklistPatch {
  type: 'srk-patch';
  version: 1;
  metadata?: Record<string, any>;
  operations: RanklistPatchOperation[];
}

export interface PatchRanklistOptions {}

export interface DiagnosticPatchOptions {
  firstBlood?: boolean;
  sorter?: boolean;
  problemStatistics?: boolean;
}

interface ProblemLocator {
  problemIndex?: number;
  problemAlias?: string;
}

interface RowLocator {
  rowIndex?: number;
  userId?: string;
}

interface ResolvedLocation {
  parent: any;
  key: RanklistPatchPathSegment | null;
  value: any;
  exists: boolean;
}

class PatchTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchTargetError';
  }
}

/**
 * Apply a static SRK patch and return a new ranklist object.
 *
 * The input ranklist is never mutated. Operations are applied sequentially to a deep-cloned copy, so callers can chain
 * calls by feeding the returned ranklist into the next `patchRanklist` invocation.
 */
export function patchRanklist(
  ranklist: srk.Ranklist,
  patch: RanklistPatch,
  _options: PatchRanklistOptions = {},
): srk.Ranklist {
  assertValidPatch(patch);
  let patched = cloneDeep(ranklist);
  for (const operation of patch.operations) {
    if (!matchesConditions(patched, operation)) {
      continue;
    }
    try {
      patched = applyOperation(patched, operation);
    } catch (error) {
      if (operation.optional && error instanceof PatchTargetError) {
        continue;
      }
      throw error;
    }
  }
  return patched;
}

/**
 * Convert current diagnostic suggestions into a directly applicable patch object.
 *
 * First-blood suggestions are all emitted. Sorter suggestions are candidate alternatives, so only the first ranked
 * sorter suggestion is included.
 */
export function createRanklistPatchFromDiagnostics(
  ranklist: srk.Ranklist,
  diagnostics: RanklistDiagnostics = diagnoseRanklist(ranklist),
  options: DiagnosticPatchOptions = {},
): RanklistPatch {
  const includeFirstBlood = options.firstBlood !== false;
  const includeSorter = options.sorter !== false;
  const includeProblemStatistics = options.problemStatistics !== false;
  const operations: RanklistPatchOperation[] = [];
  const firstBloodSuggestions = includeFirstBlood ? diagnostics.suggestions.firstBlood : [];
  const problemStatisticsSuggestions = includeProblemStatistics ? diagnostics.suggestions.problemStatistics : [];
  const sorterSuggestion = includeSorter ? diagnostics.suggestions.sorter[0] : undefined;

  for (const suggestion of firstBloodSuggestions) {
    operations.push(...buildFirstBloodOperations(ranklist, suggestion));
  }
  for (const suggestion of problemStatisticsSuggestions) {
    operations.push(buildProblemStatisticsOperation(ranklist, suggestion));
  }
  if (sorterSuggestion) {
    operations.push(buildSorterOperation(sorterSuggestion));
  }

  const metadataDiagnostics: Record<string, any> = {
    firstBlood: firstBloodSuggestions,
    problemStatistics: problemStatisticsSuggestions,
  };
  if (sorterSuggestion) {
    metadataDiagnostics.sorter = {
      config: sorterSuggestion.config,
      confidence: sorterSuggestion.confidence,
      resolvedIssues: sorterSuggestion.resolvedIssues,
    };
  }

  return {
    type: 'srk-patch',
    version: 1,
    metadata: {
      source: 'standard-ranklist-utils',
      description: 'Patch generated from SRK diagnostics suggestions.',
      diagnostics: metadataDiagnostics,
    },
    operations,
  };
}

function buildFirstBloodOperations(
  ranklist: srk.Ranklist,
  suggestion: RanklistFirstBloodSuggestion,
): RanklistPatchOperation[] {
  const operations: RanklistPatchOperation[] = [];
  const problemTarget = getProblemTarget(ranklist, suggestion.problemIndex);
  (ranklist.rows || []).forEach((row, rowIndex) => {
    const rowTarget = getRowTarget(row, rowIndex);
    const status = row.statuses?.[suggestion.problemIndex];
    if (!status) {
      return;
    }
    if (status.result === 'FB') {
      operations.push({
        op: 'set',
        target: { type: 'status', ...rowTarget, ...problemTarget, path: ['result'] },
        value: 'AC',
        when: [{ target: { type: 'status', ...rowTarget, ...problemTarget, path: ['result'] }, equals: 'FB' }],
      });
    }
    (status.solutions || []).forEach((solution, solutionIndex) => {
      if (solution.result !== 'FB') {
        return;
      }
      operations.push({
        op: 'set',
        target: { type: 'solution', ...rowTarget, ...problemTarget, solutionIndex, path: ['result'] },
        value: 'AC',
        when: [
          { target: { type: 'solution', ...rowTarget, ...problemTarget, solutionIndex, path: ['result'] }, equals: 'FB' },
        ],
      });
    });
  });

  const targetRow = ranklist.rows?.[suggestion.rowIndex];
  const targetStatus = targetRow?.statuses?.[suggestion.problemIndex];
  const targetRowLocator = getRowTarget(targetRow, suggestion.rowIndex, suggestion.userId);
  operations.push({
    op: 'set',
    target: { type: 'status', ...targetRowLocator, ...problemTarget, path: ['result'] },
    value: 'FB',
  });

  const targetSolutionIndex = findAcceptedSolutionIndex(targetStatus, suggestion.time);
  if (targetSolutionIndex !== null) {
    operations.push({
      op: 'set',
      target: {
        type: 'solution',
        ...targetRowLocator,
        ...problemTarget,
        solutionIndex: targetSolutionIndex,
        path: ['result'],
      },
      value: 'FB',
      when: [
        {
          target: {
            type: 'solution',
            ...targetRowLocator,
            ...problemTarget,
            solutionIndex: targetSolutionIndex,
            path: ['result'],
          },
          in: ['AC', 'FB'],
        },
      ],
    });
  }

  return operations;
}

function buildSorterOperation(suggestion: RanklistSorterSuggestion): RanklistPatchOperation {
  return {
    op: 'merge',
    target: { type: 'sorter', path: 'config' },
    value: suggestion.config,
    metadata: {
      source: 'standard-ranklist-utils',
      confidence: suggestion.confidence,
      resolvedIssues: suggestion.resolvedIssues,
    },
  };
}

function buildProblemStatisticsOperation(
  ranklist: srk.Ranklist,
  suggestion: RanklistProblemStatisticsSuggestion,
): RanklistPatchOperation {
  return {
    op: 'set',
    target: { type: 'problem', ...getProblemTarget(ranklist, suggestion.problemIndex), path: 'statistics' },
    value: suggestion.expected,
    metadata: {
      source: 'standard-ranklist-utils',
      confidence: suggestion.confidence,
      reason: suggestion.reason,
    },
  };
}

function getProblemTarget(ranklist: srk.Ranklist, problemIndex: number): ProblemLocator {
  const alias = ranklist.problems?.[problemIndex]?.alias;
  return alias ? { problemIndex, problemAlias: alias } : { problemIndex };
}

function getRowTarget(row: srk.RanklistRow | undefined, rowIndex: number, fallbackUserId?: string): RowLocator {
  const userId = row?.user?.id || fallbackUserId;
  return userId ? { rowIndex, userId } : { rowIndex };
}

function findAcceptedSolutionIndex(status: srk.RankProblemStatus | undefined, time: srk.TimeDuration) {
  if (!status?.solutions?.length) {
    return null;
  }
  const index = status.solutions.findIndex((solution) => {
    return (solution.result === 'AC' || solution.result === 'FB') && deepEqual(solution.time, time);
  });
  return index >= 0 ? index : null;
}

function applyOperation(ranklist: srk.Ranklist, operation: RanklistPatchOperation): srk.Ranklist {
  switch (operation.op) {
    case 'set':
      return setLocation(ranklist, resolveTarget(ranklist, operation.target, true), operation.value);
    case 'merge':
      return mergeLocation(ranklist, resolveTarget(ranklist, operation.target, true), operation.value);
    case 'unset':
      return unsetLocation(ranklist, resolveTarget(ranklist, operation.target, false));
    case 'append':
      return appendLocation(ranklist, resolveTarget(ranklist, operation.target, true), operation.value, operation.uniqueBy);
  }
}

function matchesConditions(ranklist: srk.Ranklist, operation: RanklistPatchOperation) {
  const conditions = Array.isArray(operation.when) ? operation.when : operation.when ? [operation.when] : [];
  for (const condition of conditions) {
    if (!matchesCondition(ranklist, operation.target, condition)) {
      return false;
    }
  }
  return true;
}

function matchesCondition(ranklist: srk.Ranklist, operationTarget: RanklistPatchTarget, condition: RanklistPatchCondition) {
  const target = condition.target || operationTarget;
  const location = resolveTargetSafe(ranklist, target);
  if (condition.exists) {
    return location.found;
  }
  if (condition.missing) {
    return !location.found;
  }
  if (!location.found) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(condition, 'equals')) {
    return deepEqual(location.value, condition.equals);
  }
  if (Array.isArray(condition.in)) {
    return condition.in.some((item) => deepEqual(location.value, item));
  }
  return true;
}

function resolveTargetSafe(ranklist: srk.Ranklist, target: RanklistPatchTarget) {
  try {
    const location = resolveTarget(ranklist, target, false);
    return {
      found: location.exists,
      value: location.value,
    };
  } catch (error) {
    if (error instanceof PatchTargetError) {
      return {
        found: false,
        value: undefined,
      };
    }
    throw error;
  }
}

function setLocation(ranklist: srk.Ranklist, location: ResolvedLocation, value: any): srk.Ranklist {
  const clonedValue = cloneDeep(value);
  if (isRootLocation(location)) {
    return clonedValue;
  }
  setChildValue(location.parent, location.key!, clonedValue);
  return ranklist;
}

function mergeLocation(ranklist: srk.Ranklist, location: ResolvedLocation, value: Record<string, any>): srk.Ranklist {
  if (!isPlainObject(value)) {
    throw new PatchTargetError('merge operation value must be a plain object');
  }
  if (!location.exists) {
    setLocation(ranklist, location, {});
    location = resolveLocationAfterCreate(location);
  }
  if (!isPlainObject(location.value)) {
    throw new PatchTargetError('merge target must resolve to a plain object');
  }
  Object.assign(location.value, cloneDeep(value));
  return ranklist;
}

function unsetLocation(ranklist: srk.Ranklist, location: ResolvedLocation): srk.Ranklist {
  if (isRootLocation(location)) {
    throw new PatchTargetError('Cannot unset ranklist root');
  }
  if (!location.exists) {
    throw new PatchTargetError(`Cannot unset missing target ${formatKey(location.key)}`);
  }
  if (Array.isArray(location.parent)) {
    assertArrayIndex(location.parent, location.key, false);
    location.parent.splice(location.key as number, 1);
  } else {
    delete location.parent[location.key as string];
  }
  return ranklist;
}

function appendLocation(
  ranklist: srk.Ranklist,
  location: ResolvedLocation,
  value: any,
  uniqueBy: RanklistPatchPathInput | undefined,
): srk.Ranklist {
  if (!location.exists) {
    setLocation(ranklist, location, []);
    location = resolveLocationAfterCreate(location);
  }
  if (!Array.isArray(location.value)) {
    throw new PatchTargetError('append target must resolve to an array');
  }
  const item = cloneDeep(value);
  const uniquePath = normalizePath(uniqueBy);
  if (uniquePath.length) {
    const candidate = getValueAtPath(item, uniquePath);
    if (candidate.found && location.value.some((current: any) => deepEqual(getValueAtPath(current, uniquePath).value, candidate.value))) {
      return ranklist;
    }
  }
  location.value.push(item);
  return ranklist;
}

function resolveLocationAfterCreate(location: ResolvedLocation): ResolvedLocation {
  return {
    ...location,
    exists: true,
    value: isRootLocation(location) ? location.value : location.parent[location.key as any],
  };
}

function resolveTarget(ranklist: srk.Ranklist, target: RanklistPatchTarget, createParents: boolean): ResolvedLocation {
  const base = resolveBaseTarget(ranklist, target, createParents);
  return resolvePath(base, normalizePath(target.path), createParents);
}

function resolveBaseTarget(ranklist: srk.Ranklist, target: RanklistPatchTarget, createParents: boolean): ResolvedLocation {
  switch (target.type) {
    case 'ranklist':
      return { parent: null, key: null, value: ranklist, exists: true };
    case 'contest':
      return { parent: ranklist, key: 'contest', value: ranklist.contest, exists: true };
    case 'problem': {
      const problemIndex = resolveProblemIndex(ranklist, target);
      return {
        parent: ranklist.problems,
        key: problemIndex,
        value: ranklist.problems[problemIndex],
        exists: true,
      };
    }
    case 'row': {
      const rowIndex = resolveRowIndex(ranklist, target);
      return {
        parent: ranklist.rows,
        key: rowIndex,
        value: ranklist.rows[rowIndex],
        exists: true,
      };
    }
    case 'status': {
      const rowIndex = resolveRowIndex(ranklist, target);
      const problemIndex = resolveProblemIndex(ranklist, target);
      const row = ranklist.rows[rowIndex];
      const status = row.statuses?.[problemIndex];
      if (!status) {
        throw new PatchTargetError(`Status not found at rows[${rowIndex}].statuses[${problemIndex}]`);
      }
      return {
        parent: row.statuses,
        key: problemIndex,
        value: status,
        exists: true,
      };
    }
    case 'solution': {
      const rowIndex = resolveRowIndex(ranklist, target);
      const problemIndex = resolveProblemIndex(ranklist, target);
      const row = ranklist.rows[rowIndex];
      const status = row.statuses?.[problemIndex];
      const solutions = status?.solutions;
      if (!Array.isArray(solutions)) {
        throw new PatchTargetError(`Solutions not found at rows[${rowIndex}].statuses[${problemIndex}].solutions`);
      }
      assertArrayIndex(solutions, target.solutionIndex, false);
      return {
        parent: solutions,
        key: target.solutionIndex,
        value: solutions[target.solutionIndex],
        exists: true,
      };
    }
    case 'sorter': {
      if (!ranklist.sorter) {
        throw new PatchTargetError('Sorter target requires ranklist.sorter');
      }
      return {
        parent: ranklist,
        key: 'sorter',
        value: ranklist.sorter,
        exists: true,
      };
    }
    case 'sorterConfig': {
      if (ranklist.sorter?.algorithm !== 'ICPC') {
        throw new PatchTargetError('sorterConfig target requires an ICPC sorter');
      }
      if (!ranklist.sorter.config) {
        if (!createParents) {
          throw new PatchTargetError('sorter.config is missing');
        }
        ranklist.sorter.config = {};
      }
      return {
        parent: ranklist.sorter,
        key: 'config',
        value: ranklist.sorter.config,
        exists: true,
      };
    }
  }
}

function resolveProblemIndex(ranklist: srk.Ranklist, locator: ProblemLocator) {
  if (typeof locator.problemIndex !== 'number' && locator.problemAlias === undefined) {
    throw new PatchTargetError('Problem target requires problemIndex or problemAlias');
  }
  let indexFromAlias = -1;
  if (locator.problemAlias !== undefined) {
    indexFromAlias = (ranklist.problems || []).findIndex((problem) => problem.alias === locator.problemAlias);
    if (indexFromAlias < 0) {
      throw new PatchTargetError(`Problem alias not found: ${locator.problemAlias}`);
    }
  }
  if (typeof locator.problemIndex === 'number') {
    assertArrayIndex(ranklist.problems, locator.problemIndex, false);
    if (indexFromAlias >= 0 && indexFromAlias !== locator.problemIndex) {
      throw new PatchTargetError('problemIndex and problemAlias do not resolve to the same problem');
    }
    return locator.problemIndex;
  }
  return indexFromAlias;
}

function resolveRowIndex(ranklist: srk.Ranklist, locator: RowLocator) {
  if (typeof locator.rowIndex !== 'number' && locator.userId === undefined) {
    throw new PatchTargetError('Row target requires rowIndex or userId');
  }
  let indexFromUserId = -1;
  if (locator.userId !== undefined) {
    indexFromUserId = (ranklist.rows || []).findIndex((row) => `${row.user?.id}` === locator.userId);
    if (indexFromUserId < 0) {
      throw new PatchTargetError(`Row userId not found: ${locator.userId}`);
    }
  }
  if (typeof locator.rowIndex === 'number') {
    assertArrayIndex(ranklist.rows, locator.rowIndex, false);
    if (indexFromUserId >= 0 && indexFromUserId !== locator.rowIndex) {
      throw new PatchTargetError('rowIndex and userId do not resolve to the same row');
    }
    return locator.rowIndex;
  }
  return indexFromUserId;
}

function resolvePath(base: ResolvedLocation, path: RanklistPatchPath, createParents: boolean): ResolvedLocation {
  if (!path.length) {
    return base;
  }
  let current = base.value;
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    ensureContainer(current, segment);
    const child = getChild(current, segment);
    if (!child.found || child.value === undefined || child.value === null) {
      if (!createParents) {
        throw new PatchTargetError(`Path segment not found: ${formatKey(segment)}`);
      }
      const nextContainer = typeof nextSegment === 'number' ? [] : {};
      setChildValue(current, segment, nextContainer);
      current = nextContainer;
    } else {
      current = child.value;
    }
  }
  const key = path[path.length - 1];
  ensureContainer(current, key, true);
  const child = getChild(current, key);
  return {
    parent: current,
    key,
    value: child.value,
    exists: child.found,
  };
}

function ensureContainer(container: any, key: RanklistPatchPathSegment, allowFinal = false) {
  if (Array.isArray(container)) {
    assertArrayIndex(container, key, allowFinal);
    return;
  }
  if (!isObjectLike(container)) {
    throw new PatchTargetError(`Cannot access ${formatKey(key)} on a non-container value`);
  }
}

function getChild(container: any, key: RanklistPatchPathSegment) {
  if (Array.isArray(container)) {
    assertArrayIndex(container, key, true);
    const index = key as number;
    return {
      found: index >= 0 && index < container.length,
      value: container[index],
    };
  }
  return {
    found: Object.prototype.hasOwnProperty.call(container, key),
    value: container[key as any],
  };
}

function setChildValue(container: any, key: RanklistPatchPathSegment, value: any) {
  if (Array.isArray(container)) {
    assertArrayIndex(container, key, true);
    container[key as number] = value;
  } else if (isObjectLike(container)) {
    container[key as any] = value;
  } else {
    throw new PatchTargetError(`Cannot set ${formatKey(key)} on a non-container value`);
  }
}

function assertArrayIndex(array: any[], key: RanklistPatchPathSegment | null, allowAppend: boolean) {
  if (typeof key !== 'number' || !Number.isInteger(key) || key < 0) {
    throw new PatchTargetError(`Array path segment must be a non-negative integer: ${formatKey(key)}`);
  }
  if (key > array.length || (!allowAppend && key >= array.length)) {
    throw new PatchTargetError(`Array index out of bounds: ${key}`);
  }
}

function getValueAtPath(value: any, path: RanklistPatchPath) {
  let current = value;
  for (const segment of path) {
    if (!isObjectLike(current)) {
      return { found: false, value: undefined };
    }
    const child = getChild(current, segment);
    if (!child.found) {
      return { found: false, value: undefined };
    }
    current = child.value;
  }
  return { found: true, value: current };
}

function isRootLocation(location: ResolvedLocation) {
  return location.parent === null && location.key === null;
}

function normalizePath(path: RanklistPatchPathInput | undefined): RanklistPatchPath {
  if (path === undefined) {
    return [];
  }
  if (Array.isArray(path)) {
    return path;
  }
  return path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => (/^(0|[1-9]\d*)$/.test(segment) ? Number(segment) : segment));
}

function isObjectLike(value: any) {
  return typeof value === 'object' && value !== null;
}

function isPlainObject(value: any): value is Record<string, any> {
  if (!isObjectLike(value) || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneDeep(item)) as any;
  }
  const cloned: Record<string, any> = {};
  for (const key in value as any) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      cloned[key] = cloneDeep((value as any)[key]);
    }
  }
  return cloned as T;
}

function deepEqual(left: any, right: any): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (left === null || right === null || typeof left !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
}

function assertValidPatch(patch: RanklistPatch) {
  if (!isPlainObject(patch) || patch.type !== 'srk-patch' || patch.version !== 1 || !Array.isArray(patch.operations)) {
    throw new Error('Invalid srk patch: expected type "srk-patch", version 1, and operations array');
  }
  patch.operations.forEach((operation, index) => {
    if (!isPlainObject(operation) || !isPlainObject(operation.target)) {
      throw new Error(`Invalid srk patch operation at index ${index}`);
    }
    if (operation.op !== 'set' && operation.op !== 'merge' && operation.op !== 'unset' && operation.op !== 'append') {
      throw new Error(`Unsupported srk patch operation at index ${index}: ${(operation as any).op}`);
    }
  });
}

function formatKey(key: RanklistPatchPathSegment | null) {
  return key === null ? '<root>' : JSON.stringify(key);
}
