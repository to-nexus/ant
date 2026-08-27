/**
 * Contained-I/O ADOPTION — the enforcement layer the earlier audits were
 * missing. The `*ContainedBase` primitives (descriptor descent anchored at the
 * service-owned physical base) are only a fix if every in-base sink actually
 * USES them. Three prior audit rounds shipped the primitive but left call sites
 * on the movable-root / raw-fs path, and no test failed — because the tests
 * checked the primitive's behavior, never its adoption.
 *
 * This is that adoption guard: one axis per sink family, asserting the unsafe
 * shape has ZERO occurrences (outside the single owner allowed to keep the
 * legacy fallback). A new caller that reaches for the raw/movable-root form
 * fails here.
 *
 * Assertions are structural (call-site presence), never on message prose.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

/** All *.ts under src, minus .d.ts. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const ALL_TS = walk(SRC);
const rel = (p: string) => path.relative(process.cwd(), p);
const read = (p: string) => fs.readFileSync(p, 'utf-8');

describe('verified byte-write adoption (H-017)', () => {
  // writeBufferVerifiedAbs anchors the descent at a caller-supplied *feature
  // name* and so follows a reparented feature root. It survives ONLY as the
  // out-of-base (repoType:'local') fallback inside binaryIntegrity.ts; every
  // other write goes through writeBufferVerifiedContained.
  const OWNER = 'src/core/utils/binaryIntegrity.ts';

  it('writeBufferVerifiedAbs is called only inside binaryIntegrity.ts', () => {
    const offenders = ALL_TS.filter((p) => {
      if (rel(p) === OWNER) return false;
      return /writeBufferVerifiedAbs\s*\(/.test(read(p));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the verified-write SSOT exposes the base-relative (root-reparent-safe) form', () => {
    const src = read(path.join(process.cwd(), OWNER));
    expect(src).toMatch(/writeBufferVerifiedContained/);
    expect(src).toMatch(/writeBufferVerifiedBase/);
  });
});

describe('Ask workspace tools use contained reads (H-018)', () => {
  const ASK_TOOLS = 'src/agents/architect/graph/ask/tools.ts';

  it('read/list workspace tools descend via the contained base primitives', () => {
    const src = read(path.join(process.cwd(), ASK_TOOLS));
    expect(src).toMatch(/toBaseRelative/);
    expect(src).toMatch(/readTextContainedBase/);
    expect(src).toMatch(/readBoundedDirentsContainedBase/);
  });
});

/**
 * Session + JSONL bounded-read ADOPTION (M-NEW-029).
 *
 * audit-8 shipped `readSessionTextBounded*` and audit-9 still found six raw
 * `readFile` + `JSON.parse` callers on the same attacker-writable state — the
 * primitive existed, the adoption did not. Same failure mode this file was
 * created for, so it gets the same kind of guard: the unsafe SHAPE must have
 * zero occurrences outside the one owner that implements it.
 */
