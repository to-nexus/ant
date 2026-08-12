/**
 * Credential isolation — the platform's own secrets must not reach a surface
 * the user controls.
 *
 * One axis, two sinks that share the failure shape ("forward everything we
 * hold"):
 *
 *   - child process env — preview/deploy runners spawn user-authored install
 *     scripts and dev commands, whose stdout/stderr is streamed back to the
 *     requester (report C-001 / C-003).
 *   - upstream proxy headers — the preview/deploy proxy forwards a victim's
 *     request into an attacker-authored dev server (report H-005).
 *
 * Assertions are on presence/absence of the credential, not on wording.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Request } from 'express';
import { composeChildEnv } from '../../src/core/config/childEnv.js';
import { buildCleanHeaders, buildForwardHeaders } from '../../src/periphery/adapters/http/middleware/proxyForwarding.js';

// ────────────────────────────────────────────────────────────────────────────
// Child process environment (C-003)
// ────────────────────────────────────────────────────────────────────────────

/** Service-held values whose disclosure is the finding. */
const SERVICE_SECRETS = [
  'JWT_SECRET',
  'ANT_JWT_SECRET',
  // A bare `GO` prefix in the toolchain allowlist matched this too (C-003).
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'ANT_ENCRYPTION_KEY',
  'ANT_SERVER_MODE',
  'REDIS_URL',
  'REDIS_PASSWORD',
  'AWS_SECRET_ACCESS_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'GITHUB_TOKEN',
];

/** Values a spawned toolchain genuinely needs. */
const REQUIRED_PASSTHROUGH = [
  'PATH',
  'HOME',
  'LANG',
  'NODE_OPTIONS',
  'npm_config_registry',
  'PNPM_HOME',
  'COREPACK_ENABLE_DOWNLOAD_PROMPT',
  'JAVA_HOME',
  'GOPATH',
  'GOFLAGS',
  'GOPROXY',
  'GOMODCACHE',
  'CARGO_HOME',
];

describe('preview/deploy child env is composed, not inherited (C-003)', () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  for (const name of SERVICE_SECRETS) {
    it(`drops ${name}`, () => {
      process.env[name] = 'service-secret-value';
      expect(composeChildEnv()[name]).toBeUndefined();
    });
  }

  for (const name of REQUIRED_PASSTHROUGH) {
    it(`keeps ${name}`, () => {
      process.env[name] = 'toolchain-value';
      expect(composeChildEnv()[name]).toBe('toolchain-value');
    });
  }

  it('keeps the project .env layer and caller overlays', () => {
    process.env.JWT_SECRET = 'nope';
    const env = composeChildEnv(
      { DATABASE_URL: 'postgres://project-owned' },
      { PORT: '3000' },
    );
    // A name that is a service secret in process.env is still legal when the
    // PROJECT supplies it — the project's own .env is the app's config.
    expect(env.DATABASE_URL).toBe('postgres://project-owned');
    expect(env.PORT).toBe('3000');
  });

  it('later overlays win over earlier ones', () => {
    expect(composeChildEnv({ NODE_ENV: 'development' }, { NODE_ENV: 'production' }).NODE_ENV)
      .toBe('production');
  });

  it('undefined overlay values do not create keys', () => {
    expect('MISSING' in composeChildEnv({ MISSING: undefined })).toBe(false);
  });

  it('ANT_PREVIEW_ENV_PASSTHROUGH forwards named extras only', () => {
    process.env.CUSTOM_HOST_VAR = 'wanted';
    process.env.OTHER_HOST_VAR = 'unwanted';
    process.env.ANT_PREVIEW_ENV_PASSTHROUGH = 'CUSTOM_HOST_VAR';
    const env = composeChildEnv();
    expect(env.CUSTOM_HOST_VAR).toBe('wanted');
    expect(env.OTHER_HOST_VAR).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Call sites (C-005 / H-009)
//
// The allowlist above is only worth what its callers use. The two dependency
// installs and the LLM command child each spawned with an inherited env while
// `composeChildEnv` sat right next to them, so these assert the env that
// reaches `spawn`, not the existence of the helper.
// ────────────────────────────────────────────────────────────────────────────

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn() };
});

