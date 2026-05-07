import type * as srk from '@algoux/standard-ranklist';

/**
 * Convert an srk time duration to the requested unit.
 *
 * @param time - Source duration tuple, such as `[90, 's']`.
 * @param targetUnit - Unit to convert the duration to.
 * @param fmt - Optional formatter used for converted non-millisecond values, commonly `Math.floor`, `Math.ceil`, or `Math.round`.
 * @returns Converted duration value.
 * @throws If the source value is negative/non-finite, or the source/target time unit is unsupported.
 */
export function formatTimeDuration(
  time: srk.TimeDuration,
  targetUnit: srk.TimeUnit = 'ms',
  fmt: (num: number) => number = (num) => num,
) {
  if (!Number.isFinite(time[0]) || time[0] < 0) {
    throw new Error(`Invalid source time value ${time[0]}`);
  }
  let ms = -1;
  switch (time[1]) {
    case 'ms':
      ms = time[0];
      break;
    case 's':
      ms = time[0] * 1000;
      break;
    case 'min':
      ms = time[0] * 1000 * 60;
      break;
    case 'h':
      ms = time[0] * 1000 * 60 * 60;
      break;
    case 'd':
      ms = time[0] * 1000 * 60 * 60 * 24;
      break;
    default:
      throw new Error(`Invalid source time unit ${time[1]}`);
  }
  switch (targetUnit) {
    case 'ms':
      return ms;
    case 's':
      return fmt(ms / 1000);
    case 'min':
      return fmt(ms / 1000 / 60);
    case 'h':
      return fmt(ms / 1000 / 60 / 60);
    case 'd':
      return fmt(ms / 1000 / 60 / 60 / 24);
    default:
      throw new Error(`Invalid target time unit ${targetUnit}`);
  }
}

/**
 * Left-pad a number with zeroes until it reaches the requested display width.
 *
 * @param num - Number to format.
 * @param size - Minimum string width.
 * @returns Zero-filled number string, or the original number string when it is already long enough.
 */
export function preZeroFill(num: number, size: number): string {
  if (num >= Math.pow(10, size)) {
    return num.toString();
  } else {
    let str = Array(size + 1).join('0') + num;
    return str.slice(str.length - size);
  }
}

/**
 * Format elapsed seconds as a ranklist time string.
 *
 * @param second - Elapsed seconds.
 * @param options - Formatting options.
 * @param options.fillHour - Pad the hour field to two digits.
 * @param options.showDay - Show a leading day count when the duration is at least one day.
 * @returns Time string in `H:mm:ss`/`HH:mm:ss` form, optionally prefixed with `nD `; returns `--` for negative input.
 */
export function secToTimeStr(second: number, options: { fillHour?: boolean; showDay?: boolean } = {}): string {
  if (second < 0) {
    return '--';
  }
  let sec = second;
  let d = 0;
  const { fillHour = false, showDay = false } = options;
  if (showDay) {
    d = Math.floor(sec / 86400);
    sec %= 86400;
  }
  let h = Math.floor(sec / 3600);
  sec %= 3600;
  let m = Math.floor(sec / 60);
  sec %= 60;
  let s = Math.floor(sec);
  let dayStr = '';
  if (showDay && d >= 1) {
    dayStr = d + 'D ';
  }
  return dayStr + (fillHour ? preZeroFill(h, 2) : `${h}`) + ':' + preZeroFill(m, 2) + ':' + preZeroFill(s, 2);
}

/**
 * Convert a zero-based numeric problem index to an alphabetic problem alias.
 *
 * @param number - Numeric index, or a numeric string.
 * @returns Alphabetic alias such as `A`, `Z`, `AA`, or `AC`.
 * @example
 * numberToAlphabet(0) // 'A'
 * numberToAlphabet(25) // 'Z'
 * numberToAlphabet(26) // 'AA'
 * numberToAlphabet(28) // 'AC'
 */
export function numberToAlphabet(number: number | string): string {
  let n = ~~number;
  const radix = 26;
  let cnt = 1;
  let p = radix;
  while (n >= p) {
    n -= p;
    cnt++;
    p *= radix;
  }
  let res = [];
  for (; cnt > 0; cnt--) {
    res.push(String.fromCharCode((n % radix) + 65));
    n = Math.trunc(n / radix);
  }
  return res.reverse().join('');
}

/**
 * Convert an alphabetic problem alias to a zero-based numeric index.
 *
 * @param alphabet - Alphabetic alias.
 * @returns Zero-based index, or `-1` for empty/non-string input.
 * @example
 * alphabetToNumber('A') // 0
 * alphabetToNumber('Z') // 25
 * alphabetToNumber('AA') // 26
 * alphabetToNumber('AC') // 28
 */
export function alphabetToNumber(alphabet: string): number {
  if (typeof alphabet !== 'string' || !alphabet.length) {
    return -1;
  }
  const chars = `${alphabet}`.toUpperCase().split('').reverse();
  const radix = 26;
  let p = 1;
  let res = -1;
  chars.forEach((ch) => {
    res += (ch.charCodeAt(0) - 65) * p + p;
    p *= radix;
  });
  return res;
}
