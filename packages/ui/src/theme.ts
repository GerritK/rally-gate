import type { ThemeDefinition } from 'vuetify';

/**
 * Default theme for every rally-gate web interface. Dark-first: these UIs
 * run on a marshal's laptop/tablet at a rally stage, often in a tent or car
 * at night — not an office. Extends Vuetify's palette with rally-specific
 * semantic colors (timing-*, flag-*) so components can reference intent
 * ("timing-best") instead of a raw hex value.
 *
 * Usage notes (apply when building components against this theme):
 * - Keep `primary` (orange) rare — the one main action per screen (start a
 *   run, confirm a time) and active nav state. Everything else stays
 *   gray-on-gray, or orange loses its signal value.
 * - `error` is reserved for penalties/DNF/abort. Don't reuse it for generic
 *   delete buttons — it needs to stay a distinct, alarming signal.
 * - Color alone doesn't carry the best-time distinction for red-green color
 *   blindness (common) — pair `timing-best`/`timing-personal` with a second
 *   signal (icon, +/- prefix) wherever a time is highlighted.
 * - `background`/`surface` here are tuned for screens, not direct sunlight.
 *   A tablet at a stage in daylight needs a separate, higher-contrast
 *   variant (near-black bg, 100% white text, brighter borders) — not built
 *   yet, add as a second ThemeDefinition + theme switcher when it's needed.
 */
export const rallyGateDark: ThemeDefinition = {
  dark: true,
  colors: {
    // Base surfaces (asphalt)
    background: '#0B0D10',
    surface: '#14181E',
    'surface-bright': '#1E242C',
    'surface-light': '#1A1F26',
    'surface-variant': '#2A313B',
    'on-surface-variant': '#B9C2CE',

    // Brand
    primary: '#FF6B00', // rally orange, primary action
    'primary-darken-1': '#CC5500',
    secondary: '#00D3F2', // telemetry cyan
    'secondary-darken-1': '#00A3BC',
    accent: '#FF2D55', // sparing use: start/stop, abort

    // Status
    success: '#2ED573',
    warning: '#FFC300',
    error: '#FF3B30',
    info: '#38BDF8',

    // Timing semantics (motorsport convention)
    'timing-best': '#A855F7', // fastest time overall
    'timing-personal': '#2ED573', // personal best
    'timing-slower': '#FFC300', // slower than reference
    'timing-penalty': '#FF3B30', // penalty seconds / missed gate
    'timing-idle': '#6B7686', // no time / DNS

    // Track status (flags)
    'flag-green': '#00E05A',
    'flag-yellow': '#FFC300',
    'flag-red': '#FF3B30',
    'flag-blue': '#2979FF',

    // Text
    'on-background': '#E6EAF0',
    'on-surface': '#E6EAF0',
    'on-primary': '#1A0A00',
    'on-secondary': '#00232B',
    'on-success': '#062B14',
    'on-warning': '#2B1F00',
    'on-error': '#FFFFFF',
  },
  variables: {
    'border-color': '#2A313B',
    'border-opacity': 1,
    'high-emphasis-opacity': 1,
    'medium-emphasis-opacity': 0.72,
    'disabled-opacity': 0.38,
    'theme-on-code': '#E6EAF0',
    'theme-code': '#0B0D10',
    // Feeds Vuetify's own $body-font-family/$heading-font-family SASS
    // defaults (they read var(--v-font-body)/var(--v-font-heading)) — no
    // SASS override file needed, see fonts.ts for why these specific fonts.
    'font-body': "'Barlow', sans-serif",
    'font-heading': "'Barlow Condensed', sans-serif",
  },
};