describe('session / JSONL bounded-read adoption (M-NEW-029)', () => {
  const OWNER = 'src/core/utils/sessionPaths.ts';

  /** `fs.readFile(x)` / `fs.readFileSync(x)` / `fsPromises.readFile(x)` … */
  const RAW_READ = /\b(?:await\s+)?fs(?:Promises|p)?\.(?:promises\.)?readFile(?:Sync)?\s*\(\s*([A-Za-z_$][\w$]*\s*\(?|)/g;

  /**
   * The audit-9 version of this row judged "is this a session path?" from the
   * SPELLING OF THE ARGUMENT TOKEN. `universalRuns.ts` read
   * `sessions/{agentId}/{jobId}.json` through a parameter named `filePath`, so
   * the enclosing function (`readSessionJson`), the module name and the value
   * itself were all session-shaped and the guard still passed it. Judge the
   * enclosing FUNCTION NAME and the MODULE PATH too — a raw read cannot rename
   * its way out of all three.
   */
  const ENCLOSING_FN = /(?:function|const)\s+([A-Za-z_$][\w$]*)[^\n]*$/;

  it('no caller whole-file-reads a session or JSONL path', () => {
    const offenders: string[] = [];
    for (const p of ALL_TS) {
      if (rel(p) === OWNER) continue;
      const src = read(p);
      const moduleIsSessionish = /session/i.test(path.basename(rel(p)));
      for (const m of src.matchAll(RAW_READ)) {
        const arg = (m[1] ?? '').trim();
        // Nearest preceding declaration — good enough to name the function a
        // raw read sits inside without parsing the file.
        const before = src.slice(0, m.index ?? 0);
        const fnName = before.split('\n').reverse().map((l) => ENCLOSING_FN.exec(l)?.[1]).find(Boolean) ?? '';
        const isSessionish =
          /session/i.test(arg) ||
          /session/i.test(fnName) ||
          (moduleIsSessionish && /path|file/i.test(arg)) ||
          arg.startsWith('getChatJsonlPath') ||
          arg.startsWith('getFeatureJsonlPath');
        if (isSessionish) offenders.push(`${rel(p)}: ${fnName || '?'}() readFile(${arg})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A private near-copy of the bounded reader is how the seam drifted: three
   * had grown (features.routes / sessionCleanup / universalRuns) and the fourth
   * forgot the bound. The SHAPE — open, stat, compare to a budget, read — may
   * exist only in the owner.
   */
  it('nobody hand-rolls a second bounded session reader', () => {
    const offenders = ALL_TS.filter((p) => {
      if (rel(p) === OWNER) return false;
      const src = read(p);
      return /\.stat\(\)/.test(src) && /SESSION_MAX_BYTES/.test(src) && /readFile/.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  // The readers audit-9 named individually. Pinned by name so a revert is loud.
  const CONVERGED: Array<[string, RegExp]> = [
    ['src/core/utils/debugRetention.ts', /readSessionTextBoundedAsync\(/],
    ['src/core/session/archive.ts', /readSessionTextBoundedAsync\(/],
    ['src/core/refine/refineImpactAlert.ts', /readSessionTextBoundedAsync\(/],
    ['src/core/refine/loadStaleTasks.ts', /readJsonlTailBounded\(/],
    ['src/agents/planner/graph/plan/nodes/sessionWriter.ts', /readSessionTextBounded\(/],
    ['src/agents/planner/graph/plan/nodes/resolve.ts', /readSessionTextBounded\(/],
    ['src/agents/creator/graph/visual/nodes/resolve.ts', /readSessionTextBounded\(/],
    ['src/periphery/adapters/session/FileSessionAdapter.ts', /readJsonlTailBounded\(/],
    // audit-10: universal was absent from BOTH halves of this guard.
    ['src/periphery/adapters/http/routes/helpers/universalRuns.ts', /readSessionTextContained\(/],
    ['src/periphery/adapters/http/routes/helpers/sessionCleanup.ts', /readSessionTextContained\(/],
    ['src/periphery/adapters/http/routes/features.routes.ts', /readSessionTextContained\(/],
  ];
  for (const [file, expected] of CONVERGED) {
    it(`${file} reads through the bounded seam`, () => {
      expect(read(path.join(process.cwd(), file))).toMatch(expected);
    });
  }

  // The collapse rewriters are read-modify-write, so the bounded READ window
  // would be silent record loss. They must stream instead.
  it('FileSessionAdapter collapse paths stream rather than buffer the whole log', () => {
    const src = read(path.join(process.cwd(), 'src/periphery/adapters/session/FileSessionAdapter.ts'));
    expect(src).toMatch(/rewriteJsonlStreaming/);
    // No whole-file read/write pair left on a JSONL path.
    expect(src).not.toMatch(/fs\.writeFile\(\s*filePath\s*,\s*newLines/);
  });

  // The reserved-namespace verdict has one owner and runs on the normalized
  // path — a raw first-segment split re-introduces the `..%2f` bypass.
  it('the file-API mutation guards use the shared reserved-path predicate', () => {
    for (const file of [
      'src/periphery/adapters/http/routes/files.routes.ts',
      'src/periphery/adapters/http/routes/customAgents.routes.ts',
    ]) {
      expect(read(path.join(process.cwd(), file))).toMatch(/isReservedSessionRelativePath\(/);
    }
  });

  // The directive ceiling has one owner; a route that re-declares its own
  // number is how `/execute` and `/inline-ask` ended up with none.
  it('every directive ingress uses the shared cap helper', () => {
    const jobRoutes = read(path.join(process.cwd(), 'src/periphery/adapters/http/routes/job.routes.ts'));
    expect(jobRoutes.match(/directiveTooLarge\(/g) ?? []).toHaveLength(3); // execute / continue / inline-ask
    expect(jobRoutes).not.toMatch(/const\s+\w*DIRECTIVE_MAX\w*\s*=\s*\d/);
  });

  /**
   * PRODUCER SET, not one file.
   *
   * The row above reads a single literal path and counts occurrences in it.
   * That is why the pipeline scheduler slipped through: the durable writer is
   * `ChatService.appendUserTurn`, and `PipelineRunCoordinator` calls it
   * DIRECTLY — never touching `job.routes.ts` or `submitUserTurn.ts`, so no
   * assertion in the repo could see it. `submitUserTurn.ts`'s own docstring
   * ("Every HTTP entry point ... routes through here") stayed literally true
   * while a non-HTTP producer walked past the cap.
   *
   * Enumerate the callers instead: anything that reaches the durable turn
   * writer must also carry the ceiling.
   */
  it('every appendUserTurn producer carries the directive ceiling', () => {
    const CAP_OWNER = 'src/periphery/adapters/http/routes/helpers/submitUserTurn.ts';
    const offenders = ALL_TS.filter((p) => {
      const r = rel(p);
      if (r === CAP_OWNER) return false;
      const src = read(p);
      // The DURABLE + BROADCAST writer specifically. The session port has a
      // same-named method for the worker-side feature.jsonl copy, whose text
      // was already capped at the ingress that started the job — matching on
      // the bare method name would flag that copy instead of a real producer.
      const calls = [...src.matchAll(/(\w+)\.appendUserTurn\s*\(/g)].map((m) => m[1]);
      const durable = calls.filter((recv) => !/session$/i.test(recv));
      if (durable.length === 0) return false;
      if (/class\s+ChatService/.test(src)) return false;
      return !/directiveTooLarge\(|DIRECTIVE_MAX_CHARS/.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  /**
   * The write half of the session budget. `SESSION_MAX_BYTES` was a read-only
   * refusal, so a writer could produce a file no reader could ever open again
   * (and `updateArtifacts` loads first, so the session bricked itself). Every
   * session-JSON writer goes through the one budgeted seam.
   *
   * audit-11: this used to be keyed on `atomicWriteFile(` — the NAME of the
   * function the seam happens to call. Three writers reached the same files by
   * a different shape (`fs.writeFileSync(sessionPath, …)` and a hand-rolled
   * tmp+rename) and the guard passed them all. Adoption is a property of the
   * FILE, so the offense is "a session path reached any write call that is not
   * the seam", whatever that call is named.
   */
  it('no writer serializes a session outside the budgeted seam', () => {
    const WRITE_OWNER = 'src/core/session/stateBudget.ts';
    // Any write-ish call whose first argument names a session path, plus the
    // older `atomicWriteFile(..., JSON.stringify(session…))` shape. `rename` is
    // deliberately absent: moving an oversized session aside is a legitimate
    // non-write. The tmp+rename shape is caught by the next case instead.
    const RAW_SESSION_WRITE =
      /(?:fs|fsPromises|fsp)?\.?(?:promises\.)?(?:writeFile|writeFileSync|appendFile|appendFileSync)\(\s*(?:`?\$?\{?)?\w*[Ss]ession\w*Path/;
    const offenders = ALL_TS.filter((p) => {
      if (rel(p) === WRITE_OWNER) return false;
      const src = read(p);
      return RAW_SESSION_WRITE.test(src)
        || /atomicWriteFile\(\s*\w*[Ss]ession\w*Path/.test(src)
        || /atomicWriteFile\([^)]*JSON\.stringify\(\s*session/.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  /**
   * A tmp+rename pair is the same write in two statements — the shape all three
   * audit-11 offenders used to slip past a call-name guard. Only the seam owns
   * an atomic session write; nobody else may rebuild one.
   */
  it('nobody hand-rolls a second atomic session write', () => {
    const WRITE_OWNER = 'src/core/utils/atomicWriteFile.ts';
    const offenders = ALL_TS.filter((p) => {
      if (rel(p) === WRITE_OWNER) return false;
      const src = read(p);
      return /\$\{\s*\w*[Ss]ession\w*Path\s*\}\.tmp/.test(src)
        || /tmpPath[^\n]*\w*[Ss]ession\w*Path[^\n]*\.tmp/.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  // The adapter is the highest-traffic writer; pin it onto the seam by name so
  // a revert to its own shed/serialize/rename copy is loud.
  it('the session adapter writes through the budgeted seam', () => {
    const src = read(path.join(process.cwd(), 'src/periphery/adapters/session/FileSessionAdapter.ts'));
    expect(src).toMatch(/writeSessionBounded\(/);
  });

  // The three writers audit-11 found on the raw shape. Pinned by name for the
  // same reason the readers are: a silent revert must fail loudly.
  const SEAM_WRITERS = [
    'src/periphery/adapters/http/routes/job.routes.ts',
    'src/agents/planner/graph/plan/nodes/sessionWriter.ts',
    'src/agents/planner/graph/plan/nodes/resolve.ts',
  ];
  for (const file of SEAM_WRITERS) {
    it(`${file} writes through the budgeted seam`, () => {
      expect(read(path.join(process.cwd(), file))).toMatch(/writeSessionBounded\(/);
    });
  }
});

/**
 * actionMetadata byte-budget adoption (M-NEW-029, final round) — enforced in
 * TYPE space, with this file guarding only the escape hatches.
 *
 * Four audit rounds keyed adoption on names (literal paths → call names →
 * variable names) and each round a differently-spelled caller slipped past —
 * a name grep is re-spellable by construction. The fix moves adoption into the
 * compiler: `BoundedActionMetadata` is a branded type whose brand symbol is
 * private to `actionMetadataBudget.ts`, its mint (`boundActionMetadata`) is the
 * only producer, and every consumer signature between an ingress and a durable
 * / broadcast / env sink requires the brand. A new TYPED ingress that skips the
 * mint fails `pnpm typecheck`, not a regex.
 *
 * What the compiler cannot see — and what this guard therefore pins:
 *   1. a cast that fabricates the brand (`as BoundedActionMetadata`) — the
 *      only spelling that works, so the grep surface is finite;
 *   2. the three `any` trust boundaries, each of which must keep its RUNTIME
 *      re-check: the HTTP schema transform (ingress), the JobWorker pre-spawn
 *      measure (queue replay), and the job-runner env re-bound (child side);
 *   3. the field-agnostic sink invariant (`JSONL_LINE_MAX_BYTES`) that holds
 *      whatever field a future producer inflates.
 */
describe('actionMetadata byte-budget adoption (M-NEW-029)', () => {
  const MINT_OWNER = 'src/core/context/actionMetadataBudget.ts';

  it('nobody fabricates the brand outside the mint module', () => {
    const FABRICATION = /as\s+(?:unknown\s+as\s+)?(?:[\w$.]*\.)?BoundedActionMetadata\b/;
    const offenders = ALL_TS.filter((p) => {
      if (rel(p) === MINT_OWNER) return false;
      return FABRICATION.test(read(p));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the mint module contains exactly one brand cast', () => {
    const src = read(path.join(process.cwd(), MINT_OWNER));
    const casts = src.match(/as\s+BoundedActionMetadata\b/g) ?? [];
    expect(casts).toHaveLength(1);
  });

  // The `any` trust boundaries the brand cannot reach — each keeps its runtime
  // re-check. Pinned by module because each IS the single owner of its boundary.
  const RUNTIME_CHECKS: Array<[file: string, pattern: RegExp, boundary: string]> = [
    [
      'src/periphery/adapters/http/middleware/validateBody.ts',
      /boundActionMetadata\(/,
      'HTTP ingress (schema transform mints the brand)',
    ],
    [
      'src/infrastructure/worker/JobWorker.ts',
      /measureActionMetadataBytes\(/,
      'pre-spawn env serialization (queued payload may pre-date the schema)',
    ],
    [
      'src/composition/job-runner.ts',
      /boundActionMetadata\(/,
      'child env deserialization (env value crosses a process boundary)',
    ],
  ];
  for (const [file, pattern, boundary] of RUNTIME_CHECKS) {
    it(`${boundary} keeps its runtime re-check`, () => {
      expect(read(path.join(process.cwd(), file))).toMatch(pattern);
    });
  }

  // Consumer signatures that make the compile-time seam: the durable writers
  // and the queue/HTTP ports. Removing the brand from any of these reopens the
  // raw-object path for every future typed caller.
  const BRANDED_CONSUMERS = [
    'src/periphery/adapters/http/routes/helpers/submitUserTurn.ts',
    'src/periphery/adapters/http/services/ChatService/index.ts',
    'src/periphery/adapters/session/FileSessionAdapter.ts',
    'src/composition/recordUserTurn.ts',
    'src/core/ports/http.ts',
    'src/core/ports/queue.ts',
  ];
  for (const file of BRANDED_CONSUMERS) {
    it(`${file} requires the branded type`, () => {
      expect(read(path.join(process.cwd(), file))).toMatch(/BoundedActionMetadata/);
    });
  }

  // The sink-side invariant is field-agnostic on purpose: whatever field a
  // future producer inflates, the append seam measures the serialized line.
  it('the JSONL append seam enforces the single-line byte cap', () => {
    const src = read(path.join(process.cwd(), 'src/periphery/adapters/session/FileSessionAdapter.ts'));
    expect(src).toMatch(/JsonlLineTooLargeError/);
    expect(src).toMatch(/JSONL_LINE_MAX_BYTES/);
  });
});
