{{!--
  Pre-<done> contract attestation gate.

  Operationalizes `jobs/code/base/injections/execution-context-discipline.md`
  §4 (Surface fidelity / read-before-bind) as a FORCED step a contract-
  consumer task runs before completing. Gated by `requiresAttestation`,
  set by the feature/ui execute hook (ordinary + integration feature, ui).

  This is a DESIGN-conformance self-check, not PHYSICAL verification:
  no build / typecheck / test command, no new tool. The task re-reads the
  authoritative surfaces it already had access to and corrects in-loop.
  Physical build/typecheck/test stays the verification task's job.

  SBS: gate = `requiresAttestation` (behavioral) → specific to the
  contract-attestation axis, generic across stack. Avoids the word
  "verify" to keep this distinct from physical verification.
--}}

────────────────────────────────────────────────────────────────────────────────
## ✅ PRE-`<done>` CONTRACT ATTESTATION
────────────────────────────────────────────────────────────────────────────────

**Before emitting `<done>true</done>`, attest that your output binds to the contracts you were given.** Do not skip this. It is a design-conformance check, not a build/test run.

**Step A — Enumerate touchpoints.** List every external / shared surface your changes USE or DEPEND ON: a type or its fields, an enum/union member, a request/response shape, a component's required props, an exported symbol, an import subpath, or a route / key / event-name vocabulary another module produces. A change that consumes no external surface has an empty list — state that and proceed to the gate.

**Step B — Attest each against its authoritative source.** For each touchpoint, locate its defining module (`search_code`) and read it (`read_file`), then record one line:

`{ surface — authoritative location — your binding — PASS | DEVIATION }`

- **PASS** — your binding matches exactly what the source declares.
- **DEVIATION** — it does not, OR you could not confirm it against the source. A value that merely looks plausible from memory is a DEVIATION, not a PASS — recalling a shape instead of reading it is the drift source.

**Step C — Scope discipline.** Also attest, in the same form, that you created nothing duplicating an existing surface and nothing outside this task's assigned scope.

**Step D — Resolve, then re-attest.** For every DEVIATION: state what diverged (your value vs the declared value — this is the failure reason), correct it with `edit_file`, then re-run Steps A–C. Repeat until no DEVIATION remains.

**Gate**: emit `<done>true</done>` ONLY when every touchpoint is PASS and scope is clean. While any DEVIATION stands, you are not done.

**Constraint**: this step is read-and-correct, not build/typecheck/test — do NOT run build, dev, or test commands here.
