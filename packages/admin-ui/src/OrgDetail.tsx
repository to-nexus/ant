import { useCallback, useEffect, useState } from 'react';
import type { AdminOrgDetail } from '@ant/shared';
import { adminApi } from './api/admin';

/**
 * Superadmin org detail — members / invites / domains cards, manual domain
 * verify·reject (decision 6 path c), and the force-delete cascade.
 */
export function OrgDetail({
  orgId,
  onClose,
  onChanged,
}: {
  orgId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AdminOrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await adminApi.getOrganization(orgId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [orgId]);

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

  if (!detail) {
    return (
      <div className="card">
        <div className="row">
          <strong>{orgId}</strong>
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
        <strong>{detail.name}</strong>
        <span className="muted">{detail.id}</span>
        <span className="badge approved">{detail.kind}</span>
        {detail.deletedAt && <span className="badge denied">deleted</span>}
        <div className="spacer" />
        <button onClick={onClose}>닫기</button>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <strong>멤버 ({detail.members.length})</strong>
        <table>
          <thead>
            <tr>
              <th>이메일</th>
              <th>역할</th>
              <th>가입</th>
            </tr>
          </thead>
          <tbody>
            {detail.members.map((m) => (
              <tr key={m.userId}>
                <td>{m.email}</td>
                <td>{m.role}</td>
                <td className="muted">{new Date(m.joinedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <strong>초대 ({detail.invites.length})</strong>
        {detail.invites.length === 0 ? (
          <div className="muted">초대 없음</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>이메일</th>
                <th>역할</th>
                <th>상태</th>
                <th>만료</th>
              </tr>
            </thead>
            <tbody>
              {detail.invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td><span className={`badge ${i.status === 'accepted' ? 'approved' : i.status === 'pending' ? 'pending' : 'denied'}`}>{i.status}</span></td>
                  <td className="muted">{new Date(i.expiresAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <strong>도메인 ({detail.domains.length})</strong>
        {detail.domains.length === 0 ? (
          <div className="muted">도메인 claim 없음</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>도메인</th>
                <th>상태</th>
                <th>검증 경로</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {detail.domains.map((d) => (
                <tr key={d.domain}>
                  <td>{d.domain}</td>
                  <td><span className={`badge ${d.status === 'verified' ? 'approved' : d.status === 'pending' ? 'pending' : 'denied'}`}>{d.status}</span></td>
                  <td className="muted">{d.verifiedBy ?? '—'}</td>
                  <td>
                    <div className="row">
                      {d.status !== 'verified' && (
                        <button className="ok" disabled={busy} onClick={() => run(() => adminApi.adminVerifyDomain(detail.id, d.domain))}>
                          수동 승인
                        </button>
                      )}
                      {d.status !== 'rejected' && (
                        <button className="danger" disabled={busy} onClick={() => run(() => adminApi.adminRejectDomain(detail.id, d.domain))}>
                          거부
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!detail.deletedAt && (
        <div className="row" style={{ marginTop: 12 }}>
          <div className="spacer" />
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`조직 "${detail.name}" (${detail.id}) 을 강제 삭제할까요? 멤버는 individual로 복귀합니다.`)) {
                void run(() => adminApi.adminForceDeleteOrg(detail.id));
              }
            }}
          >
            조직 강제 삭제
          </button>
        </div>
      )}
    </div>
  );
}
