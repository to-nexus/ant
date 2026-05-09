export interface SignOutOptions {
  /** Absolute API base, e.g. `https://ant-server.crosstoken.io/api` or `/api`. */
  apiBase: string;
  /**
   * Called when the signout request fails (network/CORS/non-2xx). The unified
   * logout procedure surfaces this to the user (toast/banner) and proceeds
   * with local cleanup regardless — silent swallowing is forbidden.
   */
  onError?: (error: unknown) => void;
}

export interface SignOutResult {
  /** True when the API call returned 2xx; false when network or HTTP failure. */
  ok: boolean;
}

/**
 * POST /api/auth/signout. Always resolves — never throws — so the unified
 * logout procedure can run cleanup + navigation deterministically.
 *
 * Errors are surfaced via `onError` (do NOT use `console.error` alone — the
 * caller decides how to surface to the user).
 */
export async function signOut(opts: SignOutOptions): Promise<SignOutResult> {
  try {
    const response = await fetch(`${opts.apiBase}/auth/signout`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      const error = new Error(`signout responded ${response.status}`);
      opts.onError?.(error);
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    opts.onError?.(error);
    return { ok: false };
  }
}
