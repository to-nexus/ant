/**
 * Mount-namespace isolation of user-authored children — the boundary that
 * makes `/vault`, other tenants' workspaces and `/etc` NOT EXIST for a child,
 * whatever it runs (2026-09 report: `cp /vault/secrets/set-env.sh <artifacts>/`).
 *
 * Axes: mode resolution (env × server mode), the binding rules (pure over a
 * fake host, so they run on macOS), the fail-closed refusals, the shell
 * composition of the funnel, and — where a Linux box has bwrap — the live
 * invisibility of an unbound path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  childSandboxMode,
  composeSandboxArgs,
  wrapChildInSandbox,
  spawnUserChild,
  serviceCodeRoot,
  __testing,
  type SandboxHost,
} from '../../src/core/config/childSandbox.js';

const ENV_KEYS = [
  'ANT_CHILD_SANDBOX', 'ANT_SERVER_MODE', 'ANT_CHILD_UID', 'ANT_CHILD_GID',
  'ANT_CHILD_HOME', 'ANT_WORKSPACE_BASE_PATH', 'ANT_WORKSPACES_ROOT',
  'ANT_CHILD_SANDBOX_RW', 'ANT_CHILD_SANDBOX_RO',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  __testing.reset();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

/** A host with a fixed directory table — no disk involved. */
function fakeHost(entries: Record<string, 'dir' | 'file' | { symlink: string }>): SandboxHost {
  return {
    kind: (p) => {
      const e = entries[p];
      if (!e) return null;
      return typeof e === 'string' ? e : 'symlink';
    },
    readlink: (p) => {
      const e = entries[p];
      if (!e || typeof e === 'string') throw new Error(`not a symlink: ${p}`);
      return e.symlink;
    },
    realpath: (p) => p,
  };
}

// Pinned, not derived from process.execPath: a CI runner keeps node under
// /opt — already a system read-only root — so the composer legitimately
// omits it and a derived value would test the runner, not the rule.
const NODE_PREFIX = '/srv/node';

function pairs(args: string[], flag: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push([args[i + 1], args[i + 2]]);
  return out;
}
const bindsOf = (args: string[]) => pairs(args, '--bind').map(([s]) => s);
const roBindsOf = (args: string[]) => pairs(args, '--ro-bind').map(([s]) => s);

describe('childSandboxMode — env × server mode', () => {
  it.each([
    [undefined, 'cloud', 'on'],
    [undefined, 'local', 'off'],
    [undefined, undefined, 'off'],
    ['off', 'cloud', 'off'],
    ['on', 'local', 'on'],
    ['1', undefined, 'on'],
    ['false', 'cloud', 'off'],
    ['garbage', 'cloud', 'on'],
    ['garbage', 'local', 'off'],
  ] as const)('ANT_CHILD_SANDBOX=%s × ANT_SERVER_MODE=%s → %s', (value, mode, expected) => {
    if (value !== undefined) process.env.ANT_CHILD_SANDBOX = value;
    if (mode !== undefined) process.env.ANT_SERVER_MODE = mode;
    expect(childSandboxMode()).toBe(expected);
  });
});

