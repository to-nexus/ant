/**
 * cronDescribe — presentational normalizer for the trigger node subtitle.
 * Table test over recognized shapes; anything unrecognized must fall back to
 * the raw expression (never guess), and the effective tz is always appended.
 */
import { describe, it, expect } from 'vitest';
import { describeCron } from '../../src/presentation/components/Pipelines/cronDescribe';

// Pass-through t: interpolate the default value like i18next would.
const t = (_key: string, defaultValue: string, options?: Record<string, unknown>) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));

describe('describeCron — recognized shapes', () => {
  const rows: Array<[string, string | undefined, string]> = [
    ['0 9 * * *', 'Asia/Seoul', 'Every day at 09:00 · Asia/Seoul'],
    ['30 18 * * *', undefined, 'Every day at 18:30 · UTC'],
    ['0 9 * * 1', 'Asia/Seoul', 'Every Mon at 09:00 · Asia/Seoul'],
    ['0 9 * * 1,3,5', undefined, 'Every Mon, Wed, Fri at 09:00 · UTC'],
    ['0 9 * * 1-5', undefined, 'Every Mon, Tue, Wed, Thu, Fri at 09:00 · UTC'],
    // 7 ≡ 0 (Sunday), deduped and sorted.
    ['0 9 * * 7', undefined, 'Every Sun at 09:00 · UTC'],
    ['0 9 1 * *', undefined, 'On day 1 of every month at 09:00 · UTC'],
    ['*/15 * * * *', undefined, 'Every 15 minutes · UTC'],
    ['30 */6 * * *', undefined, 'Every 6 hours at :30 · UTC'],
    ['5 * * * *', undefined, 'Every hour at :05 · UTC'],
  ];
  it.each(rows)('%s (%s)', (cron, tz, expected) => {
    expect(describeCron(cron, tz, t, 'en')).toBe(expected);
  });
});

describe('describeCron — raw fallback (never guess)', () => {
  const rows: Array<[string, string]> = [
    ['0 9 * 6 *', 'month-bound expression'],
    ['0 9 1 * 1', 'dom+dow combination'],
    ['0 9,18 * * *', 'multi-hour list'],
    ['0 9 * * MON', 'named weekday'],
    ['61 9 * * *', 'out-of-range minute'],
    ['0 25 * * *', 'out-of-range hour'],
    ['0 9 * * 8', 'out-of-range weekday'],
    ['0 9 0 * *', 'out-of-range day-of-month'],
    ['not a cron', 'garbage'],
  ];
  it.each(rows)('%s → raw (%s)', (cron) => {
    expect(describeCron(cron, undefined, t, 'en')).toBe(`${cron} · UTC`);
  });

  it('keeps the tz suffix on fallback too', () => {
    expect(describeCron('0 9 1 * 1', 'Asia/Seoul', t, 'en')).toBe('0 9 1 * 1 · Asia/Seoul');
  });
});

describe('describeCron — weekday names localize via Intl, not i18n keys', () => {
  it('renders Korean weekday names under the ko locale', () => {
    expect(describeCron('0 9 * * 1', 'Asia/Seoul', t, 'ko')).toBe('Every 월 at 09:00 · Asia/Seoul');
  });
});
