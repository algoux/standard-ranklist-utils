import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import { getCCPC26ProblemLayout, getCCPC26RowProblemOrder } from '../src';
import type { CCPC26ProblemLayout } from '../src';

const fixtures = JSON.parse(readFileSync(resolve(__dirname, '../../testdata/contract-fixtures.json'), 'utf8'))
  .ccpc26 as {
  layouts: Array<{ name: string; ranklist: srk.Ranklist; expected: CCPC26ProblemLayout | null }>;
  orders: Array<{ name: string; statuses: srk.RankProblemStatus[]; layout: CCPC26ProblemLayout; expected: number[] }>;
};

test('shared CCPC26 layouts match the JS behavior baseline without changing inputs', () => {
  for (const item of fixtures.layouts) {
    const before = JSON.stringify(item.ranklist);
    assert.deepEqual(getCCPC26ProblemLayout(item.ranklist) ?? null, item.expected, item.name);
    assert.equal(JSON.stringify(item.ranklist), before, item.name);
  }
});

test('shared CCPC26 row orders match the JS behavior baseline without changing inputs', () => {
  for (const item of fixtures.orders) {
    const before = JSON.stringify(item);
    assert.deepEqual(getCCPC26RowProblemOrder(item.statuses, item.layout), item.expected, item.name);
    assert.equal(JSON.stringify(item), before, item.name);
  }
});
