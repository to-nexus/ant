/**
 * download_asset server-side fetch hardening — H-NEW-002 (SSRF) / M-NEW-014 (memory).
 *
 * The cloud direct-download path used to (a) follow redirects and re-resolve DNS
 * without re-validation, letting a public host bounce to an internal/metadata
 * address, and (b) buffer the whole response via `arrayBuffer()` with no size
 * cap. These rows pin the replacements: per-hop private-address refusal and a
 * hard byte ceiling on the streamed read.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';

import {
  safeFetchAssetToBuffer,
  readBoundedResponse,
  __ASSET_MAX_BYTES,
} from '../../src/agents/architect/graph/design/nodes/tool/handlers/assets';

describe('download_asset safe fetch', () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const listen = (handler: http.RequestListener): Promise<number> =>
    new Promise((resolve) => {
      server = http.createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });

  it('refuses a loopback target (SSRF, hop 0)', async () => {
    const port = await listen((_req, res) => res.end('ok'));
    await expect(safeFetchAssetToBuffer(`http://127.0.0.1:${port}/`)).rejects.toThrow(/internal address/i);
  });

  it('refuses a non-http(s) scheme', async () => {
    await expect(safeFetchAssetToBuffer('file:///etc/passwd')).rejects.toThrow(/scheme/i);
  });

  it('readBoundedResponse rejects a body over the cap without buffering it whole', async () => {
    const oversize = __ASSET_MAX_BYTES + 1024;
    const port = await listen((_req, res) => {
      res.setHeader('content-length', String(oversize));
      res.end(Buffer.alloc(oversize));
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    await expect(readBoundedResponse(response)).rejects.toThrow(/exceeds/i);
  });

  it('readBoundedResponse returns a small body intact', async () => {
    const port = await listen((_req, res) => res.end(Buffer.from('hello')));
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const buf = await readBoundedResponse(response);
    expect(buf.toString()).toBe('hello');
  });
});
