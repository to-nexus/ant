/**
 * iterative-mango — SV faithfulness authoring-time locks.
 *
 * RCA (classboard tight-drafting-lever, run on the LATEST build — every prior SV
 * fix was live, yet the defects recurred). Each lock below pins a structural
 * decision the live prompt never named, or a coverage 8f21e9ca's 146→62-line
 * compression regressed:
 *
 *  2-1 Store continuity   — per-mount `createAdminApiPort()` lost writes on nav;
 *                           "survival horizon" spoke of duration, never of ONE
 *                           shared store instance.
 *  2-3 Surface adapter-fed — dashboard chart bound to a literal `BAR_DATA`;
 *                           "non-empty" was satisfied by a hardcoded literal.
 *  2-2 In-app authorize   — OAuth authorize went to `mock-oauth.example.com`;
 *                           the compression folded the authorize-leg sentence into
 *                           the callback-leg "don't hardcode host" bullet.
 *  2-6 No auto-bind       — admin auto-logged-in; the auth-flow block's
 *                           "skip if this task authors no sign-in surface" gate
 *                           self-deactivated on the exact app that skipped login.
 *  2-5/2-6 decompose      — shared nav primitive + identity-gated sign-in entry as
 *                           recognized shared-decision shapes.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const SESSION = 'jobs/code/base/injections/service-virtualization-session';
const CONTRACT = 'jobs/code/base/injections/service-virtualization-contract';
const DECOMPOSE = 'jobs/code/nodes/decompose/variants/default/rules';

describe('iterative-mango — SV session faithfulness rows', () => {
  let session: string;
  let contract: string;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    const adapter = new FilePromptAdapter(TEMPLATES_DIR);
    // all gated blocks active so the rows render. Store continuity / mutation
    // persistence moved into the store-lifecycle block (gated on the store
    // OWNER, not the renderable consumer) — see sessionGate.ts.
    session = await adapter.render(SESSION, {
      svWorldSeedActive: true,
      svStoreLifecycleActive: true,
      svBodyLifecycleActive: true,
      svAuthFlowActive: true,
    });
    contract = await adapter.render(CONTRACT, {});
  });

  it('2-1: Store continuity — ONE shared store instance across mounts/navigations', () => {
    expect(session).toMatch(/Store continuity/);
    expect(session).toMatch(/ONE store instance/);
    expect(session).toMatch(/per consumer \/ mount/);
  });

  it('2-3: Surface is adapter-fed — not a literal baked into the component', () => {
    expect(session).toMatch(/Surface is adapter-fed/);
    expect(session).toMatch(/not from a literal baked into the component/);
  });

  // 2-2 (RCA misty-bringing-novel): the "authorize URL must be in-app, never an
  // external host" rule was relocated from the gated session auth-flow block
  // into the ALWAYS-ON contract usability rule, so it binds every adapter method
  // (incl. an omnibus-data-adapter method) — not only a self-recognized auth task.
  // Contract now owns the reachability definition; session defers to it and names
  // the no-op-redirect failure mode.
  it('2-2: contract OWNS navigable-target reachability (in-app origin, never external host)', () => {
    expect(contract).toMatch(/navigable target/i);
    expect(contract).toMatch(/own runtime origin|own origin/i);
    expect(contract).toMatch(/external or placeholder host|\*\.example/i);
    // unconditional — binds every adapter method, not only a dedicated auth adapter
    expect(contract).toMatch(/every method of\s+every virtualized adapter/i);
    expect(contract).toMatch(/folded among many data methods/i);
  });

  it('2-2b: session defers the authorize entry to the contract rule and names the no-op-redirect defect', () => {
    expect(session).toMatch(/navigable-target rule|navigable target/i);
    expect(session).toMatch(/service-virtualization-contract/);
    expect(session).toMatch(/no-op/i);
  });

  it('2-6: no-auto-bind is unconditional (applies to ANY identity-gated surface)', () => {
    expect(session).toMatch(/Never auto-bind a default identity \(unconditional\)/);
    expect(session).toMatch(/applies to ANY identity-gated surface in mock mode/);
  });

  it('stays English-only (no Hangul)', () => {
    expect(session).not.toMatch(/[가-힣]/);
  });
});

describe('iterative-mango — decompose Shared Decisions shapes', () => {
  let decompose: string;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    const adapter = new FilePromptAdapter(TEMPLATES_DIR);
    decompose = await adapter.render(DECOMPOSE, {});
  });

  it('2-5: shared navigation-capable primitive — consumer injects navigation', () => {
    expect(decompose).toMatch(/navigation-capable primitive shared across apps\/packages/);
    expect(decompose).toMatch(/cannot reach the consuming framework's router \/ link primitive/);
  });

  it('2-6: identity-gated app depends on a sign-in entry unit (no silent skip)', () => {
    expect(decompose).toMatch(/sign-in \/ identity entry an identity-gated app depends on/);
    expect(decompose).toMatch(/auto-binding a default identity/);
  });

  // Guard against the cross-phase dangling reference the user caught: decompose
  // must NOT name the execute-phase SV session partial it cannot see.
  it('does not dangle a cross-phase reference to the SV session partial', () => {
    expect(decompose).not.toMatch(/SV session auth-flow partial/);
  });
});
