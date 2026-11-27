// Structured JSON logging (pino): one JSON object per line, per run and per store,
// so hunt.log is machine-parseable by the analytics step. Level via SAFQA_LOG_LEVEL.
import pino from 'pino';

export const log = pino({
  level: process.env.SAFQA_LOG_LEVEL ?? 'info',
  base: { app: 'safqa-hunter' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
});

/** Child logger carrying the store id on every line. */
export const storeLog = (store: string) => log.child({ store });
