import type * as srk from '@algoux/standard-ranklist';
// @ts-ignore
import TEXTColor from 'textcolor';
import { lookup as langLookup } from 'bcp-47-match';
import { EnumTheme } from './enums';
import { ThemeColor } from './types';

export function resolveText(text: srk.Text | undefined): string {
  if (text === undefined) {
    return '';
  }
  if (typeof text === 'string') {
    return text;
  } else {
    const langs = Object.keys(text)
      .filter((k) => k && k !== 'fallback')
      .sort()
      .reverse();
    const userLangs = (typeof navigator !== 'undefined' && [...navigator.languages]) || [];
    const usingLang = langLookup(userLangs, langs) || 'fallback';
    return text[usingLang] ?? '';
  }
}

/**
 * Parse contributor string to an object which contains name, email (optional) and url (optional).
 * @param contributor
 * @returns parsed contributor object
 * @example
 * 'name <mail@example.com> (http://example.com)' -> { name: 'name', email: 'mail@example.com', url: 'http://example.com' }
 * 'name' -> { name: 'name' }
 * 'name <mail@example.com>' -> { name: 'name', email: 'mail@example.com' }
 * 'name (http://example.com)' -> { name: 'name', url: 'http://example.com' }
 * 'John Smith (http://example.com)' -> { name: 'John Smith', url: 'http://example.com' }
 */
export function resolveContributor(
  contributor: srk.Contributor | undefined,
): { name: string; email?: string; url?: string } | null {
  if (!contributor) {
    return null;
  }

  let name = '';
  let email: string | undefined;
  let url: string | undefined;
  const words = contributor.split(' ').map((s) => s.trim());
  let index = words.length - 1;
  while (index > 0) {
    const word = words[index];
    if (word.startsWith('<') && word.endsWith('>')) {
      email = word.slice(1, -1);
      index--;
      continue;
    }
    if (word.startsWith('(') && word.endsWith(')')) {
      url = word.slice(1, -1);
      index--;
      continue;
    }
    break;
  }
  name = words.slice(0, index + 1).join(' ');
  return { name, email, url };
}

export function resolveColor(color: srk.Color) {
  if (Array.isArray(color)) {
    return `rgba(${color[0]},${color[1]},${color[2]},${color[3]})`;
  } else if (color) {
    return color;
  }
  return undefined;
}

export function resolveThemeColor(themeColor: srk.ThemeColor): ThemeColor {
  let light = resolveColor(typeof themeColor === 'string' ? themeColor : themeColor.light);
  let dark = resolveColor(typeof themeColor === 'string' ? themeColor : themeColor.dark);
  return {
    [EnumTheme.light]: light,
    [EnumTheme.dark]: dark,
  };
}

export function resolveStyle(style: srk.Style) {
  const { textColor, backgroundColor } = style;
  let usingTextColor: typeof textColor = textColor;
  // 未指定前景色时，尝试自动适配
  if (backgroundColor && !textColor) {
    if (typeof backgroundColor === 'string') {
      usingTextColor = TEXTColor.findTextColor(backgroundColor);
    } else {
      const { light, dark } = backgroundColor;
      usingTextColor = {
        light: light && TEXTColor.findTextColor(light),
        dark: dark && TEXTColor.findTextColor(dark),
      };
    }
  }
  const textThemeColor = resolveThemeColor(usingTextColor || '');
  const backgroundThemeColor = resolveThemeColor(backgroundColor || '');
  return {
    textColor: textThemeColor,
    backgroundColor: backgroundThemeColor,
  };
}

export function resolveUserMarkers(user: srk.User, markersConfig: srk.Marker[] | undefined): srk.Marker[] {
  if (!user) {
    return [];
  }
  const userMarkers = (Array.isArray(user.markers) ? user.markers : [user.marker])
    .filter(Boolean)
    .map((marker) => (markersConfig || []).find((m) => m.id === marker))
    .filter(Boolean) as srk.Marker[];
  return userMarkers;
}
