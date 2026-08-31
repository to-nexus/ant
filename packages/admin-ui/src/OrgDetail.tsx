import { useCallback, useEffect, useState } from 'react';
import type { AdminOrgDetail } from '@ant/shared';
import { adminApi } from './api/admin';

/**
 * Superadmin org detail — members / invites / domains / join requests /
 * removal-row cards, manual domain
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {detail.members.map((m) => (
              <tr key={m.userId}>
                <td>{m.email}</td>
                <td>{m.role}</td>
                <td className="muted">{new Date(m.joinedAt).toLocaleDateString()}</td>
                <td>
                  {/* The owner is refused server-side too — transfer or delete the org. */}
                  {m.role === 'owner' ? (
                    <span className="muted">소유자</span>
                  ) : (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `${m.email} 을(를) ${detail.id} 에서 제거합니다.\n` +
                              '도메인 자동 가입 제외 목록에 기록되어 다음 로그인에 다시 합류하지 않습니다.',
                          )
                        )
                          return;
                        void run(() => adminApi.adminRemoveOrgMember(detail.id, m.userId));
                      }}
                    >
                      제거
                    </button>
                  )}
                </td>
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
                <th>로그인 시</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {detail.domains.map((d) => (
                <tr key={d.domain}>
                  <td>{d.domain}</td>
                  <td><span className={`badge ${d.status === 'verified' ? 'approved' : d.status === 'pending' ? 'pending' : 'denied'}`}>{d.status}</span></td>
                  <td className="muted">{d.verifiedBy ?? '—'}</td>
                  <td className="muted">
                    {d.status !== 'verified'
                      ? '—'
                      : d.autoJoin
                        ? `자동 가입 (${d.autoJoinRole})`
                        : '제안만'}
                  </td>
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

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <strong>참여 요청 ({detail.joinRequests.filter((r) => r.status === 'pending').length} 대기)</strong>
        <div className="muted" style={{ fontSize: 12 }}>
          검색 노출: {detail.discoverable ? '허용' : '차단'} — 요청 승인은 조직 admin 권한입니다.
        </div>
        {detail.joinRequests.length === 0 ? (
          <div className="muted">참여 요청 없음</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>이메일</th>
                <th>상태</th>
                <th>요청</th>
                <th>처리자</th>
              </tr>
            </thead>
            <tbody>
              {detail.joinRequests.map((r) => (
                <tr key={r.id}>
                  <td>{r.email}</td>
                  <td>
                    <span className={`badge ${r.status === 'approved' ? 'approved' : r.status === 'pending' ? 'pending' : 'denied'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="muted">{r.decidedBy ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <strong>도메인 자동 가입 제외 ({detail.removedMembers.length})</strong>
        <div className="muted" style={{ fontSize: 12 }}>
          탈퇴·제거 기록. 해당 계정은 다음 로그인에 도메인으로 재가입되지 않습니다.
        </div>
        {detail.removedMembers.length === 0 ? (
          <div className="muted">기록 없음</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>이메일</th>
                <th>사유</th>
                <th>일시</th>
                <th>처리자</th>
              </tr>
            </thead>
            <tbody>
              {detail.removedMembers.map((r) => (
                <tr key={r.userId}>
                  <td>{r.email}</td>
                  <td className="muted">{r.reason === 'removed' ? '관리자 제거' : '본인 탈퇴'}</td>
                  <td className="muted">{new Date(r.removedAt).toLocaleDateString()}</td>
                  <td className="muted">{r.removedBy}</td>
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
