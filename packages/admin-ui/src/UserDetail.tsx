import { useCallback, useEffect, useState } from 'react';
import type { AdminScopeDetail, AdminUserDetail, ApprovalStatus } from '@ant/shared';
import { adminApi, getSystemConfig, type AdminPurgeReport } from './api/admin';

/**
 * One card per billing scope. Credits are keyed per (org, user), so a refund
 * must name its scope — this card is the only place that number is entered.
 */
function ScopeCard({
  scope,
  userId,
  busy,
  billingEnabled,
  onRefund,
}: {
  scope: AdminScopeDetail;
  userId: string;
  busy: boolean;
  billingEnabled: boolean;
  onRefund: (organizationId: string, credits: number, reason: string) => void;
}) {
  const [credits, setCredits] = useState('');
  const [reason, setReason] = useState('');
  const label = scope.organizationName ?? scope.organizationId;

  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <strong>{label}</strong>
        <span className="badge approved">{scope.organizationKind === 'team' ? '팀' : '개인'}</span>
        {scope.role && <span className="muted">{scope.role}</span>}
        {scope.active && <span className="muted">· 활성</span>}
        {scope.orphaned && <span className="badge denied">소속 없음</span>}
        <div className="spacer" />
        <span className="muted">
          {scope.stale
            ? '마이그레이션 대기 — 잔액 표시 보류'
            : scope.balance
              ? `${scope.balance.tier} · ${scope.balance.credits.toFixed(2)} credits`
              : '결제 계정 없음'}
        </span>
      </div>

      {scope.grantOverdue && (
        <div className="muted" style={{ marginBottom: 8 }}>
          월 grant 미적용 — 표시된 잔액은 지급 이전 값입니다.
        </div>
      )}

      {billingEnabled && scope.balance && !scope.stale && (
        <div className="row">
          <div className="field">
            <label>환불 크레딧</label>
            <input
              type="number"
              min={0}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              style={{ width: 120 }}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>사유</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <button
            className="primary"
            disabled={busy || !(Number(credits) > 0)}
            onClick={() => onRefund(scope.organizationId, Number(credits) || 0, reason)}
            style={{ alignSelf: 'flex-end' }}
          >
            {label}에 환불
          </button>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <strong>거래 내역 ({scope.transactions.length})</strong>
        <div className="ledger">
          <table>
            <thead>
              <tr>
                <th>시각</th>
                <th>종류</th>
                <th>크레딧</th>
                <th>메모</th>
              </tr>
            </thead>
            <tbody>
              {scope.transactions.map((t) => (
                <tr key={`${userId}:${scope.organizationId}:${t.id}`}>
                  <td className="muted">{new Date(t.ts).toLocaleString()}</td>
                  <td>{t.kind}</td>
                  <td>{(t.microCredits / 100000).toFixed(2)}</td>
                  <td className="muted">{t.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function UserDetail({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testLevel, setTestLevel] = useState('');
  // Refund is a billing action — self-hosted (unmetered) deployments have no refund route.
  const [billingEnabled, setBillingEnabled] = useState(false);
  /** Typed-email confirmation for the purge — the button stays disabled until it matches. */
  const [purgeConfirm, setPurgeConfirm] = useState('');
  const [purgeReport, setPurgeReport] = useState<AdminPurgeReport | null>(null);

  useEffect(() => {
    getSystemConfig()
      .then((cfg) => setBillingEnabled(cfg.capabilities.billing === true))
      .catch(() => setBillingEnabled(false));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await adminApi.getUser(userId);
      setDetail(d);
      setTestLevel(String(d.testAccountLevel));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setApproval = (status: ApprovalStatus) => run(() => adminApi.setApproval(userId, status));
  const applyTestLevel = () => run(() => adminApi.setTestLevel(userId, Number(testLevel) || 0));
  const purge = async () => {
    setBusy(true);
    setError(null);
    try {
      setPurgeReport(await adminApi.purgeUser(userId, purgeConfirm.trim()));
      setPurgeConfirm('');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const applyRefund = (organizationId: string, credits: number, reason: string) =>
    run(() =>
      adminApi.refund(
        userId,
        organizationId,
        credits,
        reason,
        `admin-refund-${userId}-${organizationId}-${credits}-${reason}`,
      ),
    );

  if (!detail) {
    return (
      <div className="card">
        <div className="row">
          <strong>{userId}</strong>
          <div className="spacer" />
          <button onClick={onClose}>닫기</button>
        </div>
        {error ? <div className="error">{error}</div> : <div className="muted">불러오는 중…</div>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <strong>{detail.email}</strong>
        <span className={`badge ${detail.approvalStatus}`}>{detail.approvalStatus}</span>
        {detail.isSuperAdmin && <span className="muted">super-admin</span>}
        <div className="spacer" />
        <button onClick={onClose}>닫기</button>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="ok" disabled={busy} onClick={() => setApproval('approved')}>
          승인
        </button>
        <button disabled={busy} onClick={() => setApproval('pending')}>
          미인증으로 되돌리기
        </button>
        <button className="danger" disabled={busy} onClick={() => setApproval('denied')}>
          차단
        </button>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <div className="field">
          <label>테스트 계정 레벨 (0=일반, ≥1=테스트결제)</label>
          <div className="row">
            <input
              type="number"
              min={0}
              value={testLevel}
              onChange={(e) => setTestLevel(e.target.value)}
              style={{ width: 80 }}
            />
            <button disabled={busy} onClick={applyTestLevel}>
              적용
            </button>
          </div>
        </div>
      </div>

      {/* Purge — distinct from 차단 (an approvalStatus flip that keeps the data). */}
      {!detail.isSuperAdmin && (
        <div
          className="card"
          style={{ background: 'var(--surface-2)', marginBottom: 16, borderColor: 'var(--danger, #b91c1c)' }}
        >
          <strong>계정 완전 삭제</strong>
          <div className="muted" style={{ marginBottom: 8 }}>
            프로젝트·정의·자격증명·소속을 모두 제거하고 신원에 tombstone 을 남깁니다.
            보유 중인 세션 쿠키와 데스크톱 토큰이 즉시 무효화되고, 같은 계정으로 다시
            가입할 수 없습니다. 결제 원장은 회계 기록이므로 보존됩니다.
          </div>
          <div className="row">
            <input
              value={purgeConfirm}
              onChange={(e) => setPurgeConfirm(e.target.value)}
              placeholder={`확인을 위해 ${detail.email} 입력`}
              style={{ minWidth: 280 }}
            />
            <button
              className="danger"
              disabled={busy || purgeConfirm.trim().toLowerCase() !== detail.email.toLowerCase()}
              onClick={() => void purge()}
            >
              영구 삭제
            </button>
          </div>
          {purgeReport && (
            <table style={{ marginTop: 10 }}>
              <tbody>
                {purgeReport.steps.map((st) => (
                  <tr key={st.step}>
                    <td>{st.step}</td>
                    <td className={st.ok ? undefined : 'error'}>{st.ok ? '완료' : '실패'}</td>
                    <td className="muted">{st.detail ?? st.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <strong>소속별 결제 ({detail.scopes.length})</strong>
      {detail.scopes.map((s) => (
        <ScopeCard
          key={s.organizationId}
          scope={s}
          userId={userId}
          busy={busy}
          billingEnabled={billingEnabled}
          onRefund={applyRefund}
        />
      ))}
    </div>
  );
}
