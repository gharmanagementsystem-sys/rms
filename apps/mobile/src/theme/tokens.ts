/**
 * Design tokens. CLAUDE.md §25, §26, §43.
 *
 * Components consume these names, never raw values. Colours live as CSS
 * variables in global.css so light and dark are a single token swap rather than
 * two parallel style trees; this file carries everything that is not a colour.
 */

/**
 * Spacing, on a 4pt grid.
 *
 * Generous by default (§25) — cramped financial screens read as untrustworthy.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
} as const;

/**
 * Three elevation levels, no more.
 *
 * iOS and Android express depth differently: `shadow*` props are ignored on
 * Android and `elevation` is ignored on iOS. Both are supplied so a card does
 * not silently render flat on one platform.
 */
export const elevation = {
  none: { shadowOpacity: 0, elevation: 0 },
  low: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
} as const;

export type TypeScale = 'display' | 'h1' | 'h2' | 'body' | 'bodySm' | 'caption';

/**
 * Type scale, with a SEPARATE line height per script.
 *
 * This is not a nicety. Devanagari carries matras above and conjuncts below the
 * baseline, and at Latin leading they clip — the Nepali build looks broken
 * rather than merely tight. Every text style therefore resolves its line height
 * from the active locale (§27).
 */
export const typography: Record<
  TypeScale,
  {
    fontSize: number;
    lineHeightLatin: number;
    lineHeightDevanagari: number;
    fontWeight: '400' | '500' | '600';
  }
> = {
  display: { fontSize: 32, lineHeightLatin: 38, lineHeightDevanagari: 46, fontWeight: '600' },
  h1: { fontSize: 24, lineHeightLatin: 30, lineHeightDevanagari: 36, fontWeight: '600' },
  h2: { fontSize: 20, lineHeightLatin: 26, lineHeightDevanagari: 31, fontWeight: '600' },
  body: { fontSize: 16, lineHeightLatin: 22, lineHeightDevanagari: 27, fontWeight: '400' },
  bodySm: { fontSize: 14, lineHeightLatin: 20, lineHeightDevanagari: 24, fontWeight: '400' },
  caption: { fontSize: 12, lineHeightLatin: 16, lineHeightDevanagari: 20, fontWeight: '400' },
};

/** Minimum tappable size. Below this, targets are unreliable for many users (§43). */
export const MIN_TOUCH_TARGET = 44;

/**
 * Motion. Short and purposeful (§25, §44).
 *
 * Nothing here exceeds 250ms: a user must never wait on an animation to
 * complete a normal action.
 */
export const motion = {
  fast: 150,
  normal: 200,
  slow: 250,
} as const;