describe('user-authored children spawn with a composed env, not an inherited one', () => {
  const SENTINELS = ['ANT_JWT_SECRET', 'ANTHROPIC_API_KEY', 'ANT_REDIS_URL'];
  let workspace: string;
  let spawnMock: Mock;

  /** A `spawn` that reports a clean exit on the next tick. */
  const fakeChild = () => {
    const handlers = new Map<string, (arg: unknown) => void>();
    setTimeout(() => handlers.get('close')?.(0), 0);
    return {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, cb: (arg: unknown) => void) => { handlers.set(event, cb); },
      kill: () => {},
    };
  };

  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-cred-'));
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'w', scripts: { build: 'true' }, dependencies: { vite: '5' } }),
    );
    for (const name of SENTINELS) process.env[name] = `leaked-${name}`;
    process.env.PATH = process.env.PATH || '/usr/bin';

    spawnMock = (await import('child_process')).spawn as unknown as Mock;
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeChild());
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    for (const name of SENTINELS) delete process.env[name];
  });

  const envOfCall = (index: number) => spawnMock.mock.calls[index][2]?.env as NodeJS.ProcessEnv;

  const expectNoSecrets = (env: NodeJS.ProcessEnv | undefined) => {
    expect(env).toBeDefined();
    for (const name of SENTINELS) expect(env![name]).toBeUndefined();
    expect(env!.PATH).toBeDefined(); // the toolchain still works
  };

  it('deploy root install (C-005)', async () => {
    const { installDeployDependencies } = await import('../../src/infrastructure/deploy/DeployWorkspace.js');
    await installDeployDependencies(workspace);
    expectNoSecrets(envOfCall(0));
  });

  it('per-package build install (C-005)', async () => {
    const { runBuild } = await import('../../src/infrastructure/deploy/BuildRunner.js');
    await runBuild(workspace, '/');
    expectNoSecrets(envOfCall(0)); // install
    expectNoSecrets(envOfCall(1)); // build
  });

  it('LLM run_command child (H-009)', async () => {
    const { cleanCommandEnv } = await import('../../src/periphery/adapters/command/NodeCommandAdapter.js');
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4100';

    const env = cleanCommandEnv();
    expectNoSecrets(env);
    // ant-cli internals stay stripped — the historical contract of this helper.
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.PORT).toBeUndefined();

    // an explicit caller overlay still wins
    expect(cleanCommandEnv({ CI: 'true', NODE_ENV: 'production' }).CI).toBe('true');
    expect(cleanCommandEnv({ NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Upstream proxy headers (H-005)
// ────────────────────────────────────────────────────────────────────────────

const PLATFORM_TOKEN = 'platform.jwt.value';
const PLATFORM = {
  cookieName: 'ant_session',
  isPlatformToken: (token: string) => token === PLATFORM_TOKEN,
};

function req(headers: Record<string, string>): Request {
  return { headers, url: '/index.html' } as unknown as Request;
}

describe('proxy withholds platform credentials from a user-controlled upstream (H-005)', () => {
  it('removes the platform session cookie', () => {
    const headers = buildCleanHeaders(
      req({ cookie: `ant_session=${PLATFORM_TOKEN}` }),
      '127.0.0.1',
      3000,
      undefined,
      PLATFORM,
    );
    expect(headers.cookie).toBeUndefined();
  });

  it("keeps the previewed app's own cookies", () => {
    const headers = buildCleanHeaders(
      req({ cookie: `ant_session=${PLATFORM_TOKEN}; app_sid=abc; theme=dark` }),
      '127.0.0.1',
      3000,
      undefined,
      PLATFORM,
    );
    expect(headers.cookie).toBe('app_sid=abc; theme=dark');
    expect(headers.cookie).not.toContain('ant_session');
  });

  it('leaves a cookie header with no platform cookie untouched', () => {
    const headers = buildCleanHeaders(
      req({ cookie: 'app_sid=abc' }),
      '127.0.0.1',
      3000,
      undefined,
      PLATFORM,
    );
    expect(headers.cookie).toBe('app_sid=abc');
  });

  it('removes a platform Bearer token', () => {
    const headers = buildCleanHeaders(
      req({ authorization: `Bearer ${PLATFORM_TOKEN}` }),
      '127.0.0.1',
      3000,
      undefined,
      PLATFORM,
    );
    expect(headers.authorization).toBeUndefined();
  });

  it("keeps the previewed app's own Bearer token", () => {
    const headers = buildCleanHeaders(
      req({ authorization: 'Bearer app-issued-token' }),
      '127.0.0.1',
      3000,
      undefined,
      PLATFORM,
    );
    expect(headers.authorization).toBe('Bearer app-issued-token');
  });

  it('keeps non-Bearer Authorization schemes', () => {
    const headers = buildCleanHeaders(
      req({ authorization: 'Basic dXNlcjpwYXNz' }),
      '127.0.0.1',
      3000,
      undefined,
      PLATFORM,
    );
    expect(headers.authorization).toBe('Basic dXNlcjpwYXNz');
  });

  it('without a filter nothing is stripped (local mode / non-proxy callers)', () => {
    const headers = buildCleanHeaders(
      req({ cookie: `ant_session=${PLATFORM_TOKEN}` }),
      '127.0.0.1',
      3000,
    );
    expect(headers.cookie).toBe(`ant_session=${PLATFORM_TOKEN}`);
  });

  it('peer forward KEEPS the cookie — the owner replica re-verifies ownership with it', () => {
    // Different sink, different contract: buildForwardHeaders targets another
    // ant-preview replica, not a user dev server. Stripping here would break
    // owner-forward auth.
    const headers = buildForwardHeaders(
      req({ cookie: `ant_session=${PLATFORM_TOKEN}`, host: 'preview.example.com' }),
    );
    expect(headers.cookie).toBe(`ant_session=${PLATFORM_TOKEN}`);
  });
});
