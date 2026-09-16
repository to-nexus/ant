/**
 * One poll of a fetch trigger's source, in the API process: resolve the named
 * job's `apis` connection in the OWNER's scope roots, resolve its `${secret:}`
 * headers through the owner's credential store, and issue the declared
 * request through the SAME admission owner the tool executor uses
 * (`buildRestRequest` → `performRestRequest`). No LLM, no tool, no credits.
 *
 * Never throws — every failure is a reason string the caller records as the
 * poll's status (a status line or a policy sentence; never a response body,
 * never a header). Shared by the scheduler's poller and the editor's preview.
 */

import { isSelfApiConfig, parseCustomJobRef, type PipelineFetchTrigger } from '@ant/shared';
import { deriveCustomAgentScopeRootsForTenant, type CustomAgentTenantContext } from '../customAgents/scopeRoots';
import { loadCustomJob } from '../customAgents/CustomAgentLoader';
import type { McpCredentialResolver } from '../customAgents/McpCredentialResolver';
import { resolveDeclaredCredentials } from '../customAgents/McpConnectionManager';
import {
  assertPublicApiBaseUrl,
  buildRestRequest,
  compileRestServer,
  performRestRequest,
  resolveRestConnectivity,
  REST_BODY_CAP_BYTES,
} from '../customAgents/restApi';
import { extractFetchItems, type ExtractedFetchItems } from './fetchSource';

export interface FetchSourceDeps {
  tenant: CustomAgentTenantContext;
  credentialResolver: McpCredentialResolver;
  fetchImpl?: typeof fetch;
}

export type FetchSourceOutcome = { ok: true; extracted: ExtractedFetchItems } | { ok: false; error: string };

export async function pollFetchSource(deps: FetchSourceDeps, trigger: PipelineFetchTrigger): Promise<FetchSourceOutcome> {
  const fail = (error: string): FetchSourceOutcome => ({ ok: false, error });
  const ref = parseCustomJobRef(trigger.customJobRef);
  if (!ref) return fail(`on.fetch.customJobRef is malformed: ${trigger.customJobRef}`);

  let cfg;
  try {
    const resolved = loadCustomJob(deriveCustomAgentScopeRootsForTenant(deps.tenant), ref.agentId, ref.jobId);
    cfg = resolved.apiServers[trigger.api];
  } catch (e) {
    return fail(`definition "${trigger.customJobRef}" failed to load: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!cfg) return fail(`job "${trigger.customJobRef}" declares no API connection "${trigger.api}"`);
  if (isSelfApiConfig(cfg)) return fail(`connection "${trigger.api}" is a self entry — a poll needs an external API`);

  let compiled;
  try {
    const headers = await resolveDeclaredCredentials(cfg.headers, 'headers', trigger.api, deps.credentialResolver, 'API server');
    compiled = compileRestServer(trigger.api, cfg, resolveRestConnectivity(trigger.api, cfg, headers));
    await assertPublicApiBaseUrl(trigger.api, compiled.baseUrl.href);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const built = buildRestRequest(compiled, trigger.request.method === 'GET' ? 'get' : 'request', {
    method: trigger.request.method,
    path: trigger.request.path,
    ...(trigger.request.query && { query: trigger.request.query }),
    ...(trigger.request.body && { body: trigger.request.body }),
  });
  if (!built.ok) return fail(built.error.text);

  const performed = await performRestRequest(built.request, deps.fetchImpl ?? fetch);
  if (!performed.ok) return fail(`network error: ${performed.reason}`);
  const res = performed.response;
  if (res.location !== undefined) return fail(`HTTP ${res.status} — redirect not followed by policy`);
  if (res.status >= 400) return fail(`HTTP ${res.status} ${res.statusText}`.trimEnd());
  if (!/json/i.test(res.contentType)) return fail(`response is not JSON (content-type: ${res.contentType || 'none'})`);
  if (res.body.byteLength > REST_BODY_CAP_BYTES) {
    return fail(`response body is ${res.body.byteLength} bytes — over the ${REST_BODY_CAP_BYTES}-byte cap; narrow the request (page size / filter)`);
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body.toString('utf-8'));
  } catch {
    return fail('response body is not valid JSON');
  }
  const extracted = extractFetchItems(json, trigger);
  if (typeof extracted === 'string') return fail(extracted);
  return { ok: true, extracted };
}
