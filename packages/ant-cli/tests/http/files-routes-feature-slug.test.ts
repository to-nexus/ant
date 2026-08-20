/**
 * Regression: file content read/write for SLASH-NAMED features.
 *
 * A feature name may contain `/` (git-style branch, e.g. `feature/base`). On
 * the wire it travels as a `/`-free slug (`feature~base`) via
 * `featureNameToSlug`. The file-tree route uses a NAMED `:feature` param, so
 * `router.param` decodes the slug back to the raw name — but the file CONTENT
 * routes (`files-raw` GET, content GET, content PUT) are REGEX routes reading
 * `req.params[1]` positionally, and `router.param` never fires for regex
 * capture groups. Before the fix the undecoded `~`-slug reached
 * `buildFeaturePath`, which throws `"expects a raw feature name, got a slug"`
 * → HTTP 500. Net effect: the file listed in the tree but opened EMPTY and
 * could not be saved (persisted across refresh).
 *
 * This test drives the REAL `FileOperationService` + `UnifiedWorkspaceResolver`
 * (not a stubbed `getFeaturePath`) so the slug actually reaches
 * `buildFeaturePath` — the only faithful way to reproduce the defect.
 *
 * No supertest: a real Express app + node:http on port 0, called via fetch
 * (mirrors tests/http/featureJobsRoute.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';

import { createFilesRoutes } from '../../src/periphery/adapters/http/routes/files.routes';
import { decodeFeatureSegment } from '../../src/periphery/adapters/http/routes/helpers/featureParam';
import {
  UnifiedWorkspaceResolver,
  buildFeaturePath,
} from '../../src/core/config/WorkspacePathResolver';
import { FileOperationService } from '../../src/periphery/adapters/http/services/ProjectService/FileOperationService';

const SLASH_FEATURE = 'feature/base';
const SLASH_SLUG = 'feature~base'; // featureNameToSlug('feature/base')
const PROJECT_ID = 'p1';
const ORG = 'o1';
const USER = 'u1';

describe('files.routes — slash-named feature content round-trip', () => {
  let tmpWorkspaces: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tmpWorkspaces = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-files-slug-'));

    const resolver = new UnifiedWorkspaceResolver(tmpWorkspaces);
    const fileOps = new FileOperationService(resolver);

    // Minimal projectService shape the routes consume: readFile / writeFile +
    // the `workspaceResolver` accessed via `(deps.projectService as any)`.
    const projectService = {
      readFile: fileOps.readFile.bind(fileOps),
      writeFile: fileOps.writeFile.bind(fileOps),
      // The mutation/read gate only needs a truthy authoritative reference here;
      // this test exercises slug round-tripping, not the feature lifecycle.
      resolveExistingFeatureForMutation: async () => tmpWorkspaces,
      workspaceResolver: resolver,
    } as any;

    const app = express();
    app.use(express.json());
    // Force a deterministic tenant via the JWT path so extractUserContext does
    // not fall back to filesystem inference against the real dev workspace.
    app.use((req, _res, next) => {
      (req as any).user = { id: USER };
      (req as any).organization = { id: ORG, kind: 'team' };
      next();
    });
    app.use(createFilesRoutes({ projectService }));

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpWorkspaces, { recursive: true, force: true });
  });

  it('decodeFeatureSegment recovers the raw name; buildFeaturePath rejects the raw slug', () => {
    expect(decodeFeatureSegment(SLASH_SLUG)).toBe(SLASH_FEATURE);
    const projectPath = path.join(tmpWorkspaces, ORG, USER, PROJECT_ID);
    // The undecoded slug is exactly what used to reach buildFeaturePath → throw.
    expect(() => buildFeaturePath(projectPath, SLASH_SLUG)).toThrow();
    // The decoded raw name resolves cleanly.
    expect(() => buildFeaturePath(projectPath, SLASH_FEATURE)).not.toThrow();
  });

  it('PUT then GET a doc in a slash-named feature preserves content (no 500)', async () => {
    const filePath = 'plan/prd.md';
    const content = '# PRD\n\nTransferred document body.\n';

    const putRes = await fetch(
      `${baseUrl}/projects/${PROJECT_ID}/features/${SLASH_SLUG}/files/${filePath}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      },
    );
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.content).toBeTruthy();

    const getRes = await fetch(
      `${baseUrl}/projects/${PROJECT_ID}/features/${SLASH_SLUG}/files/${filePath}`,
    );
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    // Round-trip: read-back equals what write persisted (robust to plan/ template
    // normalization applied inside writeFile).
    expect(getBody.content).toBe(putBody.content);
    expect(getBody.content).toContain('Transferred document body.');
    expect(getBody.featureName).toBe(SLASH_FEATURE);

    // The file physically lands under the SLUG directory segment.
    const onDisk = await fs.readFile(
      path.join(tmpWorkspaces, ORG, USER, PROJECT_ID, 'features', SLASH_SLUG, filePath),
      'utf-8',
    );
    expect(onDisk).toBe(getBody.content);
  });

  it('files-raw GET serves bytes for a slash-named feature (no 500)', async () => {
    const filePath = 'plan/note.md';
    const content = 'raw bytes for slash feature';

    // Seed directly on disk (under the SLUG segment) to bypass extension policy.
    const abs = path.join(
      tmpWorkspaces, ORG, USER, PROJECT_ID, 'features', SLASH_SLUG, filePath,
    );
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf-8');

    const rawRes = await fetch(
      `${baseUrl}/projects/${PROJECT_ID}/features/${SLASH_SLUG}/files-raw/${filePath}`,
    );
    expect(rawRes.status).toBe(200);
    expect(await rawRes.text()).toBe(content);
  });
});
