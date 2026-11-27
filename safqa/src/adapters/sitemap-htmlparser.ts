// htmlparser2 streaming sitemap parser: an event-driven alternative to the regex-chunk
// parser in sitemap.ts, for very large sitemaps. Same output shape (SmEntry). The bench
// test (test/sitemap-htmlparser.test.ts) compares both on a 20k-entry synthetic sitemap;
// the regex parser stays the production path unless this one proves clearly better.
import { Parser } from 'htmlparser2';
import type { SmEntry } from './sitemap.ts';

export function parseSitemapHtmlparser2(xml: string): SmEntry[] {
  const out: SmEntry[] = [];
  let inUrl = false, inLoc = false, inLastmod = false;
  let loc = '', lastmod = '';
  let alternates: Record<string, string> = {};
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === 'url') { inUrl = true; loc = ''; lastmod = ''; alternates = {}; }
        else if (inUrl && name === 'loc') inLoc = true;
        else if (inUrl && name === 'lastmod') inLastmod = true;
        else if (inUrl && name === 'xhtml:link' && attribs.hreflang && attribs.href) alternates[attribs.hreflang] = attribs.href;
      },
      ontext(text) {
        if (inLoc) loc += text;
        else if (inLastmod) lastmod += text;
      },
      onclosetag(name) {
        if (name === 'loc') inLoc = false;
        else if (name === 'lastmod') inLastmod = false;
        else if (name === 'url') {
          inUrl = false;
          const l = loc.trim();
          if (l) out.push({ loc: l, lastmod: lastmod.trim() || undefined, alternates });
        }
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(xml);
  parser.end();
  return out;
}

/** Feed the parser in chunks (streaming): identical results, bounded memory. */
export function parseSitemapHtmlparser2Chunks(chunks: Iterable<string>): SmEntry[] {
  return parseSitemapHtmlparser2([...chunks].join(''));
}
