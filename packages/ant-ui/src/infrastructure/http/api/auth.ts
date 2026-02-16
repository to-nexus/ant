import { API_BASE, authFetch } from './client';

export interface AuthResponse {
  success: boolean;
  message: string;
  user?: {
    email: string;
    userId: string;
    organization: string;
  };
  error?: string;
}

function handleOAuthRedirect(data: any, response: Response): AuthResponse | null {
  if (response.status === 401 && data.error === 'OAuth required') {
    const backendBase = API_BASE().replace('/api', '');
    window.location.href = `${backendBase}/api/auth/google`;
    return { success: false, message: 'Redirecting to Google OAuth...' };
  }
  return null;
}

/**
 * Sign up - Create user workspace.
 * If OAuth is required (production), redirects to Google OAuth.
 */
export async function signUp(email: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE()}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  const redirect = handleOAuthRedirect(data, response);
  if (redirect) return redirect;
  if (!response.ok) throw new Error(data.message || data.error || 'Sign up failed');
  return data;
}

/**
 * Sign in - Validate user workspace exists.
 * If OAuth is required (production), redirects to Google OAuth.
 */
export async function signIn(email: string): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE()}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  const redirect = handleOAuthRedirect(data, response);
  if (redirect) return redirect;
  if (!response.ok) throw new Error(data.message || data.error || 'Sign in failed');
  return data;
}

/**
 * Sign out - Clear user session
 */
export async function signOut(): Promise<void> {
  try {
    await authFetch(`${API_BASE()}/auth/signout`, { method: 'POST' });
  } catch (error) {
    console.error('Error signing out:', error);
  }
}
