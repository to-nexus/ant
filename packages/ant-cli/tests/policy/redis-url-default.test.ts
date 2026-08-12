/**
 * Redis-URL resolution policy — core/config/redisUrl.ts is the SSOT.
 *
 * Contract:
 *   - local mode (ANT_SERVER_MODE unset or 'local') + no ANT_REDIS_URL
 *     → defaults to redis://localhost:16379 (zero-env boot).
 *   - cloud mode + no ANT_REDIS_URL → THROWS (fail-fast; a silent localhost
 *     fallback in a cloud pod would masquerade a missing-env misconfiguration
 *     as an opaque connection error).
 *   - an explicit ANT_REDIS_URL wins in every mode.
 *
 * The default must never leak into the orchestrator plane, where an *unset*
 * env is a signal ("realtime disabled" — verification-runner contract), so
 * resolveRedisUrl() must not mutate process.env.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveRedisUrl, DEFAULT_LOCAL_REDIS_URL } from '../../src/core/config/redisUrl';
import {
  InfrastructureFactory,
  getInfrastructureFactory,
} from '../../src/infrastructure/adapters/InfrastructureFactory';

const savedMode = process.env.ANT_SERVER_MODE;
const savedRedis = process.env.ANT_REDIS_URL;

beforeEach(() => {
  delete process.env.ANT_SERVER_MODE;
  delete process.env.ANT_REDIS_URL;
  InfrastructureFactory.reset();
});

afterEach(() => {
  if (savedMode === undefined) delete process.env.ANT_SERVER_MODE;
  else process.env.ANT_SERVER_MODE = savedMode;
  if (savedRedis === undefined) delete process.env.ANT_REDIS_URL;
  else process.env.ANT_REDIS_URL = savedRedis;
  InfrastructureFactory.reset();
});

describe('resolveRedisUrl — local default / cloud fail-fast', () => {
  const cases: Array<{ mode?: string; env?: string; expected: string | 'throws' }> = [
    { mode: undefined, env: undefined, expected: DEFAULT_LOCAL_REDIS_URL },
    { mode: 'local', env: undefined, expected: DEFAULT_LOCAL_REDIS_URL },
    { mode: 'cloud', env: undefined, expected: 'throws' },
    { mode: undefined, env: 'redis://elsewhere:6380', expected: 'redis://elsewhere:6380' },
    { mode: 'local', env: 'redis://elsewhere:6380', expected: 'redis://elsewhere:6380' },
    { mode: 'cloud', env: 'redis://redis:6379', expected: 'redis://redis:6379' },
    // Whitespace-only env is treated as unset, not as a connection URL.
    { mode: 'local', env: '  ', expected: DEFAULT_LOCAL_REDIS_URL },
    { mode: 'cloud', env: '  ', expected: 'throws' },
  ];

  for (const { mode, env, expected } of cases) {
    it(`mode=${mode ?? 'unset'} env=${env === undefined ? 'unset' : JSON.stringify(env)} → ${expected}`, () => {
      if (mode === undefined) delete process.env.ANT_SERVER_MODE;
      else process.env.ANT_SERVER_MODE = mode;
      if (env === undefined) delete process.env.ANT_REDIS_URL;
      else process.env.ANT_REDIS_URL = env;

      if (expected === 'throws') {
        expect(() => resolveRedisUrl()).toThrow(/ANT_REDIS_URL is required in cloud mode/);
      } else {
        expect(resolveRedisUrl()).toBe(expected);
      }
    });
  }

  it('never mutates process.env (unset stays unset for the orchestrator-plane signal)', () => {
    delete process.env.ANT_SERVER_MODE;
    resolveRedisUrl();
    expect(process.env.ANT_REDIS_URL).toBeUndefined();
  });
});

describe('InfrastructureFactory config resolution', () => {
  it('local mode + no env → factory boots with the default URL (zero-env boot)', () => {
    const factory = getInfrastructureFactory();
    expect(factory.getConfig().redisUrl).toBe(DEFAULT_LOCAL_REDIS_URL);
  });

  it('cloud mode + no env → factory construction throws (fail-fast preserved)', () => {
    process.env.ANT_SERVER_MODE = 'cloud';
    expect(() => getInfrastructureFactory()).toThrow(/ANT_REDIS_URL is required in cloud mode/);
  });

  it('explicit env wins over the local default', () => {
    process.env.ANT_REDIS_URL = 'redis://custom:1234';
    const factory = getInfrastructureFactory();
    expect(factory.getConfig().redisUrl).toBe('redis://custom:1234');
  });
});
