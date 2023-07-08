import type * as srk from '@algoux/standard-ranklist';
import { EnumTheme } from './enums';

export interface RankValue {
  /** Rank value initially. If the user is unofficial and rank value equals null, it will be rendered as unofficial mark such as '*'. */
  rank: number | null;

  /**
   * Series segment index which this rank belongs to initially. `null` means this rank does not belong to any segment. `undefined` means it will be calculated automatically (only if the segment's count property exists).
   * @defaultValue null
   */
  segmentIndex?: number | null;
}

export type StaticRanklist = Omit<srk.Ranklist, 'rows'> & {
  rows: Array<srk.RanklistRow & { rankValues: RankValue[] }>;
};

export type CalculatedSolutionTetrad = [
  /** user id */ string,
  /** problem index */ number,
  /** result */ Exclude<srk.SolutionResultFull, null> | srk.SolutionResultCustom,
  /** solution submitted time */ srk.TimeDuration,
];

export interface ThemeColor {
  [EnumTheme.light]: string | undefined;
  [EnumTheme.dark]: string | undefined;
}