describe('composeSandboxArgs — what a child can and cannot see', () => {
  const host = fakeHost({
    '/usr': 'dir',
    '/bin': { symlink: 'usr/bin' },
    '/lib': { symlink: 'usr/lib' },
    '/lib64': 'dir',
    '/opt': 'dir',
    '/etc/ssl': 'dir',
    '/etc/resolv.conf': 'file',
    '/etc/passwd': 'file',
    '/etc/os-release': { symlink: '../usr/lib/os-release' },
    '/etc/shadow': 'file',
    '/etc/environment': 'file',
    '/vault/secrets/set-env.sh': 'file',
    '/vault/secrets': 'dir',
    '/vault': 'dir',
    '/data/workspaces': 'dir',
    '/data/workspaces/.ant-child-home': 'dir',
    '/data/workspaces/individual/me/proj': 'dir',
    '/data/workspaces/individual/me/proj/pkg': 'dir',
    '/data/workspaces/individual/other/proj': 'dir',
    '/home/ant/go': 'dir',
    '/usr/local/cargo': 'dir',
    '/root/.local/share/mise/shims': 'dir',
    [NODE_PREFIX]: 'dir',
    '/opt/hostedtoolcache/node/x64': 'dir',
    '/app': 'dir',
    '/tmp/w/inside': 'dir',
  });
  const tenant = '/data/workspaces/individual/me/proj';

  it('binds only the named tenant root read-write, never a sibling tenant', () => {
    const args = composeSandboxArgs({ rwRoots: [tenant], workingDir: tenant, env: {} }, host);
    expect(bindsOf(args)).toEqual([tenant]);
    expect(args.join(' ')).not.toContain('/individual/other');
    expect(args.join(' ')).not.toContain('/vault');
  });

  it('binds the system toolchain read-only and replicates merged-usr symlinks', () => {
    const args = composeSandboxArgs({ rwRoots: [tenant], workingDir: tenant, env: {} }, host);
    expect(roBindsOf(args)).toEqual(expect.arrayContaining(['/usr', '/lib64', '/opt', '/etc/ssl', '/etc/resolv.conf', '/etc/passwd']));
    expect(pairs(args, '--symlink')).toEqual(expect.arrayContaining([['usr/bin', '/bin'], ['usr/lib', '/lib'], ['../usr/lib/os-release', '/etc/os-release']]));
  });

  it('never binds /etc itself — shadow and environment are absent', () => {
    const args = composeSandboxArgs({ rwRoots: [tenant], workingDir: tenant, env: {} }, host);
    expect(roBindsOf(args)).not.toContain('/etc');
    expect(args.join(' ')).not.toMatch(/\/etc\/(shadow|environment)\b/);
  });

  it('unshares pid/ipc/uts/user, keeps the network, dies with the parent, mounts a fresh /proc', () => {
    const args = composeSandboxArgs({ rwRoots: [tenant], workingDir: tenant, env: {} }, host);
    for (const flag of ['--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--die-with-parent']) {
      expect(args).toContain(flag);
    }
    expect(args).not.toContain('--unshare-net');
    expect(args).not.toContain('--unshare-all');
    expect(pairs(args, '--proc')).toEqual([['/proc', expect.anything()]].map(([p]) => [p, args[args.indexOf('--proc') + 2]]));
    expect(args.slice(-2)).toEqual(['--chdir', tenant]);
  });

  it('tmpfs /tmp is mounted BEFORE a writable root under /tmp, so the root is not masked', () => {
    const args = composeSandboxArgs({ rwRoots: ['/tmp/w/inside'], workingDir: '/tmp/w/inside', env: {} }, host);
    const tmpfsAt = args.findIndex((a, i) => a === '--tmpfs' && args[i + 1] === '/tmp');
    const bindAt = args.findIndex((a, i) => a === '--bind' && args[i + 1] === '/tmp/w/inside');
    expect(tmpfsAt).toBeGreaterThanOrEqual(0);
    expect(bindAt).toBeGreaterThan(tmpfsAt);
  });

  it('a nested writable root is not bound twice; a read-only root under a writable one is skipped', () => {
    const args = composeSandboxArgs(
      { rwRoots: [tenant, `${tenant}/pkg`], roRoots: [`${tenant}/pkg`], workingDir: `${tenant}/pkg`, env: {} },
      host,
    );
    expect(bindsOf(args)).toEqual([tenant]);
    expect(roBindsOf(args)).not.toContain(`${tenant}/pkg`);
  });

  it('the isolated child HOME rides along read-write; the service HOME becomes an empty tmpfs', () => {
    process.env.ANT_CHILD_HOME = '/data/workspaces/.ant-child-home';
    const isolated = composeSandboxArgs(
      { rwRoots: [tenant], workingDir: tenant, env: { HOME: '/data/workspaces/.ant-child-home' } },
      host,
    );
    expect(bindsOf(isolated)).toContain('/data/workspaces/.ant-child-home');
    expect(pairs(isolated, '--tmpfs').map(([p]) => p)).not.toContain('/data/workspaces/.ant-child-home');

    const inherited = composeSandboxArgs({ rwRoots: [tenant], workingDir: tenant, env: { HOME: '/home/ant' } }, host);
    expect(pairs(inherited, '--tmpfs').map(([p]) => p)).toContain('/home/ant');
    expect(bindsOf(inherited)).not.toContain('/home/ant');
  });

  it('toolchain caches the composed env points at are writable; PATH entries and the node prefix are read-only', () => {
    const args = composeSandboxArgs(
      {
        rwRoots: [tenant],
        workingDir: tenant,
        env: { GOPATH: '/home/ant/go', CARGO_HOME: '/usr/local/cargo', PATH: '/root/.local/share/mise/shims:/usr/bin:/nonexistent/bin' },
        nodePrefix: NODE_PREFIX,
      },
      host,
    );
    expect(bindsOf(args)).toEqual(expect.arrayContaining(['/home/ant/go', '/usr/local/cargo']));
    expect(roBindsOf(args)).toContain('/root/.local/share/mise/shims');
    expect(roBindsOf(args)).toContain(NODE_PREFIX);
    expect(args.join(' ')).not.toContain('/nonexistent/bin');

    // A node prefix already inside a system read-only root is not re-emitted.
    const underOpt = composeSandboxArgs(
      { rwRoots: [tenant], workingDir: tenant, env: {}, nodePrefix: '/opt/hostedtoolcache/node/x64' },
      host,
    );
    expect(roBindsOf(underOpt)).toContain('/opt');
    expect(roBindsOf(underOpt)).not.toContain('/opt/hostedtoolcache/node/x64');
  });

  it('explicit read-only roots (the service checkout for the static server) and deployment extras are honored', () => {
    const args = composeSandboxArgs(
      { rwRoots: [], roRoots: ['/app'], workingDir: '/app', env: {}, extraRw: ['/home/ant/go'], extraRo: ['/vault/secrets'] },
      host,
    );
    expect(roBindsOf(args)).toContain('/app');
    expect(bindsOf(args)).toContain('/home/ant/go');
    // An operator CAN bind a secret path in — it is their decision, spelled out.
    expect(roBindsOf(args)).toContain('/vault/secrets');
  });

  it('a writable root that does not exist on the host is dropped rather than failing the mount', () => {
    const args = composeSandboxArgs({ rwRoots: [tenant, '/data/nope'], workingDir: tenant, env: {} }, host);
    expect(bindsOf(args)).toEqual([tenant]);
  });
});

