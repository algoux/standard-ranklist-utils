import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnumTheme } from '../src/enums';

test('EnumTheme exposes the supported theme keys', () => {
  assert.deepEqual(EnumTheme, {
    light: 'light',
    dark: 'dark',
  });
});
