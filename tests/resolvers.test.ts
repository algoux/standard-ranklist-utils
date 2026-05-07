import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type * as srk from '@algoux/standard-ranklist';
import { EnumTheme } from '../src/enums';
import {
  resolveColor,
  resolveContributor,
  resolveStyle,
  resolveText,
  resolveThemeColor,
  resolveUserMarkers,
} from '../src/resolvers';

describe('resolvers', () => {
  test('resolveText handles undefined, plain strings, language matches, and fallback text', () => {
    assert.equal(resolveText(undefined), '');
    assert.equal(resolveText('plain'), 'plain');

    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { languages: ['zh-CN'] },
      });
      assert.equal(resolveText({ fallback: 'Fallback', 'en-US': 'English', 'zh-CN': '中文' }), '中文');

      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { languages: ['fr-FR'] },
      });
      assert.equal(resolveText({ fallback: 'Fallback', 'en-US': 'English' }), 'Fallback');
    } finally {
      if (previousNavigator) {
        Object.defineProperty(globalThis, 'navigator', previousNavigator);
      } else {
        delete (globalThis as { navigator?: Navigator }).navigator;
      }
    }
  });

  test('resolveText prefers the closest language match before fallback text', () => {
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { languages: ['zh-Hans-CN'] },
      });
      assert.equal(resolveText({ fallback: 'Fallback', 'zh-CN': '中文' }), '中文');
    } finally {
      if (previousNavigator) {
        Object.defineProperty(globalThis, 'navigator', previousNavigator);
      } else {
        delete (globalThis as { navigator?: Navigator }).navigator;
      }
    }
  });

  test('resolveContributor parses contributor metadata from package-style strings', () => {
    assert.equal(resolveContributor(undefined), null);
    assert.deepEqual(resolveContributor('Alice'), {
      name: 'Alice',
      email: undefined,
      url: undefined,
    });
    assert.deepEqual(resolveContributor('Bob <bob@example.com>'), {
      name: 'Bob',
      email: 'bob@example.com',
      url: undefined,
    });
    assert.deepEqual(resolveContributor('bLue <mail@example.com> (https://example.com/)'), {
      name: 'bLue',
      email: 'mail@example.com',
      url: 'https://example.com/',
    });
    assert.deepEqual(resolveContributor('John Smith (https://example.com/)'), {
      name: 'John Smith',
      email: undefined,
      url: 'https://example.com/',
    });
  });

  test('resolveColor and resolveThemeColor normalize srk color strings by theme', () => {
    assert.equal(resolveColor('#123456'), '#123456');
    assert.equal(resolveColor('' as srk.Color), undefined);
    assert.deepEqual(resolveThemeColor('#abcdef'), {
      [EnumTheme.light]: '#abcdef',
      [EnumTheme.dark]: '#abcdef',
    });
    assert.deepEqual(resolveThemeColor({ light: '#ffffff', dark: '#000000' }), {
      [EnumTheme.light]: '#ffffff',
      [EnumTheme.dark]: '#000000',
    });
  });

  test('resolveColor supports legacy RGBA tuple colors for old ranklist data', () => {
    assert.equal(resolveColor([1, 2, 3, 0.5] as unknown as srk.Color), 'rgba(1,2,3,0.5)');
  });

  test('resolveStyle resolves explicit styles and auto text color from background color', () => {
    assert.deepEqual(resolveStyle({ textColor: '#111111', backgroundColor: '#eeeeee' }), {
      textColor: {
        [EnumTheme.light]: '#111111',
        [EnumTheme.dark]: '#111111',
      },
      backgroundColor: {
        [EnumTheme.light]: '#eeeeee',
        [EnumTheme.dark]: '#eeeeee',
      },
    });
    assert.deepEqual(resolveStyle({ backgroundColor: { light: '#ffffff', dark: '#000000' } }), {
      textColor: {
        [EnumTheme.light]: '#000000',
        [EnumTheme.dark]: '#ffffff',
      },
      backgroundColor: {
        [EnumTheme.light]: '#ffffff',
        [EnumTheme.dark]: '#000000',
      },
    });
  });

  test('resolveUserMarkers prefers user.markers over deprecated user.marker and ignores unknown IDs', () => {
    const markers: srk.Marker[] = [
      { id: 'official', label: 'Official', style: 'blue' },
      { id: 'girls', label: 'Girls', style: 'pink' },
    ];
    assert.deepEqual(
      resolveUserMarkers({ id: 'u1', name: 'U1', marker: 'official', markers: ['girls', 'none'] }, markers),
      [markers[1]],
    );
    assert.deepEqual(resolveUserMarkers({ id: 'u2', name: 'U2', marker: 'official', markers: [] }, markers), []);
    assert.deepEqual(resolveUserMarkers({ id: 'u2', name: 'U2', marker: 'official' }, markers), [markers[0]]);
    assert.deepEqual(resolveUserMarkers({ id: 'u3', name: 'U3', markers: ['girls'] }, undefined), []);
    assert.deepEqual(resolveUserMarkers(undefined as unknown as srk.User, markers), []);
  });
});
