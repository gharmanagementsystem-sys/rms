/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  /**
   * Required for the theme toggle to do anything.
   *
   * global.css swaps the token values under a `.dark:root` selector, which only
   * ever matches in class mode. Without this key Tailwind defaults to `media`,
   * so the CSS variables stayed on their light values no matter what the user
   * chose — the tab bar still changed because it reads resolved colours from
   * ThemeProvider as plain JS, while every `bg-*` / `text-*` class did not.
   * That is exactly the "only the navbar goes dark" symptom.
   */
  darkMode: 'class',
  theme: {
    extend: {
      // Semantic design tokens (CLAUDE.md §26). Components must consume these
      // names — never a raw hex value, and never a `dark:` variant per colour.
      // Each maps to a CSS variable defined in global.css, so light/dark is a
      // single token swap rather than two parallel style trees.
      colors: {
        background: 'rgb(var(--color-background) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        surfaceElevated: 'rgb(var(--color-surface-elevated) / <alpha-value>)',
        textPrimary: 'rgb(var(--color-text-primary) / <alpha-value>)',
        textSecondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
