import { useCallback, useEffect, useState } from 'react';
import type { AdminUserSummary, DefaultApprovalMode } from '@ant/shared';
import { adminApi } from './api/admin';
import { UserDetail } from './UserDetail';
import { OrganizationsTab } from './OrganizationsTab';

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

export function Dashboard({ adminEmail }: { adminEmail: string }) {
  // Tab state only — no router in this SPA by design.
  const [view, setView] = useState<'users' | 'organizations'>('users');
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [policy, setPolicy] = useState<DefaultApprovalMode>('auto-approve');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listUsers();
      setUsers(res.users);
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
          <strong>사용자 ({users.length})</strong>
          <div className="spacer" />
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
                <th>승인</th>
                <th>Tier</th>
                <th>크레딧</th>
                <th>테스트레벨</th>
                <th>관리자</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="clickable" onClick={() => setSelected(u.userId)}>
                  <td>{u.email}</td>
                  <td><StatusBadge status={u.approvalStatus} /></td>
                  <td>{u.tier}</td>
                  <td>{u.credits.toFixed(2)}</td>
                  <td>{u.testAccountLevel}</td>
                  <td>{u.isSuperAdmin ? '✓' : ''}</td>
                </tr>
              ))}
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
