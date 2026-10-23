/** Transient UI state: toasts and the level-up celebration. */
import { createStore } from './store';

export interface Toast {
  id: number;
  text: string;
  tone?: 'gold' | 'default';
}

export const toastStore = createStore<Toast[]>([]);
let nextId = 1;

export function toast(text: string, tone: Toast['tone'] = 'default', ms = 2600) {
  const id = nextId++;
  toastStore.set((t) => [...t.slice(-2), { id, text, tone }]);
  setTimeout(() => toastStore.set((t) => t.filter((x) => x.id !== id)), ms);
}

/** Level reached, or null when no celebration is showing. */
export const levelUpStore = createStore<number | null>(null);
