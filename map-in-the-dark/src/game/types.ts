export type RoundKind = 'daily' | 'bonus' | 'practice';

export interface FlagColor {
  name: string;
  hex: string;
}

/** Country metadata, used for the city clues (language, currency, flag, neighbours). */
export interface Country {
  id: string; // ISO 3166-1 alpha-3 (Kosovo: UNK)
  iso2: string;
  name: string;
  altNames: string[];
  continents: string[];
  continentLabel: string;
  languages: string[];
  currency: string;
  borders: string[];
  neighborNames: string[];
  island: boolean;
  nearest: string[];
  capital: string;
  latlng: [number, number];
  area: number;
  rank: number;
  flag: FlagColor[];
  flagFile: string;
}

export interface City {
  id: string;
  name: string;
  altNames: string[];
  country: string; // Country id
  lonlat: [number, number];
  capital: boolean;
  fact: string | null;
  rank: number;
}

/** Anything that can be a target: shared by the selection and matching code. */
export interface Target {
  id: string;
  name: string;
  altNames: string[];
  rank: number;
  /** Shown next to the name when several targets share a name (e.g. "Spain" for Valencia). */
  qualifier?: string;
  continent: string;
}

export type ClueKind = 'continent' | 'languageCurrency' | 'flagColors' | 'cityLetters' | 'countryLetters' | 'neighbors';

export interface Clue {
  kind: ClueKind;
  /** Short label, e.g. "Continent". */
  label: string;
  /** The clue itself as plain text (also used for screen readers). */
  text: string;
  /** Flag colour swatches (flag clue only). */
  swatches?: FlagColor[];
}

export interface QuestionResult {
  id: string;
  /** Step of the correct guess (1–6), or null if lost. */
  solvedAt: number | null;
  points: number;
  xp: number;
  golden: boolean;
  multiplier: number;
  guesses: string[];
}

export interface RoundState {
  kind: RoundKind;
  /** Date key for daily rounds, seed for others. */
  seed: string;
  dateKey: string;
  continent?: string;
  targets: string[];
  golden: number;
  index: number;
  step: number;
  /** True while the current question's answer is shown. */
  revealed: boolean;
  results: QuestionResult[];
  guesses: string[];
  /** Combo streak carried in from previous rounds. */
  streak: number;
  finished: boolean;
}
