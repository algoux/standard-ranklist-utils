import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_REGEN_SUPPORTED_VERSION } from '../src/constants';

test('MIN_REGEN_SUPPORTED_VERSION is the first srk version supported by regeneration helpers', () => {
  assert.equal(MIN_REGEN_SUPPORTED_VERSION, '0.3.0');
});
