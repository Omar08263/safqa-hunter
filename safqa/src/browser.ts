// Browser-grade fallback for public pages whose prices only exist after JS rendering.
// Uses the system Chrome in headless --dump-dom mode (no extra dependencies), with the same
// honest SafqaBot User-Agent and the same per-host delay as politeFetch. It renders the page
// the store serves to any visitor; it never solves captchas or challenges — a challenge page
// is returned as-is and the caller stops the store, exactly like the plain-fetch path.
import { execFile } from 'node:child_process';
import { UA } from './config.ts';
import { awaitTurn } from './http.ts';

const CHROME = process.env.CHROME_PATH ?? 'google-chrome';
export async function browserFetch(url: string): Promise<string | null> {
  await awaitTurn(new URL(url).host);
  return new Promise((resolve) => {
    execFile(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', `--user-agent=${UA}`, '--virtual-time-budget=15000', '--dump-dom', url],
      { timeout: 45_000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => resolve(err || !stdout ? null : stdout));
  });
}
