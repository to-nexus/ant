import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminAccountRow, DefaultApprovalMode } from '@ant/shared';
import { adminApi } from './api/admin';
import { UserDetail } from './UserDetail';
import { OrganizationsTab } from './OrganizationsTab';

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

/** 소속 cell — name (or id), kind, and the active / orphaned markers. */
function ScopeCell({ row }: { row: AdminAccountRow }) {
  return (
    <>
      <span>{row.organizationName ?? row.organizationId}</span>
      <span className="badge approved" style={{ marginLeft: 6 }}>
        {row.organizationKind === 'team' ? '팀' : '개인'}
      </span>
      {row.active && <span className="muted" style={{ marginLeft: 6 }}>· 활성</span>}
      {row.orphaned && (
        <span className="badge denied" style={{ marginLeft: 6 }}>
          소속 없음
        </span>
      )}
    </>
  );
}

export function Dashboard({ adminEmail }: { adminEmail: string }) {
  // Tab state only — no router in this SPA by design.
  const [view, setView] = useState<'users' | 'organizations'>('users');
  const [rows, setRows] = useState<AdminAccountRow[]>([]);
  const [policy, setPolicy] = useState<DefaultApprovalMode>('auto-approve');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [orgFilter, setOrgFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listAccounts();
      setRows(res.rows);
      setPolicy(res.defaultApprovalMode);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filter options come from the rows themselves, so the select never offers
  // an org with nothing under it.
  const orgOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of rows) byId.set(r.organizationId, r.organizationName ?? r.organizationId);
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const visible = useMemo(
    () => (orgFilter ? rows.filter((r) => r.organizationId === orgFilter) : rows),
    [rows, orgFilter],
  );
  const userCount = useMemo(() => new Set(visible.map((r) => r.userId)).size, [visible]);

  const togglePolicy = async () => {
    const next: DefaultApprovalMode = policy === 'auto-approve' ? 'require-approval' : 'auto-approve';
    try {
      const cfg = await adminApi.setConfig(next);
      setPolicy(cfg.defaultApprovalMode);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="app">
      <div className="header">
        <h1>ANT Admin</h1>
        <span className="muted">{adminEmail}</span>
      </div>

      <div className="tabbar">
        <button className={`tab ${view === 'users' ? 'active' : ''}`} onClick={() => setView('users')}>
          사용자
        </button>
        <button
          className={`tab ${view === 'organizations' ? 'active' : ''}`}
          onClick={() => setView('organizations')}
        >
          조직
        </button>
      </div>

      {view === 'organizations' && <OrganizationsTab />}

      {view === 'users' && (
      <>
      <div className="card">
        <div className="row">
          <div>
            <strong>신규 계정 기본 정책</strong>
            <div className="muted">
              토글 이후 생성되는 계정에 적용 (기존 계정 불변)
            </div>
          </div>
          <div className="spacer" />
          <StatusBadge status={policy === 'require-approval' ? 'pending' : 'approved'} />
          <button className="primary" onClick={togglePolicy}>
            {policy === 'auto-approve' ? '승인 필요로 전환' : '자동 승인으로 전환'}
          </button>
        </div>
      </div>

      {error && <div className="card error">{error}</div>}

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <strong>
            사용자 {userCount}명 · 소속 계정 {visible.length}개
          </strong>
          <div className="spacer" />
          <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="">전체 소속</option>
            {orgOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button onClick={() => void load()} disabled={loading}>
            새로고침
          </button>
        </div>
        {loading ? (
          <div className="muted">불러오는 중…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>이메일</th>
                <th>소속</th>
                <th>승인</th>
                <th>Tier</th>
                <th>크레딧</th>
                <th>테스트레벨</th>
                <th>관리자</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                // A user's rows are contiguous; repeat the email only on the first.
                const repeat = i > 0 && visible[i - 1].userId === r.userId;
                return (
                  <tr
                    key={`${r.userId}::${r.organizationId}`}
                    className="clickable"
                    onClick={() => setSelected(r.userId)}
                  >
                    <td className={repeat ? 'muted' : undefined}>{repeat ? '↳' : r.email}</td>
                    <td><ScopeCell row={r} /></td>
                    <td><StatusBadge status={r.approvalStatus} /></td>
                    <td>{r.tier ?? '—'}</td>
                    <td>
                      {r.credits === null ? '—' : r.credits.toFixed(2)}
                      {r.stale && (
                        <span className="badge pending" style={{ marginLeft: 6 }}>
                          마이그레이션 대기
                        </span>
                      )}
                      {r.grantOverdue && (
                        <span className="badge pending" style={{ marginLeft: 6 }}>
                          grant 대기
                        </span>
                      )}
                    </td>
                    <td>{r.testAccountLevel}</td>
                    <td>{r.isSuperAdmin ? '✓' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <UserDetail
          userId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => void load()}
        />
      )}
      </>
      )}
    </div>
  );
}
