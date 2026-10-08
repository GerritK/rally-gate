import { createI18n, type I18n } from 'vue-i18n';
import { de as vuetifyDe, en as vuetifyEn } from 'vuetify/locale';
import uiDe from './locales/de.json';
import uiEn from './locales/en.json';

/** Each in its own language, as a language picker shows them. */
export const LOCALES = { en: 'English', de: 'Deutsch' } as const;
export type Locale = keyof typeof LOCALES;

const ui: Record<Locale, typeof uiEn> = { en: uiEn, de: uiDe };

const STORAGE_KEY = 'rally-gate.locale';

const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && value in LOCALES;

/** The viewer's own pick, else the first browser language we have, else English. */
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage blocked: fall through to the browser language.
  }
  return (
    navigator.languages.map((tag) => tag.slice(0, 2)).find(isLocale) ?? 'en'
  );
}

/** Per browser, not per event: two marshals at one event may read different languages. */
export function rememberLocale(locale: Locale) {
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Not remembered then; the switch still applies to this tab.
  }
}

/**
 * One i18n instance per app: the app's messages on top of the ui's own, and
 * Vuetify's under `$vuetify` so one locale switch reaches its components too.
 * `de` must carry every key of `en`; vue-tsc fails the build otherwise.
 */
export function createRallyI18n<M extends object>(
  en: M,
  de: NoInfer<M>,
): RallyI18n {
  const locale = initialLocale();
  document.documentElement.lang = locale;
  active = createI18n<false>({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: {
      en: { ...ui.en, ...en, $vuetify: vuetifyEn },
      de: { ...ui.de, ...de, $vuetify: vuetifyDe },
    },
  });
  return active;
}

/** The shape Vuetify's vue-i18n adapter takes. */
export type RallyI18n = I18n<any, {}, {}, string, false>;

let active: RallyI18n | undefined;

/**
 * Translate outside a component (format helpers, PDFs, field rules). Reads
 * the current locale, so called during render it updates on a switch. Never
 * call it at module load: a constant built then stays in the first language.
 */
export function t(
  key: string,
  named: Record<string, unknown> = {},
  plural?: number,
): string {
  if (!active) throw new Error('createRallyI18n() has not run');
  return plural === undefined
    ? active.global.t(key, named)
    : active.global.t(key, named, plural);
}

/** The current locale, for `Intl`/`toLocale*String`. */
export const currentLocale = (): Locale =>
  (active?.global.locale.value as Locale | undefined) ?? 'en';
