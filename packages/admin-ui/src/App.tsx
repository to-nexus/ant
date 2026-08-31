import { useEffect, useState } from 'react';
import { fetchAuthMeDetailed, type AuthMeResult } from '@ant/auth-client';
import { Dashboard } from './Dashboard';
import { API_BASE } from './api/base';

const LOGIN_URL = `${API_BASE}/auth/google?returnTo=${encodeURIComponent('/admin/')}`;

export function App() {
  const [result, setResult] = useState<AuthMeResult | null>(null);

  useEffect(() => {
    fetchAuthMeDetailed({ apiBase: API_BASE })
      .then(setResult)
      .catch(() => setResult({ kind: 'network', message: 'auth check failed' }));
  }, []);

  if (result === null) {
    return <div className="center muted">인증 확인 중…</div>;
  }

  if (result.kind !== 'user') {
    return (
      <div className="center">
        <h1>ANT Admin</h1>
        <p className="muted">관리자 계정으로 로그인이 필요합니다.</p>
        <a href={LOGIN_URL}>
          <button className="primary">Google로 로그인</button>
        </a>
      </div>
    );
  }

  if (result.user.isAdmin !== true) {
    return (
      <div className="center">
        <h1>접근 권한 없음</h1>
        <p className="muted">
          {result.user.email} 계정은 관리자 권한이 없습니다.
        </p>
        <a href="/app/">
          <button>고객 앱으로 이동</button>
        </a>
      </div>
    );
  }

  return <Dashboard adminEmail={result.user.email} />;
}
