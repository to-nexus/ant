/**
 * Artifact transfer × project kind — the artifact-root seam
 * (`core/customAgents/artifactRoot.ts`) and its adoption by the transfer
 * service and routes.
 *
 * A universal (workspace) project has no `features/` plane. Before the seam,
 * transfer resolved every endpoint through `getFeaturePath`, so a workspace
 * destination minted a phantom `features/universal` directory and the panel
 * simply hid the affordance. Now every root goes through
 * `resolveArtifactRoot`, any-to-any is legal, and the reserved grafts of the
 * workspace tree are refused by the same predicate the artifacts router uses.
 *
 * Real `UnifiedWorkspaceResolver` on a tmpdir, stub state store (locks always
 * acquire; requests live in a Map).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { UNIVERSAL_FEATURE } from '@ant/shared';

import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import {
  isMoveProtectedRoot,
  reservedRootOf,
  resolveArtifactPath,
  resolveArtifactRoot,
} from '../../src/core/customAgents/artifactRoot';
import { ensureUniversalContainer } from '../../src/core/customAgents/universalContainer';
import { ArtifactTransferService } from '../../src/infrastructure/workspace/ArtifactTransferService';
import type { RedisStateStore } from '../../src/infrastructure/state/RedisStateStore';
import type { TransferRequest } from '../../src/core/types/transfer';
import type { UserContext } from '../../src/core/types/user';

const ORG = 'o1';
const SENDER = 'u1';
const RECIPIENT = 'u2';
const ctxOf = (userId: string): UserContext => ({ organizationId: ORG, userId });

function makeStateStore(): RedisStateStore {
  const requests = new Map<string, TransferRequest>();
  return {
    acquireLock: async () => true,
    releaseLock: async () => {},
    createTransferRequest: async (r: TransferRequest) => { requests.set(r.id, r); },
    getTransferRequest: async (id: string) => requests.get(id) ?? null,
    updateTransferRequestStatus: async (id: string, status: TransferRequest['status']) => {
      const r = requests.get(id);
      if (r) r.status = status;
    },
  } as unknown as RedisStateStore;
}

let tmpRoot: string;
let resolver: UnifiedWorkspaceResolver;
let service: ArtifactTransferService;

const userDir = (userId: string) => path.join(tmpRoot, ORG, userId);
const canonicalProject = (userId: string, id = 'cs') => path.join(userDir(userId), id);
const canonicalFeature = (userId: string, id = 'cs', feature = 'main') => path.join(canonicalProject(userId, id), 'features', feature);
const universalProject = (userId: string, id = 'ws') => path.join(userDir(userId), id);
const universalArtifacts = (userId: string, id = 'ws') => path.join(universalProject(userId, id), 'universal', 'artifacts');

async function seedCanonical(userId: string, id = 'cs') {
  const feature = canonicalFeature(userId, id);
  await fsp.mkdir(path.join(feature, 'plan'), { recursive: true });
  await fsp.mkdir(path.join(feature, 'architecture', 'system'), { recursive: true });
  await fsp.mkdir(path.join(feature, 'sessions'), { recursive: true });
  await fsp.writeFile(path.join(feature, 'plan', 'spec.md'), '# spec');
  await fsp.writeFile(path.join(feature, 'architecture', 'system', 'a.md'), '# a');
  await fsp.writeFile(path.join(feature, 'sessions', 'chat.jsonl'), '{}');
  await fsp.writeFile(path.join(canonicalProject(userId, id), 'config.json'), JSON.stringify({ repositoryName: id }));
}

/** `materialize:false` leaves the container to lazy creation. */
async function seedUniversal(userId: string, id = 'ws', materialize = true) {
  const project = universalProject(userId, id);
  await fsp.mkdir(project, { recursive: true });
  await fsp.writeFile(path.join(project, 'config.json'), JSON.stringify({ projectType: 'universal' }));
  if (!materialize) return;
  ensureUniversalContainer(project);
  const artifacts = universalArtifacts(userId, id);
  await fsp.mkdir(path.join(artifacts, 'architecture'), { recursive: true });
  await fsp.writeFile(path.join(artifacts, 'plan', 'notes.md'), '# notes');
  await fsp.writeFile(path.join(artifacts, 'architecture', 'x.md'), '# x');
  await fsp.writeFile(path.join(project, 'universal', 'sessions', 'chat.jsonl'), '{}');
}

const loc = (projectId: string, featureId: string, p: string) => ({ projectId, featureId, path: p });

