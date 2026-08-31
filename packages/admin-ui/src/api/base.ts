/**
 * "Where is the backend" — single owner for admin-ui, same convention as
 * ant-ui's `getBackendBase()`. Empty ⇒ relative paths (dev vite proxy, or a
 * single-origin deployment).
 */
const BACKEND_BASE = (import.meta.env.VITE_CLOUD_BACKEND_BASE as string | undefined) ?? '';

export const API_BASE = `${BACKEND_BASE}/api`;
