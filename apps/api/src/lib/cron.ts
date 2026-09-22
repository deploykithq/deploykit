import cronParser from "cron-parser";

/**
 * Cron validation and next-run calculation.
 *
 * This deliberately uses cron-parser 4.x — the version BullMQ itself resolves —
 * so a pattern accepted here is a pattern BullMQ will schedule. Validating with
 * a different parser would let the API accept expressions the scheduler then
 * silently drops.
 *
 * cron-parser 4.x is CommonJS and its named exports are not statically
 * detectable, so `import { parseExpression }` resolves under Vite/Vitest but
 * throws "Named export not found" under plain Node ESM — which is how this
 * package actually runs. Hence the default import.
 */
const { parseExpression } = cronParser;

/** Standard cron: minute hour day-of-month month day-of-week. */
const CRON_FIELD_COUNT = 5;

class InvalidCronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCronError";
  }
}

const assertValidCron = (pattern: string, timezone: string): void => {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== CRON_FIELD_COUNT) {
    throw new InvalidCronError(
      `A cron expression must have exactly ${CRON_FIELD_COUNT} fields ` +
        `(minute hour day month weekday); got ${fields.length}.`,
    );
  }

  // cron-parser reports an unknown zone as "CronDate: unhandled timestamp",
  // which the UI shows verbatim. Ask Intl first so the message is legible.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new InvalidCronError(`Unknown time zone: ${timezone}`);
  }

  try {
    // An unknown zone is not rejected when the expression is parsed — it only
    // surfaces when an occurrence is actually computed, so compute one.
    parseExpression(pattern, { tz: timezone }).next();
  } catch (err: any) {
    throw new InvalidCronError(
      `Invalid cron expression or time zone: ${err?.message ?? err}`,
    );
  }
};

/** Next occurrence of `pattern` in `timezone`, strictly after `from`. */
const nextRunAt = (
  pattern: string,
  timezone: string,
  from: Date = new Date(),
): Date => {
  assertValidCron(pattern, timezone);
  return parseExpression(pattern, { tz: timezone, currentDate: from })
    .next()
    .toDate();
};

/** The next `count` occurrences, for the "when will this run" UI preview. */
const nextRuns = (
  pattern: string,
  timezone: string,
  count: number,
  from: Date = new Date(),
): Date[] => {
  assertValidCron(pattern, timezone);
  const it = parseExpression(pattern, { tz: timezone, currentDate: from });
  return Array.from({ length: count }, () => it.next().toDate());
};

export { assertValidCron, nextRunAt, nextRuns, InvalidCronError };
