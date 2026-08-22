import { useTheme } from './ThemeProvider';

/**
 * Hex values for every semantic token, mirroring global.css exactly.
 * CLAUDE.md §26.
 *
 * global.css is still the source of truth for the RGB numbers behind every
 * `bg-*`/`text-*` Tailwind class. This file exists only because some APIs
 * cannot consume a className and need a literal colour instead — an SVG
 * fill/stroke, or a third-party icon's `color` prop — and a component reaching
 * for its own guess at "what dark mode's danger colour is" is exactly how an
 * icon ends up stuck on its light-mode colour after the user switches to dark.
 *
 * `muted` and `inverse` have no `bg-*`/`text-*` counterpart because nothing
 * needs them as a background or text colour today — only as an icon tint — so
 * they live here rather than as a new pair of CSS variables nothing else uses.
 */
export interface SemanticColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  textPrimary: string;
  textSecondary: string;
  /** Dimmer than `textSecondary` — for a disclosure chevron or other
   *  decoration that should recede behind actual content, never for text. */
  muted: string;
  border: string;
  primary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  /** White in both themes — an icon on a filled primary/danger surface. */
  inverse: string;
}

const LIGHT: SemanticColors = {
  background: '#FAF8F5',
  surface: '#FFFFFF',
  surfaceElevated: '#F5F2EE',
  textPrimary: '#1A1F1D',
  textSecondary: '#5C625F',
  muted: '#9AA0A6',
  border: '#E3DED7',
  primary: '#14524A',
  accent: '#B8863B',
  success: '#2F7D5D',
  warning: '#B7791F',
  danger: '#A93226',
  inverse: '#FFFFFF',
};

const DARK: SemanticColors = {
  background: '#121413',
  surface: '#1A1D1B',
  surfaceElevated: '#232724',
  textPrimary: '#F0EEE9',
  textSecondary: '#A8ADA9',
  muted: '#6E736F',
  border: '#2E332F',
  primary: '#3E8C7E',
  accent: '#D4A55C',
  success: '#4FA37D',
  warning: '#D9A441',
  danger: '#D9695C',
  inverse: '#FFFFFF',
};

/** The current theme's semantic colours, resolved to hex. */
export function useSemanticColors(): SemanticColors {
  const { resolved } = useTheme();
  return resolved === 'dark' ? DARK : LIGHT;
}
