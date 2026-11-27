// Fifth healing layer (proposal-only): when JSON-LD, microdata, OpenGraph and the price-class
// candidates all come up empty, Mozilla Readability extracts the page's main text and we mine
// it for price-like lines. It only ever PROPOSES candidates to the existing heal step —
// the deterministic gates (plausibleEgp + Zod) still decide what is sent.
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { parsePrice } from '../text.ts';

export interface ReadabilityProposal { title: string; candidates: { cls: string; text: string }[] }

const PRICE_LINE = /(?:EGP|ج\.?م|جنيه|LE)\s*[\d٠-٩][\d٠-٩,٬.٫]*|[\d٠-٩][\d٠-٩,٬.٫]*\s*(?:EGP|ج\.?م|جنيه|LE)/g;

export function readabilityProposal(html: string, url: string): ReadabilityProposal | null {
  try {
    const { document } = parseHTML(html);
    // linkedom documents lack a few DOM bits Readability touches; it degrades gracefully.
    const article = new Readability(document as never, { charThreshold: 100 }).parse();
    const text = (article?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const candidates: { cls: string; text: string }[] = [];
    for (const m of text.matchAll(PRICE_LINE)) {
      const t = m[0].trim();
      if (parsePrice(t) != null) candidates.push({ cls: 'readability', text: t });
      if (candidates.length >= 10) break;
    }
    return { title: (article?.title ?? '').trim(), candidates };
  } catch {
    return null; // proposal layer must never break a crawl
  }
}