describe('wrapChildInSandbox / spawnUserChild — mode and refusals', () => {
  it('passes the command through untouched when the mode is off', () => {
    process.env.ANT_SERVER_MODE = 'local';
    expect(wrapChildInSandbox('npm', ['run', 'dev'], { rwRoots: ['/x'], workingDir: '/x', env: {} }, { context: 't' }))
      .toEqual({ command: 'npm', args: ['run', 'dev'] });
  });

  it('refuses a call site that names no root at all', () => {
    process.env.ANT_CHILD_SANDBOX = 'on';
    expect(() => wrapChildInSandbox('sh', ['-c', 'true'], { rwRoots: [], workingDir: '/x', env: {} }, { context: 'unit' }))
      .toThrow(/no sandbox root named/);
  });

  it('refuses a working directory outside every root', () => {
    process.env.ANT_CHILD_SANDBOX = 'on';
    expect(() => wrapChildInSandbox('sh', ['-c', 'true'], { rwRoots: ['/x'], workingDir: '/y', env: {} }, { context: 'unit' }))
      .toThrow(/outside every sandbox root/);
  });

  it('fails closed on a runtime with no launcher instead of running on the bare filesystem', () => {
    process.env.ANT_CHILD_SANDBOX = 'on';
    const root = os.tmpdir();
    const attempt = () => wrapChildInSandbox('sh', ['-c', 'true'], { rwRoots: [root], workingDir: root, env: {} }, { context: 'unit' });
    if (process.platform !== 'linux') {
      expect(attempt).toThrow(/non-Linux runtime/);
    } else if (!['/usr/bin/bwrap', '/usr/local/bin/bwrap', '/bin/bwrap'].some((p) => fs.existsSync(p))) {
      expect(attempt).toThrow(/bwrap\) not found/);
    } else {
      expect(attempt().command).toMatch(/\/bwrap$/);
    }
  });

  it('with the mode off, spawnUserChild keeps Node shell semantics (the join runs under the platform shell)', async () => {
    process.env.ANT_SERVER_MODE = 'local';
    const cwd = os.tmpdir();
    const child = spawnUserChild('echo', ['sandbox', '&&', 'echo', 'shell'], {
      context: 'unit', sandbox: { rwRoots: [cwd] }, cwd, env: { PATH: process.env.PATH }, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = await new Promise<string>((resolve) => {
      let buf = '';
      child.stdout!.on('data', (d) => { buf += d.toString(); });
      child.on('close', () => resolve(buf));
    });
    expect(out).toContain('sandbox');
    expect(out).toContain('shell');
  });
});

describe('serviceCodeRoot — the one tree of ours a child may read', () => {
  it('is the topmost pnpm workspace above the CLI root', () => {
    const root = serviceCodeRoot();
    expect(fs.existsSync(path.join(root, 'pnpm-workspace.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'packages', 'ant-cli'))).toBe(true);
  });
});

// Live proof, where the host can do it: a path that is not bound is not there.
const bwrapAvailable = process.platform === 'linux'
  && ['/usr/bin/bwrap', '/usr/local/bin/bwrap', '/bin/bwrap'].some((p) => fs.existsSync(p))
  && spawnSync('bwrap', ['--unshare-user', '--unshare-pid', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--', '/bin/true'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!bwrapAvailable)('live: an unbound path does not exist inside the sandbox', () => {
  it('cannot read a file outside the tenant root, can read and write inside it', async () => {
    process.env.ANT_CHILD_SANDBOX = 'on';
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-sandbox-'));
    const outside = path.join(base, 'vault');
    const inside = path.join(base, 'tenant');
    fs.mkdirSync(outside); fs.mkdirSync(inside);
    fs.writeFileSync(path.join(outside, 'secret'), 'S3CRET');
    fs.writeFileSync(path.join(inside, 'ok'), 'visible');

    const child = spawnUserChild('/bin/sh', ['-c', `cat ${outside}/secret 2>/dev/null || echo MISSING; cat ok; echo written > out.txt; cat /proc/1/comm`], {
      context: 'live', sandbox: { rwRoots: [inside] }, cwd: inside, env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = await new Promise<string>((resolve) => {
      let buf = '';
      child.stdout!.on('data', (d) => { buf += d.toString(); });
      child.stderr!.on('data', (d) => { buf += d.toString(); });
      child.on('close', () => resolve(buf));
    });
    expect(out).toContain('MISSING');
    expect(out).not.toContain('S3CRET');
    expect(out).toContain('visible');
    expect(fs.readFileSync(path.join(inside, 'out.txt'), 'utf8')).toContain('written');
    // Own PID namespace: pid 1 is the sandbox init, not the host's.
    expect(out).toMatch(/bwrap/);
    fs.rmSync(base, { recursive: true, force: true });
  });
});
