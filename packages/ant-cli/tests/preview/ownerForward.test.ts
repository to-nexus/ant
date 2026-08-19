/**
 * Cross-pod owner-forwarding SSOT (`resolveOwnerForward` + `selfPodId` +
 * `selfServicePort`).
 *
 * Root cause it locks: ant-preview runs multi-replica; a preview dev server
 * lives only on the pod that spawned it (record `podId` = that pod's hostname,
 * `host` = its IP) on an ephemeral port not reachable cross-pod. The ALB
 * round-robins each preview host across replicas with no owner affinity, so a
 * non-owner pod must forward the request to the owner's ant-preview SERVICE port
 * with the original host carried on X-Forwarded-Host (undici drops `Host`),
 * rather than hang on the owner's dev port → front-tier 504.
 *
 * The decision keys off `podId` (`os.hostname()`) — NOT `process.env.POD_IP`.
 * An earlier version gated on POD_IP, which the record writer (`getPodHost`) does
 * not require (it falls back to the eth0 IP), so records looked cross-pod-routable
 * while the forwarder silently disabled itself. These tests lock the podId-based
 * decision + the loop guard.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import {
  resolveOwnerForward,
  selfPodId,
  selfServicePort,
} from '../../src/periphery/adapters/http/middleware/previewRouting';

const SELF = os.hostname();
const OWNER_POD = 'ant-preview-owner-xyz';
const OWNER_HOST = '10.0.0.9';

describe('resolveOwnerForward (podId-based)', () => {
  const origPort = process.env.PORT;
  afterEach(() => {
    if (origPort === undefined) delete process.env.PORT; else process.env.PORT = origPort;
  });

  // Owner-forwarding carries a preview CONTENT request, and content lives on its
  // own listener now (H-NEW-001) — so the forward target is the content port, not
  // the control-plane `PORT`.
  it('forwards to the owner pod on the CONTENT port when the owner podId is another replica', () => {
    process.env.PORT = '4102';
    delete process.env.ANT_PREVIEW_CONTENT_PORT;
    expect(resolveOwnerForward(OWNER_POD, OWNER_HOST, false)).toEqual({
      forwardHost: OWNER_HOST,
      forwardPort: 4103,
    });
  });

  it('honours an explicit ANT_PREVIEW_CONTENT_PORT', () => {
    process.env.PORT = '4102';
    process.env.ANT_PREVIEW_CONTENT_PORT = '9010';
    try {
      expect(resolveOwnerForward(OWNER_POD, OWNER_HOST, false)).toEqual({
        forwardHost: OWNER_HOST,
        forwardPort: 9010,
      });
    } finally {
      delete process.env.ANT_PREVIEW_CONTENT_PORT;
    }
  });

  it('does NOT forward when this pod is the owner (podId === self hostname)', () => {
    expect(resolveOwnerForward(SELF, OWNER_HOST, false)).toBeNull();
  });

  it('does NOT depend on POD_IP — forwards even when POD_IP is unset (the inertness bug fix)', () => {
    const orig = process.env.POD_IP;
    delete process.env.POD_IP;
    try {
      expect(resolveOwnerForward(OWNER_POD, OWNER_HOST, false)).not.toBeNull();
    } finally {
      if (orig === undefined) delete process.env.POD_IP; else process.env.POD_IP = orig;
    }
  });

  it('does NOT forward when the request was already forwarded once (loop guard)', () => {
    expect(resolveOwnerForward(OWNER_POD, OWNER_HOST, true)).toBeNull();
  });

  it('does NOT forward for a missing owner podId (stale/legacy record → forgiving fallback)', () => {
    expect(resolveOwnerForward(undefined, OWNER_HOST, false)).toBeNull();
  });

  it('does NOT forward for a loopback / missing owner host', () => {
    expect(resolveOwnerForward(OWNER_POD, 'localhost', false)).toBeNull();
    expect(resolveOwnerForward(OWNER_POD, undefined, false)).toBeNull();
  });
});

describe('selfPodId / selfServicePort', () => {
  const origPort = process.env.PORT;
  afterEach(() => {
    if (origPort === undefined) delete process.env.PORT; else process.env.PORT = origPort;
  });

  it('selfPodId equals os.hostname() (always present, no env dependency)', () => {
    expect(selfPodId()).toBe(os.hostname());
  });

  it('selfServicePort is the content port (PORT + 1, or the explicit override)', () => {
    delete process.env.ANT_PREVIEW_CONTENT_PORT;
    process.env.PORT = '4102';
    expect(selfServicePort()).toBe(4103);
    delete process.env.PORT;
    expect(selfServicePort()).toBe(8081);
  });
});
