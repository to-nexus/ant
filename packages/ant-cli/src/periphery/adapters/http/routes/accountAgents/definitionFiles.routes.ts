/**
 * Definition-file surface — tree/read/download, the ONE write funnel
 * (PUT /:agentId/file → gateDefinitionSave → validateDefinitionSave), and the
 * file-management legs (create/mkdir/rename/delete/upload).
 */

import type { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type multer from 'multer';
import { boundedMultipart } from '../../middleware/boundedMultipart';
import {
  CUSTOM_ID_HINT,
  GENERAL_INTENT,
  classifyDefinitionDir,
  isAllowedDefinitionDir,
  isAllowedDefinitionPath,
  isValidCustomId,
} from '@ant/shared';
import { FILE_READ_MAX_BYTES } from '../../services/ProjectService/FileOperationService';
import {
  buildDefinitionTree,
  definitionWhitelistGuidance,
  findWritableAgent,
  gateDefinitionSave,
  resolveDefinitionPath,
  validateDefinitionSave,
} from '../helpers/customAgentHandlers';
import { canEditOrgResource } from '../helpers/orgAclStore';
import { extractUserContext } from '../helpers/userContext';
import { sendErrorResponse } from '../helpers/errorResponse';
import { streamDefinitionArchive } from '../helpers/definitionArchive';
import { downloadRateLimiter } from '../../middleware/rateLimiter';
import {
  isStructuralFile,
  parseIntentDirPath,
  type AccountAgentsRouteContext,
} from './context';

export function registerDefinitionFileRoutes(
  router: Router,
  ctx: AccountAgentsRouteContext,
  upload: multer.Multer,
): void {
  const { deps, scopeRootsFor, orgGateFor, findViewableAgent } = ctx;

  // ── definition files ─────────────────────────────────────────────────────

  router.get('/:agentId/files', async (req: Request, res: Response) => {
    try {
      const found = findViewableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      // `readonly` is the CALLER's effective authority, mirroring the list
      // decoration: ACL-governed org agents resolve per caller — the
      // structural flag alone would tell every member the agent is editable.
      let readonly = found.scopeRoot.readonly;
      if (found.scopeRoot.aclGoverned) {
        const gate = await orgGateFor(req)();
        readonly = !canEditOrgResource(gate.records[req.params.agentId], gate.callerId, gate.liveRole);
      }
      res.json({
        tree: buildDefinitionTree(found.agentDir),
        scope: found.scopeRoot.scope,
        readonly,
      });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.get('/:agentId/file', (req: Request, res: Response) => {
    try {
      const found = findViewableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      let full: string;
      try {
        full = resolveDefinitionPath(found.agentDir, rel);
      } catch {
        // Traversal out of the agent dir is a caller error, not a server one
        // (this is what keeps the sibling agent-acl.json unreachable).
        return res.status(400).json({ error: `Invalid definition path: ${rel}` });
      }
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        return res.status(404).json({ error: `Definition file not found: ${rel}` });
      }
      // Same descriptor-bound ceiling as every other JSON file read: the whole
      // body is materialised into the API heap and the serializer, and the
      // whitelist admits `on-demand/**.json` of any size (a vendor swagger
      // dropped in verbatim). An authenticated route is not a budgeted one.
      const size = fs.statSync(full).size;
      if (size > FILE_READ_MAX_BYTES) {
        return res.status(413).json({
          error: `Definition file too large to open as text: ${rel} (limit ${FILE_READ_MAX_BYTES} bytes)`,
          code: 'FILE_TOO_LARGE',
        });
      }
      res.json({ path: rel, content: fs.readFileSync(full, 'utf-8') });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  /**
   * Whole-agent folder export — the mirror of `POST /import`. Any scope is
   * downloadable (readonly org/builtin agents are browseable, and this ships
   * exactly the bytes their file endpoints already serve); the archive admits
   * only `isAllowedDefinitionPath`, so the sibling `agent-acl.json` and any
   * future non-definition file in the tree stay out of it by default, and the
   * ZIP round-trips back through import with nothing skipped.
   */
  router.get('/:agentId/download', downloadRateLimiter, async (req: Request, res: Response) => {
    try {
      const found = findViewableAgent(res, scopeRootsFor(req), req.params.agentId);
      if (!found) return;
      const userContext = extractUserContext(req);
      await streamDefinitionArchive(res, {
        root: found.scopeRoot.root,
        dirName: req.params.agentId,
        admits: isAllowedDefinitionPath,
        stateStore: deps.stateStore,
        slotKey: `ant:slots:defzip:${userContext.organizationId}:${userContext.userId}`,
        component: 'AccountAgents',
      });
    } catch (error: any) {
      if (!res.headersSent) sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  // The single definition write funnel — raw editor AND structured form
  // sections both land here.
  router.put('/:agentId/file', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.body?.path || '');
      const content = req.body?.content;
      // Name the field that is missing. One message for both made a dropped
      // `path` read as a size/serialization problem, and the caller "fixed" it
      // by splitting the file across two PUTs — which overwrites, not appends.
      if (!rel) {
        return res.status(400).json({ error: 'path is required (the definition-relative file path to write)' });
      }
      if (typeof content !== 'string') {
        return res.status(400).json({
          error:
            content === undefined
              ? 'content is required (the file\'s full text — this route replaces the file, it never appends)'
              : `content must be a string (got: ${Array.isArray(content) ? 'array' : typeof content})`,
        });
      }
      const gate = gateDefinitionSave(req.params.agentId, rel, content, found.agentDir);
      if (!gate.ok) {
        return res.status(gate.status).json({ error: gate.error, code: 'definition-gate-failed' });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      // Report what this write replaced. A second PUT to one path is legitimate
      // (a shrinking rewrite is a normal edit) so it is never refused — but a
      // caller that believed it was appending has no other way to observe that
      // it destroyed the previous content.
      const replacedBytes = fs.existsSync(full) ? fs.statSync(full).size : 0;
      fs.writeFileSync(full, content, 'utf-8');
      const validation = validateDefinitionSave(scopeRootsFor(req), found.agentDir, req.params.agentId, rel);
      res.json({ success: true, validation, replacedBytes, newBytes: Buffer.byteLength(content, 'utf-8') });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/create', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.body?.path || '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      if (!isAllowedDefinitionPath(rel)) {
        return res.status(400).json({ error: definitionWhitelistGuidance(rel) });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      if (fs.existsSync(full)) {
        return res.status(409).json({ error: `Already exists: ${rel}` });
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '', { flag: 'wx' });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/mkdir', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.body?.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      const kind = classifyDefinitionDir(rel);
      if (kind === 'unknown') {
        return res.status(400).json({ error: definitionWhitelistGuidance(rel) });
      }
      // A job/intent directory is BORN by its own creator (POST /jobs, and the
      // intent's infer.md save) — mkdir must not become a second birth site.
      if (kind === 'job') {
        return res.status(400).json({ error: 'Create a job with POST /:agentId/jobs — it scaffolds job.yaml' });
      }
      if (kind === 'intent') {
        return res.status(400).json({ error: 'Create an intent by saving its infer.md — the directory follows' });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      if (fs.existsSync(full)) return res.status(409).json({ error: `Already exists: ${rel}` });
      fs.mkdirSync(full, { recursive: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/rename', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.body?.path || '').replace(/\\/g, '/');
      const newName = String(req.body?.newName || '');
      if (!rel) return res.status(400).json({ error: 'path is required' });
      if (!newName) return res.status(400).json({ error: 'newName is required' });
      if (newName.includes('/') || newName.includes('\\') || newName.startsWith('.')) {
        return res.status(400).json({ error: `Invalid name: ${newName}` });
      }
      // Intent rename = pure directory rename, server-side (no file declares
      // the id — the directory name IS the id). An FE create-new+delete-old
      // sequence would still trip the structural-file rules, and delete-first
      // loses data on failure.
      const intentDir = parseIntentDirPath(rel);
      if (intentDir) {
        if (!isValidCustomId(newName)) {
          return res.status(400).json({ error: `Intent id must be ${CUSTOM_ID_HINT} (got: ${newName})` });
        }
        if (newName === GENERAL_INTENT) {
          return res.status(400).json({
            error: `"${GENERAL_INTENT}" is the implicit fallback intent and cannot be declared`,
          });
        }
        const from = resolveDefinitionPath(found.agentDir, rel);
        const to = resolveDefinitionPath(found.agentDir, `jobs/${intentDir.jobId}/intents/${newName}`);
        if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
          return res.status(404).json({ error: `Intent directory not found: ${rel}` });
        }
        if (fs.existsSync(to)) {
          return res.status(409).json({ error: `Already exists: jobs/${intentDir.jobId}/intents/${newName}` });
        }
        fs.renameSync(from, to);
        return res.json({ success: true });
      }
      if (isStructuralFile(rel)) {
        return res.status(400).json({ error: `"${rel}" cannot be renamed — delete the agent/job/intent directory instead` });
      }
      const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const newRel = parentRel ? `${parentRel}/${newName}` : newName;
      if (!isAllowedDefinitionPath(newRel)) {
        return res.status(400).json({ error: `Target path is outside the definition whitelist: ${newRel}` });
      }
      const from = resolveDefinitionPath(found.agentDir, rel);
      const to = resolveDefinitionPath(found.agentDir, newRel);
      if (!fs.existsSync(from)) return res.status(404).json({ error: `Definition file not found: ${rel}` });
      if (fs.existsSync(to)) return res.status(409).json({ error: `Already exists: ${newRel}` });
      fs.renameSync(from, to);
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.delete('/:agentId/file', async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const rel = String(req.query.path || '');
      if (!rel) return res.status(400).json({ error: 'path query param is required' });
      if (isStructuralFile(rel)) {
        return res.status(400).json({ error: `"${rel}" cannot be deleted — delete the agent/job/intent directory instead` });
      }
      const full = resolveDefinitionPath(found.agentDir, rel);
      if (!fs.existsSync(full)) return res.status(404).json({ error: `Definition file not found: ${rel}` });
      fs.rmSync(full, { recursive: true, force: true });
      res.json({ success: true });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });

  router.post('/:agentId/files/upload', ...boundedMultipart(), upload.array('files'), async (req: Request, res: Response) => {
    try {
      const found = await findWritableAgent(res, scopeRootsFor(req), req.params.agentId, orgGateFor(req));
      if (!found) return;
      const files = (req.files as Express.Multer.File[]) || [];
      const rawRelPaths = req.body.relativePaths;
      const relativePaths: string[] = Array.isArray(rawRelPaths) ? rawRelPaths : rawRelPaths ? [rawRelPaths] : [];

      // Directory-unit upload = REPLACE: validate everything before the rm so a
      // rejected request never leaves a half-deleted directory behind.
      const replaceDir = String(req.body.replaceDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
      if (replaceDir) {
        if (!isAllowedDefinitionDir(replaceDir) || classifyDefinitionDir(replaceDir) === 'agent-root') {
          return res.status(400).json({ error: `Invalid replaceDir: ${replaceDir}` });
        }
        const outside = relativePaths.find((p) => !p.replace(/\\/g, '/').startsWith(`${replaceDir}/`));
        if (outside) {
          return res.status(400).json({ error: `Upload path outside replaceDir (${replaceDir}): ${outside}` });
        }
        fs.rmSync(resolveDefinitionPath(found.agentDir, replaceDir), { recursive: true, force: true });
      }

      const uploaded: string[] = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      for (let i = 0; i < files.length; i++) {
        const rel = (relativePaths[i] || files[i].originalname).replace(/\\/g, '/');
        if (!isAllowedDefinitionPath(rel)) {
          skipped.push({ path: rel, reason: 'outside the definition whitelist' });
          continue;
        }
        const full = resolveDefinitionPath(found.agentDir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, files[i].buffer.toString('utf-8'), 'utf-8');
        uploaded.push(rel);
      }
      res.json({ success: true, uploaded, skipped });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'AccountAgents');
    }
  });
}
