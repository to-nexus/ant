/**
 * One poll of a fetch trigger's source, in the API process: resolve the
 * connection — a named job's `apis` entry in the OWNER's scope roots (bound
 * form) or the trigger's own inline connection — resolve its `${secret:}`
 * headers through the owner's credential store, and issue the declared
 * request through the SAME admission owner the tool executor uses
 * (`buildRestRequest` → `performRestRequest`). No LLM, no tool, no credits.
 * Both forms meet at ONE `compileRestServer` call: neither can reach an
 * origin, path or header the other could not.
 *
 * Never throws — every failure is a reason string the caller records as the
 * poll's status (a status line or a policy sentence; never a response body,
 * never a header). Shared by the scheduler's poller and the editor's preview.
 */

import {
  fetchConnectionSource,
  isSelfApiConfig,
  parseCustomJobRef,
  PIPELINE_FETCH_INLINE_CONNECTION_NAME,
  type PipelineFetchTrigger,
  type RestApiServerConfig,
} from '@ant/shared';
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
/** The response body alone — what the editor's preview shows an author before any selection exists. */
export type FetchSourceJsonOutcome = { ok: true; json: unknown } | { ok: false; error: string };

export async function pollFetchSource(deps: FetchSourceDeps, trigger: PipelineFetchTrigger): Promise<FetchSourceOutcome> {
  const fetched = await fetchSourceJson(deps, trigger);
  if (!fetched.ok) return fetched;
  const extracted = extractFetchItems(fetched.json, trigger);
  if (typeof extracted === 'string') return { ok: false, error: extracted };
  return { ok: true, extracted };
}

/**
 * Connection → admission → request → parsed JSON. The poller composes this
 * with `extractFetchItems`; the preview route stops here so the sample can be
 * shown even while `items` / `key` are still unwritten.
 */
export async function fetchSourceJson(deps: FetchSourceDeps, trigger: Pick<PipelineFetchTrigger, 'connection' | 'customJobRef' | 'api' | 'request'>): Promise<FetchSourceJsonOutcome> {
  const fail = (error: string): FetchSourceJsonOutcome => ({ ok: false, error });

  let name: string;
  let cfg: RestApiServerConfig | undefined;
  if (fetchConnectionSource(trigger) === 'inline') {
    name = PIPELINE_FETCH_INLINE_CONNECTION_NAME;
    cfg = trigger.connection;
  } else {
    name = trigger.api ?? '';
    const ref = parseCustomJobRef(trigger.customJobRef ?? '');
    if (!ref) return fail(`on.fetch.customJobRef is malformed: ${String(trigger.customJobRef)}`);
    try {
      const resolved = loadCustomJob(deriveCustomAgentScopeRootsForTenant(deps.tenant), ref.agentId, ref.jobId);
      cfg = resolved.apiServers[name];
    } catch (e) {
      return fail(`definition "${trigger.customJobRef}" failed to load: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!cfg) return fail(`job "${trigger.customJobRef}" declares no API connection "${name}"`);
  }
  if (!cfg) return fail('on.fetch carries no connection');
  if (isSelfApiConfig(cfg)) return fail(`connection "${name}" is a self entry — a poll needs an external API`);

  let compiled;
  try {
    const headers = await resolveDeclaredCredentials(cfg.headers, 'headers', name, deps.credentialResolver, 'API server');
    compiled = compileRestServer(name, cfg, resolveRestConnectivity(name, cfg, headers));
    await assertPublicApiBaseUrl(name, compiled.baseUrl.href);
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
  if (res.bodyOverCap) {
    return fail(`response body exceeds the ${REST_BODY_CAP_BYTES}-byte cap; narrow the request (page size / filter)`);
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body.toString('utf-8'));
  } catch {
    return fail('response body is not valid JSON');
  }
  return { ok: true, json };
}
