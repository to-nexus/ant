## Contract Parity Verification

### Principle
**Production and virtualized adapters MUST yield observationally equivalent
outputs for the same input — same field names, same types, same optionality,
same error mapping. Any divergence is a contract violation that retries with
a fix plan, not a benign warning.**

### Observation targets
- Field set symmetry (no extra / missing fields between modes)
- Type symmetry (a numeric field must not become a string in the other mode)
- Optionality symmetry (a field nullable in one mode but not the other)
- Error mapping symmetry (the same failure surfaces as the same error class)
- Status code mapping symmetry (HTTP / domain error codes match)

### Constraints
- A virtualized body MAY differ in concrete values; the observable shape
  MUST NOT differ
- Tests written against the production interface MUST pass against the
  virtualized adapter unchanged
- An adapter pair that "almost matches" is a defect — fix the adapter,
  never the test
- The runtime activates a virtualized adapter via env var only; the
  selection mechanism MUST NOT introduce shape drift

### Blind Spot
**Adapter divergence is silent when only one mode is exercised in
verification.** Two-pass verification (one pass with virtualization
active, one with the production adapter active) is the only structural
way to catch it. A passing single-mode build is not evidence that the
other mode would pass.
