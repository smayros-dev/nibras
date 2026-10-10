import type { Config } from 'tailwindcss';

/**
 * Shared Tailwind 4 preset (load from CSS with `@config` or from a JS config's `presets`).
 * Fonts cover Arabic (RTL) and Latin scripts; colour tokens are the platform's design tokens.
 */
const preset = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['IBM Plex Sans Arabic', 'IBM Plex Sans', 'system-ui'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bdd3ff',
          300: '#90b6ff',
          400: '#5c8efd',
          500: '#3767f9',
          600: '#2148ee',
          700: '#1935db',
          800: '#1b2eb1',
          900: '#1c2d8b',
          950: '#161d54',
        },
        accent: {
          50: '#fff8eb',
          100: '#feeac7',
          200: '#fdd38a',
          300: '#fcb74d',
          400: '#fb9d24',
          500: '#f57a0b',
          600: '#d95706',
          700: '#b43a09',
          800: '#922c0e',
          900: '#78260f',
          950: '#451103',
        },
        success: '#15803d',
        warning: '#b45309',
        danger: '#b91c1c',
        info: '#0369a1',
      },
    },
  },
} satisfies Partial<Config>;

export default preset;
