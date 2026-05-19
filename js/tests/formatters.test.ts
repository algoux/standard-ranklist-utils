import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import { alphabetToNumber, formatTimeDuration, numberToAlphabet, preZeroFill, secToTimeStr } from '../src/formatters';

describe('formatters', () => {
  test('formatTimeDuration converts between srk time units and applies formatter to target units', () => {
    assert.equal(formatTimeDuration([1.5, 'h'], 'min'), 90);
    assert.equal(formatTimeDuration([61, 's'], 'min', Math.ceil), 2);
    assert.equal(
      formatTimeDuration([2, 's'], 'ms', () => 0),
      2000,
    );
  });

  test('formatTimeDuration rejects invalid units', () => {
    assert.throws(() => formatTimeDuration([1, 'week' as srk.TimeUnit]));
    assert.throws(() => formatTimeDuration([1, 's'], 'week' as srk.TimeUnit));
  });

  test('formatTimeDuration rejects invalid srk duration values', () => {
    assert.throws(() => formatTimeDuration([-1, 's']));
    assert.throws(() => formatTimeDuration([Number.POSITIVE_INFINITY, 's']));
    assert.throws(() => formatTimeDuration([Number.NaN, 's']));
  });

  test('preZeroFill pads short numbers and keeps long numbers unchanged', () => {
    assert.equal(preZeroFill(7, 3), '007');
    assert.equal(preZeroFill(1234, 3), '1234');
  });

  test('secToTimeStr formats contest elapsed seconds', () => {
    assert.equal(secToTimeStr(3661, { fillHour: true }), '01:01:01');
    assert.equal(secToTimeStr(90061, { showDay: true }), '1D 1:01:01');
    assert.equal(secToTimeStr(-1), '--');
    assert.equal(secToTimeStr(-86400, { showDay: true }), '--');
  });

  test('numberToAlphabet and alphabetToNumber convert zero-based problem indexes', () => {
    assert.equal(numberToAlphabet(0), 'A');
    assert.equal(numberToAlphabet(25), 'Z');
    assert.equal(numberToAlphabet(26), 'AA');
    assert.equal(numberToAlphabet('28'), 'AC');
    assert.equal(numberToAlphabet(701), 'ZZ');
    assert.equal(numberToAlphabet(702), 'AAA');
    assert.equal(alphabetToNumber('A'), 0);
    assert.equal(alphabetToNumber('AA'), 26);
    assert.equal(alphabetToNumber('ac'), 28);
    assert.equal(alphabetToNumber(''), -1);
  });
});