async function expectTransferError(promise: Promise<unknown>, httpStatus: number, code: string) {
  await expect(promise).rejects.toMatchObject({ httpStatus, code });
}

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ant-transfer-root-'));
  resolver = new UnifiedWorkspaceResolver(tmpRoot);
  service = new ArtifactTransferService(resolver, makeStateStore());
  await seedCanonical(SENDER);
  await seedUniversal(SENDER);
});
afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('resolveArtifactRoot — truth table', () => {
  it('canonical project + feature → the feature dir', () => {
    const root = resolveArtifactRoot(resolver, ctxOf(SENDER), 'cs', 'main');
    expect(root).toEqual({ kind: 'canonical', root: canonicalFeature(SENDER), projectPath: canonicalProject(SENDER) });
  });

  it("universal project + 'universal' → {container}/artifacts", () => {
    const root = resolveArtifactRoot(resolver, ctxOf(SENDER), 'ws', UNIVERSAL_FEATURE);
    expect(root).toEqual({ kind: 'universal', root: universalArtifacts(SENDER), projectPath: universalProject(SENDER) });
  });

  it('universal project + any other feature id → null (no features plane)', () => {
    expect(resolveArtifactRoot(resolver, ctxOf(SENDER), 'ws', 'main')).toBeNull();
  });

  it('resolves a universal project whose container is not materialized yet', async () => {
    await seedUniversal(SENDER, 'fresh', false);
    const root = resolveArtifactRoot(resolver, ctxOf(SENDER), 'fresh', UNIVERSAL_FEATURE);
    expect(root?.kind).toBe('universal');
    expect(fs.existsSync(root!.root)).toBe(false);
  });

  it('a traversal-bearing project id → null, never a path outside the workspace', () => {
    expect(resolveArtifactRoot(resolver, ctxOf(SENDER), '../u2/cs', 'main')).toBeNull();
  });

  it('resolveArtifactPath throws when the relative path escapes the root', () => {
    const root = resolveArtifactRoot(resolver, ctxOf(SENDER), 'ws', UNIVERSAL_FEATURE)!;
    expect(() => resolveArtifactPath(root, '../sessions/chat.jsonl')).toThrow();
    expect(resolveArtifactPath(root, 'plan/notes.md')).toBe(path.join(root.root, 'plan', 'notes.md'));
  });
});

describe('reservedRootOf / isMoveProtectedRoot — per plane', () => {
  it.each([
    ['canonical', 'sessions/chat.jsonl', 'sessions'],
    ['canonical', 'plan/x.md', null],
    ['canonical', '_agents/a/agent.yaml', null],
    ['canonical', 'pipeline-runs/r1', null],
    ['universal', 'sessions', 'sessions'],
    ['universal', 'pipeline-runs/r1/log.md', 'pipeline-runs'],
    ['universal', '_agents/a/agent.yaml', '_agents'],
    ['universal', '_pipelines/p/pipeline.yaml', '_pipelines'],
    ['universal', 'artifacts/../sessions/chat.jsonl', 'sessions'],
    ['universal', '/sessions/x', 'sessions'],
    ['universal', 'plan/x.md', null],
    ['universal', 'sessions-notes/x.md', null],
    ['universal', '', null],
  ] as const)('%s %s → %s', (kind, rel, expected) => {
    expect(reservedRootOf(kind, rel)).toBe(expected);
  });

  it.each([
    ['canonical', 'plan', true],
    ['canonical', 'architecture/system', true],
    ['canonical', 'plan/spec.md', false],
    ['universal', 'plan', true],
    ['universal', 'plan/', true],
    ['universal', 'architecture', false],
    ['universal', 'plan/notes.md', false],
  ] as const)('move-protected %s %s → %s', (kind, rel, expected) => {
    expect(isMoveProtectedRoot(kind, rel)).toBe(expected);
  });
});

