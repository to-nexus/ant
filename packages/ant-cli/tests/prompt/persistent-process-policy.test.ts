/**
 * persistent-process-policy partial — RC-A SSOT for persistent process
 * permission. Replaces previously-fragmented inline prohibitions in
 * `plan/variants/error/base.md` and `plan/variants/verification/rules.md`
 * with a single Handlebars partial gated on `allowPersistentProcesses`.
 *
 * Locking the partial's two branches into a test prevents the
 * fragmentation regression — if a future change drifts the policy back
 * into a per-template inline string, the include site still hits THIS
 * partial and the test catches a missing branch.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

describe('persistent-process-policy partial', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  describe('ENABLED branch (allowPersistentProcesses: true)', () => {
    let rendered: string;

    beforeAll(async () => {
      rendered = await adapter.render('jobs/code/base/injections/persistent-process-policy', {
        allowPersistentProcesses: true,
      });
    });

    it('renders the ENABLED header', () => {
      expect(rendered).toContain('Persistent Process Policy — ENABLED');
    });

    it('mentions keep_running flag', () => {
      expect(rendered).toContain('keep_running: true');
    });

    it('describes spawn / probe lifecycle', () => {
      expect(rendered.toLowerCase()).toContain('spawn');
      expect(rendered.toLowerCase()).toContain('probe');
    });

    it('forbids manual `&` / `nohup` backgrounding', () => {
      expect(rendered).toMatch(/&|nohup/);
    });

    it('does NOT also render the DISABLED branch', () => {
      expect(rendered).not.toContain('Persistent Process Policy — DISABLED');
    });
  });

  describe('DISABLED branch (allowPersistentProcesses: false / absent)', () => {
    it('renders the DISABLED header when flag is false', async () => {
      const rendered = await adapter.render(
        'jobs/code/base/injections/persistent-process-policy',
        { allowPersistentProcesses: false },
      );
      expect(rendered).toContain('Persistent Process Policy — DISABLED');
      expect(rendered).not.toContain('Persistent Process Policy — ENABLED');
    });

    it('renders the DISABLED branch when flag is omitted entirely', async () => {
      const rendered = await adapter.render(
        'jobs/code/base/injections/persistent-process-policy',
        {},
      );
      expect(rendered).toContain('Persistent Process Policy — DISABLED');
    });

    it('mentions verification gates remain one-shot', () => {
      // The DISABLED branch must explain WHY processes are blocked, so the
      // LLM can re-classify the task instead of failing silently.
      return adapter
        .render('jobs/code/base/injections/persistent-process-policy', {})
        .then(rendered => {
          expect(rendered.toLowerCase()).toContain('typecheck');
          expect(rendered.toLowerCase()).toContain('build');
          expect(rendered.toLowerCase()).toContain('test');
        });
    });
  });

  describe('include sites', () => {
    it('error/base.md include renders the ENABLED branch via partial', async () => {
      const rendered = await adapter.render('jobs/code/nodes/plan/variants/error/base', {
        hasTools: true,
        allowPersistentProcesses: true,
        directive: 'Error: cannot find module',
      });
      expect(rendered).toContain('Persistent Process Policy — ENABLED');
      // The legacy inline "NOT permitted: Persistent background processes"
      // must NOT survive — that string is the SSOT-fragmentation regression
      // marker.
      expect(rendered).not.toContain('Persistent background processes');
    });

    it('plan/verification/rules.md include renders the DISABLED branch when flag absent', async () => {
      const rendered = await adapter.render(
        'jobs/code/nodes/plan/variants/verification/rules',
        {
          hasTools: true,
        },
      );
      expect(rendered).toContain('Persistent Process Policy — DISABLED');
      // Legacy inline list-item must not survive: the prohibition used to
      // live inline as "- Persistent background processes (...)" inside
      // the "**`run_command` is NOT permitted for**:" bullet list.
      expect(rendered).not.toMatch(/^- Persistent background processes/m);
    });

    it('plan/verification/rules.md include renders the ENABLED branch when allowPersistentProcesses: true', async () => {
      const rendered = await adapter.render(
        'jobs/code/nodes/plan/variants/verification/rules',
        {
          hasTools: true,
          allowPersistentProcesses: true,
        },
      );
      expect(rendered).toContain('Persistent Process Policy — ENABLED');
    });
  });
});
