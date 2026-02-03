/**
 * Preview Module
 * 
 * ant-preview service handles ALL preview operations:
 * - POST /preview/projects/:id/start  - Start preview
 * - POST /preview/projects/:id/stop   - Stop preview
 * - GET  /preview/projects/:id/status - Get status
 * - GET  /preview/:key/*              - Proxy to dev server
 * 
 * All environments (local and cloud) use the same distributed architecture
 * with Redis for state management.
 * 
 * @see docs/architecture/10-cloud-architecture.md
 */

export { PreviewServer, createPreviewServer } from './PreviewServer';
export type { PreviewServerOptions } from './PreviewServer';