describe('transferOwn — any-to-any', () => {
  const noPhantom = (userId: string, id = 'ws') =>
    expect(fs.existsSync(path.join(universalProject(userId, id), 'features'))).toBe(false);

  it('canonical → canonical (baseline)', async () => {
    await seedCanonical(SENDER, 'cs2');
    const r = await service.transferOwn({
      userContext: ctxOf(SENDER),
      source: loc('cs', 'main', 'plan/spec.md'),
      destination: loc('cs2', 'main', 'plan/spec.md'),
      mode: 'copy',
    });
    expect(r.filesTransferred).toBe(1);
    expect(fs.existsSync(path.join(canonicalFeature(SENDER, 'cs2'), 'plan', 'spec.md'))).toBe(true);
  });

  it('universal → universal', async () => {
    await seedUniversal(SENDER, 'ws2');
    await service.transferOwn({
      userContext: ctxOf(SENDER),
      source: loc('ws', UNIVERSAL_FEATURE, 'architecture/x.md'),
      destination: loc('ws2', UNIVERSAL_FEATURE, 'architecture/x.md'),
      mode: 'copy',
    });
    expect(fs.existsSync(path.join(universalArtifacts(SENDER, 'ws2'), 'architecture', 'x.md'))).toBe(true);
    noPhantom(SENDER); noPhantom(SENDER, 'ws2');
  });

  it('canonical → universal lands under {container}/artifacts, materializing a lazy container', async () => {
    await seedUniversal(SENDER, 'fresh', false);
    const r = await service.transferOwn({
      userContext: ctxOf(SENDER),
      source: loc('cs', 'main', 'plan/spec.md'),
      destination: loc('fresh', UNIVERSAL_FEATURE, 'plan/spec.md'),
      mode: 'copy',
    });
    expect(r.filesTransferred).toBe(1);
    expect(fs.readFileSync(path.join(universalArtifacts(SENDER, 'fresh'), 'plan', 'spec.md'), 'utf-8')).toBe('# spec');
    noPhantom(SENDER, 'fresh');
  });

  it('universal → canonical (directory merge) — the sessions graft never rides along', async () => {
    const r = await service.transferOwn({
      userContext: ctxOf(SENDER),
      source: loc('ws', UNIVERSAL_FEATURE, 'architecture'),
      destination: loc('cs', 'main', 'architecture'),
      mode: 'copy',
    });
    expect(r.filesTransferred).toBe(1);
    expect(fs.existsSync(path.join(canonicalFeature(SENDER), 'architecture', 'x.md'))).toBe(true);
    // pre-existing content survives the merge
    expect(fs.existsSync(path.join(canonicalFeature(SENDER), 'architecture', 'system', 'a.md'))).toBe(true);
    noPhantom(SENDER);
  });

  it("a universal project addressed with a feature id other than 'universal' is not found", async () => {
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('ws', 'main', 'plan/notes.md'),
        destination: loc('cs', 'main', 'plan/notes.md'),
        mode: 'copy',
      }),
      404, 'SOURCE_NOT_FOUND',
    );
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('cs', 'main', 'plan/spec.md'),
        destination: loc('ws', 'main', 'plan/spec.md'),
        mode: 'copy',
      }),
      404, 'DEST_FEATURE_NOT_FOUND',
    );
    noPhantom(SENDER);
  });
});

describe('transferOwn — reserved roots are refused before any I/O', () => {
  it.each([
    ['sessions/chat.jsonl', 'SESSION_PATH_BLOCKED'],
    ['artifacts/../sessions/chat.jsonl', 'SESSION_PATH_BLOCKED'],
    ['pipeline-runs/r1', 'RESERVED_PATH_BLOCKED'],
    ['_agents/payments-ops/agent.yaml', 'RESERVED_PATH_BLOCKED'],
    ['_pipelines/nightly/pipeline.yaml', 'RESERVED_PATH_BLOCKED'],
  ])('universal source %s → 400 %s', async (rel, code) => {
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('ws', UNIVERSAL_FEATURE, rel),
        destination: loc('cs', 'main', rel),
        mode: 'copy',
      }),
      400, code,
    );
  });

  it('universal destination under a reserved root → 400 RESERVED_PATH_BLOCKED', async () => {
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('cs', 'main', 'plan/spec.md'),
        destination: loc('ws', UNIVERSAL_FEATURE, '_agents/spec.md'),
        mode: 'copy',
      }),
      400, 'RESERVED_PATH_BLOCKED',
    );
    expect(fs.existsSync(path.join(universalArtifacts(SENDER), '_agents'))).toBe(false);
  });

  it('canonical plane reserves only sessions — `_agents/…` is an ordinary (missing) path there', async () => {
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('cs', 'main', 'sessions/chat.jsonl'),
        destination: loc('ws', UNIVERSAL_FEATURE, 'plan/chat.jsonl'),
        mode: 'copy',
      }),
      400, 'SESSION_PATH_BLOCKED',
    );
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('cs', 'main', '_agents/x.md'),
        destination: loc('ws', UNIVERSAL_FEATURE, 'plan/x.md'),
        mode: 'copy',
      }),
      404, 'SOURCE_NOT_FOUND',
    );
  });
});

