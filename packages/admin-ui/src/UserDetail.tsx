import { useCallback, useEffect, useState } from 'react';
import type { AdminUserDetail, ApprovalStatus } from '@ant/shared';
import { adminApi, getSystemConfig } from './api/admin';

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
  const [refundCredits, setRefundCredits] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [testLevel, setTestLevel] = useState('');
  // Refund is a billing action — self-hosted (unmetered) deployments have no refund route.
  const [billingEnabled, setBillingEnabled] = useState(false);

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
  const applyRefund = () =>
    run(() =>
      adminApi.refund(
        userId,
        Number(refundCredits) || 0,
        refundReason,
        `admin-refund-${userId}-${refundCredits}-${refundReason}`,
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

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <strong>결제</strong>
          <div className="spacer" />
          <span className="muted">
            {detail.balance.tier} · {detail.balance.credits.toFixed(2)} credits
          </span>
        </div>
        {billingEnabled && (
          <div className="row">
            <div className="field">
              <label>환불 크레딧</label>
              <input
                type="number"
                min={0}
                value={refundCredits}
                onChange={(e) => setRefundCredits(e.target.value)}
                style={{ width: 120 }}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>사유</label>
              <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
            </div>
            <button
              className="primary"
              disabled={busy || !(Number(refundCredits) > 0)}
              onClick={applyRefund}
              style={{ alignSelf: 'flex-end' }}
            >
              환불
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>거래 내역 ({detail.transactions.length})</strong>
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
              {detail.transactions.map((t) => (
                <tr key={t.id}>
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
