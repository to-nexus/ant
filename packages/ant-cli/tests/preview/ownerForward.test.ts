/**
 * Cross-pod owner-forwarding SSOT (`resolveOwnerForward` + `selfPodHost` +
 * `selfServicePort`).
 *
 * Root cause it locks: ant-preview runs multi-replica; a preview dev server
 * lives only on the pod that spawned it (record `host` = that pod's POD_IP) on
 * an ephemeral port not reachable cross-pod. The ALB round-robins each preview
 * host across replicas with no owner affinity, so a non-owner pod must forward
 * the request to the owner's ant-preview SERVICE port (open pod-to-pod) rather
 * than hang on the owner's dev port → front-tier 504. The decision must:
 *   - no-op off-cluster (local dev / tests: no POD_IP),
 *   - no-op when this pod IS the owner,
 *   - loop-guard so a stale owner record can't bounce a request between pods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveOwnerForward,
  selfPodHost,
  selfServicePort,
} from '../../src/periphery/adapters/http/middleware/previewRouting';

const SELF = '10.0.0.5';
const OWNER = '10.0.0.9';

describe('resolveOwnerForward', () => {
  const origPodIp = process.env.POD_IP;
  const origPort = process.env.PORT;

  beforeEach(() => {
    process.env.POD_IP = SELF;
    process.env.PORT = '4102';
  });
  afterEach(() => {
    if (origPodIp === undefined) delete process.env.POD_IP; else process.env.POD_IP = origPodIp;
    if (origPort === undefined) delete process.env.PORT; else process.env.PORT = origPort;
  });

  it('forwards to the owner pod on the service port when the owner is another replica', () => {
    expect(resolveOwnerForward(OWNER, false)).toEqual({ forwardHost: OWNER, forwardPort: 4102 });
  });

  it('does NOT forward when this pod is the owner (record host === self)', () => {
    expect(resolveOwnerForward(SELF, false)).toBeNull();
  });

  it('does NOT forward when the request was already forwarded once (loop guard)', () => {
    expect(resolveOwnerForward(OWNER, true)).toBeNull();
  });

  it('does NOT forward off-cluster (no POD_IP) — local dev / single process', () => {
    delete process.env.POD_IP;
    expect(resolveOwnerForward(OWNER, false)).toBeNull();
  });

  it('does NOT forward for a loopback / unknown owner host', () => {
    expect(resolveOwnerForward('localhost', false)).toBeNull();
    expect(resolveOwnerForward(undefined, false)).toBeNull();
  });
});

describe('selfPodHost / selfServicePort', () => {
  const origPodIp = process.env.POD_IP;
  const origPort = process.env.PORT;
  afterEach(() => {
    if (origPodIp === undefined) delete process.env.POD_IP; else process.env.POD_IP = origPodIp;
    if (origPort === undefined) delete process.env.PORT; else process.env.PORT = origPort;
  });

  it('selfPodHost reads POD_IP, trims, and is undefined when unset/blank', () => {
    process.env.POD_IP = '  10.1.2.3  ';
    expect(selfPodHost()).toBe('10.1.2.3');
    process.env.POD_IP = '';
    expect(selfPodHost()).toBeUndefined();
    delete process.env.POD_IP;
    expect(selfPodHost()).toBeUndefined();
  });

  it('selfServicePort mirrors the listen port (PORT || 8080)', () => {
    process.env.PORT = '4102';
    expect(selfServicePort()).toBe(4102);
    delete process.env.PORT;
    expect(selfServicePort()).toBe(8080);
  });
});
