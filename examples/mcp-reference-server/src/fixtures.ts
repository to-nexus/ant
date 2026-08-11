/**
 * Deterministic fixture dataset for a fictional commerce platform.
 *
 * Everything is hard-coded relative to REFERENCE_NOW — never Date.now() —
 * so every call returns byte-identical data and the documented sample
 * exchanges stay reproducible forever.
 */

export const REFERENCE_NOW = '2026-08-10T00:00:00Z';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  service: string;
  opened_at: string;
  acknowledged_at?: string;
  resolved_at?: string;
}

export const INCIDENTS: readonly Incident[] = [
  {
    id: 'INC-1001',
    title: 'Search index replication lag above 5 minutes',
    severity: 'low',
    status: 'resolved',
    service: 'search-index',
    opened_at: '2026-05-14T08:02:00Z',
    acknowledged_at: '2026-05-14T08:31:00Z',
    resolved_at: '2026-05-14T11:19:00Z',
  },
  {
    id: 'INC-1002',
    title: 'CDN edge cache purge storm after config rollout',
    severity: 'medium',
    status: 'resolved',
    service: 'cdn-edge',
    opened_at: '2026-05-21T14:45:00Z',
    acknowledged_at: '2026-05-21T14:52:00Z',
    resolved_at: '2026-05-21T17:36:00Z',
  },
  {
    id: 'INC-1003',
    title: 'Payment gateway webhook backlog exceeding 10 minutes',
    severity: 'high',
    status: 'resolved',
    service: 'payment-gateway',
    opened_at: '2026-06-02T03:11:00Z',
    acknowledged_at: '2026-06-02T03:18:00Z',
    resolved_at: '2026-06-02T06:04:00Z',
  },
  {
    id: 'INC-1004',
    title: 'Auth service token refresh failures for stale sessions',
    severity: 'medium',
    status: 'resolved',
    service: 'auth-service',
    opened_at: '2026-06-10T19:27:00Z',
    acknowledged_at: '2026-06-10T19:41:00Z',
    resolved_at: '2026-06-10T21:58:00Z',
  },
  {
    id: 'INC-1005',
    title: 'Notification worker retry queue growing without drain',
    severity: 'low',
    status: 'resolved',
    service: 'notification-worker',
    opened_at: '2026-06-19T10:05:00Z',
    acknowledged_at: '2026-06-19T10:44:00Z',
    resolved_at: '2026-06-19T13:12:00Z',
  },
  {
    id: 'INC-1006',
    title: 'Checkout API returning 503 for all card payments',
    severity: 'critical',
    status: 'resolved',
    service: 'checkout-api',
    opened_at: '2026-06-30T22:14:00Z',
    acknowledged_at: '2026-06-30T22:17:00Z',
    resolved_at: '2026-07-01T00:41:00Z',
  },
  {
    id: 'INC-1007',
    title: 'Search suggestions serving stale catalog entries',
    severity: 'medium',
    status: 'resolved',
    service: 'search-index',
    opened_at: '2026-07-12T06:33:00Z',
    acknowledged_at: '2026-07-12T07:02:00Z',
    resolved_at: '2026-07-12T09:27:00Z',
  },
  {
    id: 'INC-1008',
    title: 'Elevated TLS handshake failures at APAC edge PoPs',
    severity: 'high',
    status: 'resolved',
    service: 'cdn-edge',
    opened_at: '2026-07-18T01:49:00Z',
    acknowledged_at: '2026-07-18T01:57:00Z',
    resolved_at: '2026-07-18T04:22:00Z',
  },
  {
    id: 'INC-1009',
    title: 'Digest emails delayed by slow template rendering',
    severity: 'low',
    status: 'resolved',
    service: 'notification-worker',
    opened_at: '2026-07-22T12:20:00Z',
    acknowledged_at: '2026-07-22T13:01:00Z',
    resolved_at: '2026-07-22T15:44:00Z',
  },
  {
    id: 'INC-1010',
    title: 'Refund processing intermittently timing out',
    severity: 'medium',
    status: 'resolved',
    service: 'payment-gateway',
    opened_at: '2026-07-28T16:08:00Z',
    acknowledged_at: '2026-07-28T16:19:00Z',
    resolved_at: '2026-07-28T18:53:00Z',
  },
  {
    id: 'INC-1011',
    title: 'Sporadic 401s from session validation under load',
    severity: 'high',
    status: 'open',
    service: 'auth-service',
    opened_at: '2026-08-01T09:36:00Z',
    acknowledged_at: '2026-08-01T09:48:00Z',
  },
  {
    id: 'INC-1012',
    title: 'Elevated 5xx on checkout-api after deploy 2026-08-04',
    severity: 'critical',
    status: 'resolved',
    service: 'checkout-api',
    opened_at: '2026-08-04T02:11:00Z',
    acknowledged_at: '2026-08-04T02:19:00Z',
    resolved_at: '2026-08-04T04:40:00Z',
  },
  {
    id: 'INC-1013',
    title: 'Payment gateway settlement file import failing',
    severity: 'high',
    status: 'open',
    service: 'payment-gateway',
    opened_at: '2026-08-05T07:54:00Z',
    acknowledged_at: '2026-08-05T08:03:00Z',
  },
  {
    id: 'INC-1014',
    title: 'Push notification fan-out lag for large segments',
    severity: 'medium',
    status: 'acknowledged',
    service: 'notification-worker',
    opened_at: '2026-08-07T11:26:00Z',
    acknowledged_at: '2026-08-07T11:58:00Z',
  },
  {
    id: 'INC-1015',
    title: 'Search index nightly rebuild finished 40 minutes late',
    severity: 'low',
    status: 'resolved',
    service: 'search-index',
    opened_at: '2026-08-09T05:12:00Z',
    acknowledged_at: '2026-08-09T05:40:00Z',
    resolved_at: '2026-08-09T06:35:00Z',
  },
];

export type Period = '7d' | '30d' | '90d';

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 };

export function incidentsInWindow(period: Period): Incident[] {
  const now = Date.parse(REFERENCE_NOW);
  const cutoff = now - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000;
  return INCIDENTS.filter((i) => Date.parse(i.opened_at) >= cutoff);
}

export interface SlaBreach {
  slo: string;
  target: number;
  actual: number;
  breached: boolean;
}

/**
 * Hard-coded quality numbers per period; incident counts are DERIVED from the
 * same window the list_incidents tool serves, so the two tools can never
 * disagree about totals.
 */
export const SLA_QUALITY: Record<
  Period,
  { availability_pct: number; mtta_minutes: number; mttr_minutes: number; slo_breaches: SlaBreach[] }
> = {
  '7d': {
    availability_pct: 99.92,
    mtta_minutes: 7,
    mttr_minutes: 58,
    slo_breaches: [
      { slo: 'checkout-api availability', target: 99.95, actual: 99.96, breached: false },
    ],
  },
  '30d': {
    availability_pct: 99.87,
    mtta_minutes: 9,
    mttr_minutes: 74,
    slo_breaches: [
      { slo: 'checkout-api availability', target: 99.95, actual: 99.91, breached: true },
      { slo: 'payment-gateway p95 latency < 800ms', target: 99.0, actual: 99.4, breached: false },
    ],
  },
  '90d': {
    availability_pct: 99.81,
    mtta_minutes: 11,
    mttr_minutes: 86,
    slo_breaches: [
      { slo: 'checkout-api availability', target: 99.95, actual: 99.88, breached: true },
      { slo: 'payment-gateway p95 latency < 800ms', target: 99.0, actual: 98.6, breached: true },
    ],
  },
};
