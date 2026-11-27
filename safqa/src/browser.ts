// Browser-grade fallback for public pages whose prices only exist after JS rendering.
// Playwright-core (the foreign-expert standard for browser automation) driving the system Chrome —
// no browser download, same honest SafqaBot User-Agent, same per-host delay as politeFetch.
// It renders the page the store serves to any visitor; it never solves captchas or challenges —
// a challenge page is returned as-is and the caller stops the store, exactly like plain fetch.
// If Playwright/Chrome is unavailable, falls back to Chrome headless --dump-dom, then to null.
import { execFile } from 'node:child_process';
import { chromium, type Browser } from 'playwright-core';
import { UA } from './config.ts';
import { awaitTurn } from './http.ts';

const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
let browserP: Promise<Browser | null> | null = null;
function getBrowser(): Promise<Browser | null> {
  browserP ??= chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch(() => null);
  return browserP;
}

async function viaPlaywright(url: string): Promise<string | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  const page = await browser.newPage({ userAgent: UA });
  try {
    // E-commerce pages rarely reach networkidle (trackers/ads); domcontentloaded + a short settle is reliable.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(3_000);
    return await page.content();
  } catch { return null; } finally { await page.close().catch(() => undefined); }
}

function viaDumpDom(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--user-agent=${UA}`, '--virtual-time-budget=15000', '--dump-dom', url],
      { timeout: 45_000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => resolve(err || !stdout ? null : stdout));
  });
}

export async function browserFetch(url: string): Promise<string | null> {
  await awaitTurn(new URL(url).host);
  return (await viaPlaywright(url)) ?? viaDumpDom(url);
}

/** Close the shared browser so the process can exit (an open Chromium keeps the event loop alive). */
export async function closeBrowser(): Promise<void> {
  const b = browserP ? await browserP.catch(() => null) : null;
  browserP = null;
  await b?.close().catch(() => undefined);
}
