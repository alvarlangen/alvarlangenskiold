import type { City, Clue, Country } from './types';

/** Count letters only (spaces, hyphens and apostrophes are not letters). */
export function letterCount(name: string): number {
  return (name.match(/\p{L}/gu) ?? []).length;
}

export function wordCount(name: string): number {
  return name.split(/[\s-]+/).filter((w) => /\p{L}/u.test(w)).length;
}

/** "S · 6 letters" (adds "· 2 words" for multi-word names). */
export function lettersClue(name: string): string {
  const first = (name.match(/\p{L}/u)?.[0] ?? '?').toUpperCase();
  const words = wordCount(name);
  return `${first} · ${letterCount(name)} letters${words > 1 ? ` · ${words} words` : ''}`;
}

export const languageCurrencyText = (c: Country) => `${c.languages.join(', ')} · ${c.currency}`;

export function neighborsText(c: Country): string {
  if (c.island) return `Nearest across the sea: ${c.nearest.join(', ')}`;
  return c.neighborNames.join(', ');
}

const flagText = (c: Country) => c.flag.map((f) => f.name).join(', ');

/** The six clues for a city, in order. */
export function cityClues(city: City, country: Country): Clue[] {
  return [
    { kind: 'continent', label: 'Continent', text: country.continentLabel },
    { kind: 'languageCurrency', label: 'Country’s language · Currency', text: languageCurrencyText(country) },
    { kind: 'flagColors', label: 'Country’s flag colors', text: flagText(country), swatches: country.flag },
    { kind: 'cityLetters', label: 'City name', text: lettersClue(city.name) },
    { kind: 'countryLetters', label: 'Country name', text: lettersClue(country.name) },
    {
      kind: 'neighbors',
      label: country.island ? 'Country’s nearest neighbors across the sea' : 'Country’s neighbors',
      text: neighborsText(country),
    },
  ];
}
