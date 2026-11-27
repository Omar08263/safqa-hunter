// Text utilities: Arabic-Indic digit conversion (via Intl's own digit set, so it stays correct
// for both ٠١٢٣ and ۰۱۲۳), price parsing on top of it, and HTML description cleaning with turndown.
import TurndownService from 'turndown';

const ARABIC_DIGITS = new Intl.NumberFormat('ar-EG-u-nu-arab', { useGrouping: false }).format(1234567890); // '١٢٣٤٥٦٧٨٩٠'
const EXT_ARABIC_DIGITS = new Intl.NumberFormat('fa-IR-u-nu-arabext', { useGrouping: false }).format(1234567890); // '۱۲۳۴۵۶۷۸۹۰'
const DIGIT_MAP = new Map<string, string>();
[...ARABIC_DIGITS].forEach((d, i) => DIGIT_MAP.set(d, String((i + 1) % 10)));
[...EXT_ARABIC_DIGITS].forEach((d, i) => DIGIT_MAP.set(d, String((i + 1) % 10)));

/** Convert Arabic-Indic digits (٠-٩ / ۰-۹) to Latin digits; everything else passes through. */
export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP.get(d) ?? d);
}

/** Parse a price from free text: Arabic digits, thousands separators (`,` `٬`), decimal `٫`. */
export function parsePrice(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const cleaned = toLatinDigits(String(v)).replace(/٬/g, ',').replace(/٫/g, '.').replace(/[^\d.,]/g, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'iframe', 'noscript']);

/** Clean a store's HTML description to plain markdown-ish text (no scripts, no tracking markup). */
export function cleanDescription(html: string | null | undefined, maxLen = 4000): string | null {
  if (!html?.trim()) return null;
  const text = turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
  return text ? text.slice(0, maxLen) : null;
}
