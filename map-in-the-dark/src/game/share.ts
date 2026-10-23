import { GAME_TITLE } from './config';
import { resultSquare } from './scoring';
import type { QuestionResult, RoundKind } from './types';

/** "Map in the Dark #1 🟩🟨🟩🟥🟩" */
export function shareLine(kind: RoundKind, dayNo: number, results: QuestionResult[]): string {
  const squares = results.map((r) => resultSquare(r.solvedAt)).join('');
  const tag = kind === 'daily' ? `#${dayNo}` : kind === 'bonus' ? 'Bonus' : 'Practice';
  return `${GAME_TITLE} ${tag} ${squares}`;
}

export function shareText(line: string, score: number, url: string): string {
  return `${line}\n${score}/500 points\n${url}`;
}
