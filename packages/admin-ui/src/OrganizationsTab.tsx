import { useCallback, useEffect, useState } from 'react';
import type { AdminOrgSummary } from '@ant/shared';
import { adminApi } from './api/admin';
import { OrgDetail } from './OrgDetail';

/** Superadmin org list — every org including soft-deleted ones. */
export function OrganizationsTab() {
  const [orgs, setOrgs] = useState<AdminOrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listOrganizations();
      setOrgs(res.organizations);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      {error && <div className="card error">{error}</div>}

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <strong>조직 ({orgs.length})</strong>
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
                <th>Id</th>
                <th>이름</th>
                <th>Kind</th>
                <th>멤버</th>
                <th>도메인</th>
                <th>요청</th>
                <th>검색</th>
                <th>생성</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => setSelected(o.id)}>
                  <td>{o.id}</td>
                  <td>{o.name}</td>
                  <td>{o.kind}</td>
                  <td>{o.memberCount}</td>
                  <td>{o.domainCount}</td>
                  <td>{o.joinRequestCount || '—'}</td>
                  <td className="muted">{o.discoverable ? '노출' : '숨김'}</td>
                  <td className="muted">{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td>{o.deletedAt ? <span className="badge denied">deleted</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <OrgDetail orgId={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
      )}
    </>
  );
}
