import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import { EnumTheme } from '../src/enums';
import type { CalculatedSolutionTetrad, RankValue, StaticRanklist, ThemeColor } from '../src/types';

test('ranklist utility types accept representative srk-compatible values', () => {
  const rankValue: RankValue = {
    rank: 1,
    segmentIndex: null,
  };
  const solution: CalculatedSolutionTetrad = ['team-1', 0, 'AC', [79, 'min']];
  const themeColor: ThemeColor = {
    [EnumTheme.light]: '#111111',
    [EnumTheme.dark]: undefined,
  };
  const staticRanklist: StaticRanklist = {
    type: 'general',
    version: '0.3.9',
    contest: {
      title: 'Contest',
      startAt: '2026-01-01T00:00:00+08:00',
      duration: [5, 'h'],
    },
    problems: [{ alias: 'A' }],
    series: [{ title: 'Rank' }],
    markers: [{ id: 'girls', label: 'Girls Team', style: 'pink' }],
    rows: [
      {
        user: { id: 'team-1', name: 'Team 1', markers: ['girls'] },
        score: { value: 1, time: [79, 'min'] },
        statuses: [{ result: 'AC', time: [79, 'min'], tries: 1 }],
        rankValues: [rankValue],
      },
    ],
  };
  const srkRanklist: srk.Ranklist = staticRanklist;

  assert.deepEqual(solution, ['team-1', 0, 'AC', [79, 'min']]);
  assert.deepEqual(themeColor, {
    light: '#111111',
    dark: undefined,
  });
  assert.equal(srkRanklist.rows[0].user.id, 'team-1');
  assert.deepEqual(srkRanklist.rows[0].user.markers, ['girls']);
});
