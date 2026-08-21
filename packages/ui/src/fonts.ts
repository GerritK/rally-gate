/**
 * Self-hosted (not Google Fonts CDN) — these apps run at rally stages on
 * closed/absent WiFi, so a font that only loads from a CDN falls back to
 * a proportional system font mid-event, and timing columns start jumping
 * width on every live update. @fontsource bundles the font files into the
 * app itself via Vite, same as any other asset.
 *
 * Barlow: derived from American highway/vehicle signage — reads as
 * motorsport without going full gaming-logo. Condensed for headings packs
 * long stage/driver names into table headers, which is the actual
 * bottleneck on a tablet results list; regular Barlow for body text keeps
 * the family consistent.
 */
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
