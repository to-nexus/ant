/**
 * Presentational cron describer — normalizes common 5-field expressions into
 * a human sentence for the trigger node / execution header. TEXT pattern
 * matching only: no cron library, no fire-time computation (doc 46 keeps that
 * server-side — `preview-fires` stays the authority; anything this module
 * does not recognize falls back to the raw expression). The effective
 * timezone is always appended so the silent-UTC default is visible.
 */

interface DescribeT {
  (key: string, defaultValue: string, options?: Record<string, unknown>): string;
}

const NUM = /^\d{1,2}$/;
const STEP = /^\*\/(\d{1,2})$/;

/** dow field (`1`, `1,3`, `1-5`, `7`≡`0`) → sorted unique 0..6, or null. */
function parseDowList(field: string): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const range = /^(\d{1,2})-(\d{1,2})$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from > 7 || to > 7 || from > to) return null;
      for (let d = from; d <= to; d += 1) out.add(d % 7);
    } else if (NUM.test(part)) {
      const d = Number(part);
      if (d > 7) return null;
      out.add(d % 7);
    } else {
      return null;
    }
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : null;
}

/** Locale weekday names for cron dow 0..6 (0 = Sunday). 2023-01-01 is a Sunday. */
function weekdayNames(locale: string, dows: number[]): string {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return dows.map((d) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d)))).join(', ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Recognized shapes → localized sentence; anything else → the raw expression.
 * Times are the trigger timezone's WALL CLOCK, rendered as literal `HH:mm` —
 * never routed through `Date` (that would convert an instant and shift it).
 */
export function describeCron(cron: string, tz: string | undefined, t: DescribeT, locale: string): string {
  const tzSuffix = ` · ${tz ?? 'UTC'}`;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return `${cron}${tzSuffix}`;
  const [m, h, dom, mon, dow] = fields;

  let text: string | null = null;
  if (mon === '*') {
    const minuteStep = STEP.exec(m);
    const hourStep = STEP.exec(h);
    if (minuteStep && h === '*' && dom === '*' && dow === '*') {
      text = t('cron.everyNMinutes', 'Every {{n}} minutes', { n: Number(minuteStep[1]) });
    } else if (NUM.test(m) && Number(m) < 60) {
      const mm = pad(Number(m));
      if (hourStep && dom === '*' && dow === '*') {
        text = t('cron.everyNHours', 'Every {{n}} hours at :{{mm}}', { n: Number(hourStep[1]), mm });
      } else if (h === '*' && dom === '*' && dow === '*') {
        text = t('cron.hourly', 'Every hour at :{{mm}}', { mm });
      } else if (NUM.test(h) && Number(h) < 24) {
        const time = `${pad(Number(h))}:${mm}`;
        if (dom === '*' && dow === '*') {
          text = t('cron.daily', 'Every day at {{time}}', { time });
        } else if (dom === '*') {
          const dows = parseDowList(dow);
          if (dows) text = t('cron.weekly', 'Every {{days}} at {{time}}', { days: weekdayNames(locale, dows), time });
        } else if (dow === '*' && NUM.test(dom) && Number(dom) >= 1 && Number(dom) <= 31) {
          text = t('cron.monthly', 'On day {{day}} of every month at {{time}}', { day: Number(dom), time });
        }
      }
    }
  }
  return `${text ?? cron}${tzSuffix}`;
}
