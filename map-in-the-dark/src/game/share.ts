import { GAME_TITLE } from './config';
import { resultSquare } from './scoring';
import type { Mode, QuestionResult, RoundKind } from './types';

const MODE_LABEL: Record<Mode, string> = { countries: 'Countries', cities: 'Cities' };

/** "Map in the Dark · Countries #1 🟩🟨🟩🟥🟩" */
export function shareLine(mode: Mode, kind: RoundKind, dayNo: number, results: QuestionResult[]): string {
  const squares = results.map((r) => resultSquare(r.solvedAt)).join('');
  const tag = kind === 'daily' ? `#${dayNo}` : kind === 'bonus' ? 'Bonus' : 'Practice';
  return `${GAME_TITLE} · ${MODE_LABEL[mode]} ${tag} ${squares}`;
}

export function shareText(line: string, score: number, url: string): string {
  return `${line}\n${score}/500 points\n${url}`;
}

export const modeLabel = (m: Mode) => MODE_LABEL[m];
