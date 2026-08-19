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
import { composeChildEnv, composeCommandChildEnv } from '../../src/core/config/childEnv.js';
import { buildCleanHeaders, buildForwardHeaders } from '../../src/periphery/adapters/http/middleware/proxyForwarding.js';
import { rewriteUpgradeHeaders, buildPeerForwardUpgradeHeaders } from '../../src/infrastructure/preview/PreviewServer.js';

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

  // M-013 / M-014: the toolchain prefixes are a NAMESPACE allowlist, and
  // package managers keep registry credentials in that same namespace.
  const REGISTRY_CREDENTIALS = [
    'NODE_AUTH_TOKEN',          // rides NODE_
    'YARN_NPM_AUTH_TOKEN',      // rides YARN_
    'NPM_CONFIG__AUTH',         // rides NPM_CONFIG_
    'NPM_CONFIG__AUTHTOKEN',
    'npm_config__authToken',    // rides npm_
    'PIP_INDEX_PASSWORD',       // rides PIP_
    'CARGO_REGISTRY_TOKEN',     // rides CARGO_
    'GRADLE_PUBLISH_SECRET',    // rides GRADLE_
  ];

  for (const name of REGISTRY_CREDENTIALS) {
    it(`drops credential-shaped ${name} despite its toolchain prefix`, () => {
      process.env[name] = 'registry-credential';
      expect(composeChildEnv()[name]).toBeUndefined();
    });
  }

  it('keeps non-secret toolchain variables that merely look adjacent', () => {
    process.env.NPM_CONFIG_REGISTRY = 'https://registry.example.com';
    process.env.PIP_INDEX_URL = 'https://pypi.example.com/simple';
    process.env.NODE_EXTRA_CA_CERTS = '/etc/ssl/ca.pem';
    const env = composeChildEnv();
    expect(env.NPM_CONFIG_REGISTRY).toBe('https://registry.example.com');
    expect(env.PIP_INDEX_URL).toBe('https://pypi.example.com/simple');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/ca.pem');
  });

  // M-015: the escape hatch must not be able to re-open the hole the allowlist
  // closed. An operator naming a live secret gets it dropped anyway.
  for (const name of ['ANT_JWT_SECRET', 'ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_SECRET']) {
    it(`ANT_PREVIEW_ENV_PASSTHROUGH cannot re-admit ${name}`, () => {
      process.env[name] = 'live-secret';
      process.env.ANT_PREVIEW_ENV_PASSTHROUGH = name;
      expect(composeChildEnv()[name]).toBeUndefined();
    });
  }

  // M-015: the credential-marker test is a name-SHAPE test, and a live connection
  // credential need not look like one — `ANT_REDIS_URL` carries the platform's
  // data-plane authority with no TOKEN/SECRET/AUTH in its name. Two namespaces are
  // therefore closed by name, passthrough included.
  const SERVICE_OWNED_MARKERLESS = [
    'ANT_REDIS_URL',
    'ANT_WORKSPACE_BASE_PATH',
    'ANT_API_URL',
    'REDIS_URL',
    'DATABASE_URL',
    'MONGODB_URI',
    'AMQP_URL',
  ];

  for (const name of SERVICE_OWNED_MARKERLESS) {
    it(`ANT_PREVIEW_ENV_PASSTHROUGH cannot admit service-owned ${name}`, () => {
      process.env[name] = 'redis://user:pass@service-host:6379';
      process.env.ANT_PREVIEW_ENV_PASSTHROUGH = name;
      expect(composeChildEnv()[name]).toBeUndefined();
      expect(composeCommandChildEnv()[name]).toBeUndefined();
    });
  }

  // The project's OWN `.env` is a different channel: those values are user-owned
  // and must keep working even when the name matches the inherited denylist.
  it('a project .env overlay still supplies its own DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://service-owned/db';
    const env = composeChildEnv({ DATABASE_URL: 'postgres://localhost/app' });
    expect(env.DATABASE_URL).toBe('postgres://localhost/app');
  });

  // M-NEW-001 defence in depth: the PAT rides `GIT_CONFIG_KEY_0`, which is passed
  // deliberately to the credentialed acquire step and must never be inherited.
  it('drops GIT_CONFIG_* from the inherited environment', () => {
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'url.https://ghp_live@github.com/.insteadOf';
    process.env.ANT_PREVIEW_ENV_PASSTHROUGH = 'GIT_CONFIG_KEY_0,GIT_CONFIG_COUNT';
    const env = composeChildEnv();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(env.GIT_CONFIG_COUNT).toBeUndefined();
  });

  // M-014: the code-job command profile shares every rule EXCEPT the preview
  // passthrough. `run_command` stdout reaches the requester's chat card and the
  // next LLM turn's tool_result history — a sink the operator never opted into.
  describe('command profile ignores the preview passthrough (M-014)', () => {
    it('does not forward a passthrough-named host variable', () => {
      process.env.CUSTOM_HOST_VAR = 'wanted-by-dev-server';
      process.env.ANT_PREVIEW_ENV_PASSTHROUGH = 'CUSTOM_HOST_VAR';
      expect(composeChildEnv().CUSTOM_HOST_VAR).toBe('wanted-by-dev-server');
      expect(composeCommandChildEnv().CUSTOM_HOST_VAR).toBeUndefined();
    });

    it('still forwards the shared toolchain allowlist', () => {
      process.env.NODE_OPTIONS = '--max-old-space-size=512';
      process.env.GOFLAGS = '-mod=mod';
      const env = composeCommandChildEnv();
      expect(env.NODE_OPTIONS).toBe('--max-old-space-size=512');
      expect(env.GOFLAGS).toBe('-mod=mod');
      expect(env.PATH).toBeDefined();
    });

    it('still drops every service secret', () => {
      for (const name of SERVICE_SECRETS) process.env[name] = 'live-secret';
      const env = composeCommandChildEnv();
      for (const name of SERVICE_SECRETS) expect(env[name]).toBeUndefined();
    });
  });

  // M-013 / M-015: blocking names is not enough — `$HOME/.npmrc`, `~/.aws` and
  // `~/.ssh` are read from the filesystem by the same user-authored scripts.
  describe('child HOME is not the service account HOME', () => {
    it('points HOME at a workspace-scoped directory', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-childhome-'));
      try {
        process.env.ANT_WORKSPACE_BASE_PATH = base;
        delete process.env.ANT_CHILD_HOME;
        process.env.HOME = '/home/ant-service';
        const env = composeChildEnv();
        expect(env.HOME).not.toBe('/home/ant-service');
        expect(env.HOME!.startsWith(base)).toBe(true);
        expect(fs.existsSync(env.HOME!)).toBe(true);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });

    it('honours an explicit ANT_CHILD_HOME', () => {
      process.env.ANT_CHILD_HOME = '/tmp/explicit-child-home';
      expect(composeChildEnv().HOME).toBe('/tmp/explicit-child-home');
    });

    it('an empty ANT_CHILD_HOME opts out and keeps the service HOME', () => {
      process.env.ANT_CHILD_HOME = '';
      process.env.HOME = '/home/ant-service';
      expect(composeChildEnv().HOME).toBe('/home/ant-service');
    });

    it('a caller overlay still wins over the derived HOME', () => {
      process.env.ANT_CHILD_HOME = '/tmp/explicit-child-home';
      expect(composeChildEnv({ HOME: '/tmp/caller' }).HOME).toBe('/tmp/caller');
    });
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

  // The WebSocket branch is a second, independent sink onto the same
  // user-authored upstream. It replayed rawHeaders verbatim, so the HTTP-side
  // policy above never applied to it (H-005).
  describe('the WebSocket upgrade applies the same policy', () => {
    const pairs = (headers: Record<string, string>) =>
      Object.entries(headers).flatMap(([k, v]) => [k, v]);

    const rewrite = (headers: Record<string, string>) =>
      rewriteUpgradeHeaders(pairs(headers), 3000, PLATFORM).join('\r\n');

    it('removes the platform session cookie', () => {
      expect(rewrite({ Cookie: `ant_session=${PLATFORM_TOKEN}` })).not.toContain('ant_session');
    });

    it("keeps the upstream app's own cookies", () => {
      const out = rewrite({ Cookie: `ant_session=${PLATFORM_TOKEN}; app_sid=abc` });
      expect(out).toContain('app_sid=abc');
      expect(out).not.toContain('ant_session');
    });

    it('removes a platform bearer token', () => {
      expect(rewrite({ Authorization: `Bearer ${PLATFORM_TOKEN}` })).not.toContain(PLATFORM_TOKEN);
    });

    it("keeps a non-platform bearer and other auth schemes", () => {
      expect(rewrite({ Authorization: 'Bearer app-own-token' })).toContain('app-own-token');
      expect(rewrite({ Authorization: 'Basic dXNlcjpwdw==' })).toContain('Basic dXNlcjpwdw==');
    });

    it('preserves the WebSocket handshake headers and rewrites Host/Origin', () => {
      const out = rewrite({
        Host: 'preview.example.com',
        Origin: 'https://preview.example.com',
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      });
      expect(out).toContain('Upgrade: websocket');
      expect(out).toContain('Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==');
      expect(out).toContain(`Host: localhost:3000`);
      expect(out).toContain(`Origin: http://localhost:3000`);
    });

    it('peer forward KEEPS the cookie for the owner replica hop', () => {
      const out = buildPeerForwardUpgradeHeaders(
        pairs({ Cookie: `ant_session=${PLATFORM_TOKEN}` }),
      ).join('\r\n');
      expect(out).toContain('ant_session');
    });
  });
});