describe('transferOwn — move protection per plane', () => {
  it('plan cannot be moved on either plane', async () => {
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('cs', 'main', 'plan'),
        destination: loc('ws', UNIVERSAL_FEATURE, 'plan'),
        mode: 'move',
      }),
      400, 'MOVE_CANONICAL_BLOCKED',
    );
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('ws', UNIVERSAL_FEATURE, 'plan'),
        destination: loc('cs', 'main', 'plan'),
        mode: 'move',
      }),
      400, 'MOVE_CANONICAL_BLOCKED',
    );
    expect(fs.existsSync(path.join(universalArtifacts(SENDER), 'plan', 'notes.md'))).toBe(true);
  });

  it('a user-created universal dir (architecture) moves whole — no canonical skeleton to preserve', async () => {
    await seedUniversal(SENDER, 'ws2');
    await service.transferOwn({
      userContext: ctxOf(SENDER),
      source: loc('ws', UNIVERSAL_FEATURE, 'architecture'),
      destination: loc('ws2', UNIVERSAL_FEATURE, 'moved/architecture'),
      mode: 'move',
    });
    expect(fs.existsSync(path.join(universalArtifacts(SENDER), 'architecture'))).toBe(false);
    expect(fs.existsSync(path.join(universalArtifacts(SENDER, 'ws2'), 'moved', 'architecture', 'x.md'))).toBe(true);
  });

  it('nested canonical dirs (architecture/system) are move-protected too', async () => {
    await expectTransferError(
      service.transferOwn({
        userContext: ctxOf(SENDER),
        source: loc('cs', 'main', 'architecture/system'),
        destination: loc('ws', UNIVERSAL_FEATURE, 'architecture/system'),
        mode: 'move',
      }),
      400, 'MOVE_CANONICAL_BLOCKED',
    );
  });

  it('a user-created subdir of the canonical plane moves its contents to the workspace', async () => {
    await fsp.mkdir(path.join(canonicalFeature(SENDER), 'architecture', 'notes'), { recursive: true });
    await fsp.writeFile(path.join(canonicalFeature(SENDER), 'architecture', 'notes', 'n.md'), '# n');
    await service.transferOwn({
      userContext: ctxOf(SENDER),
      source: loc('cs', 'main', 'architecture/notes'),
      destination: loc('ws', UNIVERSAL_FEATURE, 'architecture/notes'),
      mode: 'move',
    });
    expect(fs.existsSync(path.join(canonicalFeature(SENDER), 'architecture', 'notes', 'n.md'))).toBe(false);
    expect(fs.existsSync(path.join(universalArtifacts(SENDER), 'architecture', 'notes', 'n.md'))).toBe(true);
  });
});

describe('cross-user request → approve lands in the recipient container', () => {
  it('canonical sender → lazy universal recipient destination', async () => {
    await fsp.mkdir(userDir(RECIPIENT), { recursive: true });
    await seedUniversal(RECIPIENT, 'ws', false);

    const request = await service.requestTransfer({
      sender: { orgId: ORG, userId: SENDER },
      recipient: { orgId: ORG, userId: RECIPIENT },
      source: loc('cs', 'main', 'plan/spec.md'),
      destination: loc('ws', UNIVERSAL_FEATURE, 'plan/spec.md'),
    });
    expect(request.status).toBe('pending');

    const resolved = await service.resolveTransfer(request.id, 'approve', RECIPIENT, ORG);
    expect(resolved.status).toBe('approved');
    expect(fs.readFileSync(path.join(universalArtifacts(RECIPIENT), 'plan', 'spec.md'), 'utf-8')).toBe('# spec');
    expect(fs.existsSync(path.join(universalProject(RECIPIENT), 'features'))).toBe(false);
  });

  it('request refuses a reserved recipient root with the recipient plane verdict', async () => {
    await fsp.mkdir(userDir(RECIPIENT), { recursive: true });
    await seedUniversal(RECIPIENT, 'ws');
    await expectTransferError(
      service.requestTransfer({
        sender: { orgId: ORG, userId: SENDER },
        recipient: { orgId: ORG, userId: RECIPIENT },
        source: loc('cs', 'main', 'plan/spec.md'),
        destination: loc('ws', UNIVERSAL_FEATURE, 'pipeline-runs/spec.md'),
      }),
      400, 'RESERVED_PATH_BLOCKED',
    );
  });
});

describe('structural — the seam is the only root resolution', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

  it.each([
    'src/infrastructure/workspace/ArtifactTransferService.ts',
    'src/periphery/adapters/http/routes/transfer.routes.ts',
  ])('%s never calls getFeaturePath directly', (file) => {
    expect(read(file)).not.toMatch(/getFeaturePath\(/);
    expect(read(file)).toMatch(/resolveArtifactRoot\(/);
  });

  it('the universal artifacts router takes its reserved-root verdict from the seam', () => {
    expect(read('src/periphery/adapters/http/routes/customAgents.routes.ts')).toMatch(/reservedRootOf\(/);
  });
});
