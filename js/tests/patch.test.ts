import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import {
  createRanklistPatchFromDiagnostics,
  diagnoseRanklist,
  patchRanklist,
  type RanklistPatch,
} from '../src';

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
    sorter: {
      algorithm: 'ICPC',
      config: {},
    },
    rows: [
      makeRow('u1', { value: 1, time: [10, 'min'] }, [
        { result: 'AC', time: [10, 'min'], tries: 1, solutions: [{ result: 'AC', time: [10, 'min'] }] },
        { result: null, solutions: [] },
      ]),
      makeRow('u2', { value: 0, time: [0, 'ms'] }, [
        { result: null, solutions: [] },
        { result: 'RJ', tries: 1, solutions: [{ result: 'RJ', time: [20, 'min'] }] },
      ]),
    ],
    ...overrides,
  };
}

function makeRow(
  id: string,
  score: srk.RankScore,
  statuses: srk.RankProblemStatus[],
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

describe('patchRanklist', () => {
  test('applies SRK-aware operations without mutating the input ranklist', () => {
    const ranklist = makeRanklist();
    const patch: RanklistPatch = {
      type: 'srk-patch',
      version: 1,
      operations: [
        {
          op: 'set',
          target: { type: 'contest', path: ['banner'] },
          value: 'https://example.com/banner.png',
        },
        {
          op: 'merge',
          target: { type: 'problem', problemIndex: 0, problemAlias: 'A', path: ['style'] },
          value: { backgroundColor: '#ff0000' },
        },
        {
          op: 'append',
          target: { type: 'row', userId: 'u1', path: ['user', 'teamMembers'] },
          value: { name: 'Coach', role: 'coach' },
          uniqueBy: ['role'],
        },
        {
          op: 'unset',
          target: { type: 'status', rowIndex: 1, userId: 'u2', problemIndex: 1, problemAlias: 'B', path: ['tries'] },
        },
      ],
    };

    const patched = patchRanklist(ranklist, patch);

    assert.notEqual(patched, ranklist);
    assert.equal(patched.contest.banner, 'https://example.com/banner.png');
    assert.deepEqual(patched.problems[0].style, { backgroundColor: '#ff0000' });
    assert.deepEqual(patched.rows[0].user.teamMembers, [{ name: 'Coach', role: 'coach' }]);
    assert.equal(patched.rows[1].statuses[1].tries, undefined);
    assert.equal(ranklist.contest.banner, undefined);
    assert.equal(ranklist.problems[0].style, undefined);
    assert.equal(ranklist.rows[0].user.teamMembers, undefined);
    assert.equal(ranklist.rows[1].statuses[1].tries, 1);
  });

  test('supports conditions, optional targets, and chained calls', () => {
    const ranklist = makeRanklist();
    const first = patchRanklist(ranklist, {
      type: 'srk-patch',
      version: 1,
      operations: [
        {
          op: 'set',
          target: { type: 'status', userId: 'u2', problemAlias: 'B', path: ['result'] },
          value: null,
          when: [{ target: { type: 'status', userId: 'u2', problemAlias: 'B', path: ['result'] }, equals: 'RJ' }],
        },
        {
          op: 'set',
          target: { type: 'status', userId: 'missing', problemIndex: 0, path: ['result'] },
          value: 'AC',
          optional: true,
        },
      ],
    });
    const second = patchRanklist(first, {
      type: 'srk-patch',
      version: 1,
      operations: [
        {
          op: 'set',
          target: { type: 'ranklist', path: ['metadata', 'patched'] },
          value: true,
          when: [
            { target: { type: 'ranklist', path: ['metadata', 'patched'] }, missing: true },
            { target: { type: 'status', userId: 'u2', problemAlias: 'B', path: ['result'] }, in: [null, 'AC'] },
          ],
        },
      ],
    } as RanklistPatch);

    assert.equal(first.rows[1].statuses[1].result, null);
    assert.equal((second as any).metadata.patched, true);
    assert.equal((ranklist as any).metadata, undefined);
  });

  test('supports sorter target with optional dotted paths', () => {
    const ranklist = makeRanklist();
    const patched = patchRanklist(ranklist, {
      type: 'srk-patch',
      version: 1,
      operations: [
        {
          op: 'merge',
          target: { type: 'sorter' },
          value: { config: { penalty: [15, 'min'] } },
        },
        {
          op: 'set',
          target: { type: 'sorter', path: 'config.noPenaltyResults' },
          value: ['FB', 'AC', '?', null],
        },
        {
          op: 'set',
          target: { type: 'sorter', path: 'config.timeRounding' },
          value: 'ceil',
        },
      ],
    });

    assert.deepEqual(patched.sorter?.algorithm === 'ICPC' ? patched.sorter.config.penalty : null, [15, 'min']);
    assert.deepEqual(patched.sorter?.algorithm === 'ICPC' ? patched.sorter.config.noPenaltyResults : null, [
      'FB',
      'AC',
      '?',
      null,
    ]);
    assert.equal(patched.sorter?.algorithm === 'ICPC' ? patched.sorter.config.timeRounding : null, 'ceil');
  });

  test('throws on invalid required targets', () => {
    const ranklist = makeRanklist();

    assert.throws(
      () =>
        patchRanklist(ranklist, {
          type: 'srk-patch',
          version: 1,
          operations: [
            {
              op: 'set',
              target: { type: 'problem', problemIndex: 0, problemAlias: 'B', path: ['title'] },
              value: 'Wrong',
            },
          ],
        }),
      /problemIndex and problemAlias do not resolve to the same problem/,
    );
  });

  test('creates a diagnostic patch that repairs first-blood conflicts and sorter config', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 2 } }],
      sorter: {
        algorithm: 'ICPC',
        config: {},
      },
      rows: [
        makeRow('u1', { value: 1, time: [30, 'min'] }, [
          {
            result: 'AC',
            time: [30, 'min'],
            tries: 2,
            solutions: [
              { result: 'CE', time: [10, 'min'] },
              { result: 'AC', time: [30, 'min'] },
            ],
          },
        ]),
        makeRow('u2', { value: 1, time: [40, 'min'] }, [
          {
            result: 'FB',
            time: [40, 'min'],
            tries: 1,
            solutions: [{ result: 'FB', time: [40, 'min'] }],
          },
        ]),
      ],
    });
    const diagnostics = diagnoseRanklist(ranklist);
    const patch = createRanklistPatchFromDiagnostics(ranklist, diagnostics);
    const patched = patchRanklist(ranklist, patch);

    assert.equal(patch.type, 'srk-patch');
    assert.equal(patch.metadata?.source, 'standard-ranklist-utils');
    assert.equal(patched.rows[0].statuses[0].result, 'FB');
    assert.equal(patched.rows[0].statuses[0].solutions?.[1].result, 'FB');
    assert.equal(patched.rows[1].statuses[0].result, 'AC');
    assert.equal(patched.rows[1].statuses[0].solutions?.[0].result, 'AC');
    assert.ok(patch.operations.some((operation) => operation.target.type === 'sorter'));
    assert.equal(patch.operations.some((operation) => operation.target.type === 'sorterConfig'), false);
    assert.deepEqual(patched.sorter?.algorithm === 'ICPC' ? patched.sorter.config.noPenaltyResults : null, [
      'FB',
      'AC',
      '?',
      'NOUT',
      'UKE',
      null,
    ]);
  });

  test('creates a diagnostic patch that repairs problem statistics suggestions', () => {
    const ranklist = makeRanklist({
      problems: [{ alias: 'A', statistics: { accepted: 1, submitted: 2 } }],
      rows: [
        makeRow('u1', { value: 1, time: [30, 'min'] }, [
          {
            result: 'AC',
            time: [30, 'min'],
            tries: 1,
            solutions: [
              { result: 'CE', time: [10, 'min'] },
              { result: 'AC', time: [30, 'min'] },
            ],
          },
        ]),
      ],
    });
    const diagnostics = diagnoseRanklist(ranklist);
    const patch = createRanklistPatchFromDiagnostics(ranklist, diagnostics, { sorter: false });
    const patched = patchRanklist(ranklist, patch);

    assert.ok(
      patch.operations.some((operation) => {
        return (
          operation.op === 'set' &&
          operation.target.type === 'problem' &&
          operation.target.path === 'statistics' &&
          operation.value.accepted === 1 &&
          operation.value.submitted === 1
        );
      }),
    );
    assert.deepEqual(patched.problems[0].statistics, { accepted: 1, submitted: 1 });
  });
});
