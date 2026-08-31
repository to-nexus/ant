/**
 * MCP credential registration API (`/api/credentials/mcp`).
 *
 * The write-side of the A16 credential plane: agent definitions reference
 * credential KEY NAMES in `mcp.servers[].headers`/`env`; the values are
 * registered here into the encrypted per-user store
 * (`workspaces/{org}/{user}/.ant/credentials.json`, AES-256-GCM) and resolved
 * at MCP connect time — never from process.env.
 *
 * Values are write-only: GET returns keys + updatedAt, never the secret.
 * Mirrors the GitHub PAT precedent (`POST /api/github/pat` → credentials.set).
 */

import { Router, Request, Response } from 'express';
import { MCP_ENV_VAR_NAME_PATTERN } from '@ant/shared';
import type { CredentialsStore } from '../../../../utils/userConfig/CredentialsStore';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';

export function createMcpCredentialRoutes(deps: { credentialsStore: CredentialsStore }): Router {
  const router = Router();

  /** Keys + updatedAt only — the secret value never leaves the store. */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const credentials = await deps.credentialsStore.listMcpKeys(userContext);
      res.json({ credentials });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'McpCredentials');
    }
  });

  router.put('/', async (req: Request, res: Response) => {
    try {
      const { key, value } = req.body ?? {};
      if (typeof key !== 'string' || !MCP_ENV_VAR_NAME_PATTERN.test(key)) {
        return res.status(400).json({
          error: `Credential key must match ${MCP_ENV_VAR_NAME_PATTERN} (got: ${String(key)})`,
        });
      }
      if (typeof value !== 'string' || value.trim().length === 0) {
        return res.status(400).json({ error: 'Credential value must be a non-empty string' });
      }
      const userContext = extractUserContext(req);
      await deps.credentialsStore.setMcpSecret(userContext, key, value);
      res.json({ success: true, key });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'McpCredentials');
    }
  });

  router.delete('/:key', async (req: Request, res: Response) => {
    try {
      const { key } = req.params;
      if (!MCP_ENV_VAR_NAME_PATTERN.test(key)) {
        return res.status(400).json({ error: `Invalid credential key: ${key}` });
      }
      const userContext = extractUserContext(req);
      await deps.credentialsStore.deleteMcpSecret(userContext, key);
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'McpCredentials');
    }
  });

  return router;
}
