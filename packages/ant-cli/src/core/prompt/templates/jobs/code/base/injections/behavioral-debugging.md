# Behavioral Debugging

**Universal principles and protocols for debugging runtime behavior bugs across all domains.**

════════════════════════════════════════════════════════════════════════════════

## Core Philosophy

**Behavioral bugs cannot be diagnosed from code alone.**

Static analysis (type checking, linting, code review) catches structural errors.
Runtime analysis (observation, logging, hypothesis testing) catches behavioral errors.

**Key Distinction:**
- **Structural bug**: Code doesn't compile, has type errors, wrong syntax
- **Behavioral bug**: Code compiles but produces wrong behavior at runtime

**Core Principle:** Static analysis reveals structural flaws. Dynamic observation reveals behavioral flaws.

You cannot diagnose behavioral bugs from code inspection alone. Runtime behavior must be observed, measured, and analyzed against expectations.

**Key Insight:** Behavioral systems have emergent properties not visible in static code structure. State interactions, timing relationships, and environmental dependencies only manifest at runtime.

════════════════════════════════════════════════════════════════════════════════

## Universal Bug Categories

### 1. Unit Inconsistency Bugs

**Principle:** Systems with implicit unit conversions fail when assumptions don't match reality.

**Common Manifestations:**
- **Time**: milliseconds vs seconds, timestamps vs durations
- **Data size**: bytes vs kilobytes, bits vs bytes
- **Currency**: cents vs dollars, different currency codes
- **Distance/scale**: pixels vs viewport units, absolute vs relative

**Root Cause Pattern:**
```
Value passed between subsystems
→ Each assumes different unit
→ Silent conversion or no conversion
→ Order-of-magnitude error
```

**Symptoms:**
- Values "too large" or "too small" by 10x, 100x, 1000x
- Timeouts/delays happening instantly or never
- Data truncation or overflow
- Rate limiting failing (too strict or too permissive)

**Design Principle:**
- Explicit conversion at system boundaries
- Type system to encode units (e.g., `Milliseconds`, `Seconds`)
- Document expected units in signatures/types
- Never conditional conversion based on value magnitude

────────────────────────────────────────────────────────────────────────────────

### 2. State Management Bugs

**Principle:** State must have single source of truth with clear ownership and update semantics.

**Common Manifestations:**
- Stale state (UI shows old value)
- State mutation instead of replacement (immutability violated)
- Race conditions (async updates in wrong order)
- Lost updates (multiple updates, only last survives)

**Root Cause Pattern:**
```
Multiple sources of truth OR unclear ownership
→ Updates happen out of sync
→ Different parts of system see different state
```

**Symptoms:**
- UI doesn't reflect actual state
- State "resets" unexpectedly
- Updates don't trigger re-renders/reactions
- Intermittent behavior (works sometimes, fails other times)

**Design Principle:**
- Single source of truth per state value
- Immutable updates (replace, don't mutate)
- Centralized state updates (not scattered)
- State snapshots for debugging/time-travel

────────────────────────────────────────────────────────────────────────────────

### 3. Timing and Sequence Bugs

**Principle:** Async operations require explicit ordering guarantees.

**Common Manifestations:**
- Race conditions (winner depends on timing)
- Premature execution (runs before dependency ready)
- Event ordering violations (events processed out of order)
- Infinite loops or recursion (termination condition never met)

**Root Cause Pattern:**
```
Assumptions about execution order
→ Actual order differs (async, event-driven)
→ Code runs in wrong sequence
```

**Symptoms:**
- "Sometimes works, sometimes doesn't"
- Errors only under load/slow network
- Different behavior in dev vs prod
- Functions called before initialization

**Design Principle:**
- Explicit async coordination (promises, locks, queues)
- Dependency injection to control initialization order
- Event sequence validation
- Idempotent operations where possible

────────────────────────────────────────────────────────────────────────────────

### 4. Boundary and Threshold Bugs

**Principle:** Edge cases at boundaries reveal implicit assumptions.

**Common Manifestations:**
- Off-by-one errors (< vs <=, array bounds)
- Integer overflow/underflow
- Floating point precision issues
- Null/undefined handling
- Empty collection handling

**Root Cause Pattern:**
```
Algorithm assumes "normal" values
→ Boundary value violates assumption
→ Unexpected code path taken
```

**Symptoms:**
- Works for "normal" values, fails at extremes
- Crashes on empty input
- Wrong results for edge values (0, 1, max)
- Infinite loops or early termination

**Design Principle:**
- Explicit boundary handling
- Defensive checks for empty/null/undefined
- Use inclusive or exclusive consistently
- Type system to prevent invalid states

════════════════════════════════════════════════════════════════════════════════

## The Five-Stage Debugging Protocol

### Stage 1: Hypothesis Formation

**Principle:** Form falsifiable hypotheses about root cause.

**Requirements for valid hypothesis:**
1. **Specific**: Names exact mechanism causing symptom
2. **Testable**: Specifies what evidence would prove/disprove it
3. **Causal**: Explains how mechanism produces observed symptom
4. **Measurable**: Identifies observable values that validate/invalidate claim

**Classification first:**
- Does it involve values being wrong magnitude? → Unit Inconsistency
- Does state not update/persist correctly? → State Management
- Does it happen intermittently/out of order? → Timing/Sequence
- Does it fail only at extremes/edges? → Boundary/Threshold

**Meta-cognitive check:**
- Can you state what runtime observation would disprove this hypothesis?
- If not, hypothesis is too vague to test

────────────────────────────────────────────────────────────────────────────────

### Stage 2: Instrumentation Strategy

**Principle:** Add minimal, targeted observation points at critical system boundaries.

**Instrumentation priorities:**
1. **Input boundaries**: Where external data enters system
2. **State transitions**: Before and after state mutations
3. **Decision points**: Conditions that determine control flow
4. **Output boundaries**: Where system produces effects
5. **Error paths**: Exception handlers and fallback logic

**Instrumentation guidelines:**
- Log at system boundaries (where values enter/exit)
- Log before and after state changes
- Log decision points (if/else, loops)
- Include context (function name, relevant values)
- Use structured format ([CATEGORY] message)

**Anti-patterns:**
- ❌ "Logging everything" → Signal drowns in noise
- ❌ Random logging → No systematic diagnostic value
- ❌ Logging without hypothesis → Fishing expedition

**Meta-principle:** Each log statement should test a specific aspect of your hypothesis.

────────────────────────────────────────────────────────────────────────────────

### Stage 3: Runtime Execution

**Principle:** Observe system behavior in environment where bug manifests.

**Execution environment requirements:**
- Same conditions as bug manifestation (data, state, timing)
- Observable outputs (logs, console, network inspector)
- Reproducible scenario (can repeat observation)
- Controlled variables (isolate single hypothesis at a time)

**Observation methodology:**
- Run system through scenario that triggers symptom
- Record all instrumented outputs
- Note timing, sequence, and magnitude of events
- Preserve full execution trace for analysis

────────────────────────────────────────────────────────────────────────────────

### Stage 4: Evidence Analysis

**Principle:** Compare observed behavior against predicted behavior to validate hypothesis.

**Analysis framework:**
1. **Expected values**: What should metrics/states/sequences be?
2. **Observed values**: What did runtime actually show?
3. **Deviation magnitude**: How different? (off by factor of 10? 1000?)
4. **Deviation pattern**: Systematic or random? Consistent or intermittent?

**Look for patterns:**
- Values outside expected range (magnitude checks)
- Missing state updates (no logs for expected change)
- Wrong sequence (events logged out of order)
- Repetition (same event every frame/request)

**Decision criteria:**
- **Hypothesis confirmed**: Observations match predictions precisely → Fix
- **Hypothesis rejected**: Observations contradict predictions → New hypothesis
- **Inconclusive**: Insufficient data → Add more targeted instrumentation

**Critical skill:** Recognizing magnitude deviations
- Off by 10x/100x/1000x → Unit conversion error
- Off by 1-2x → Calculation error or rounding
- Sporadic → Race condition or timing dependency

────────────────────────────────────────────────────────────────────────────────

### Stage 5: Fix Verification

**Principle:** Applied fix must eliminate symptom without introducing regressions.

**Verification requirements:**
1. **Symptom elimination**: Original problem no longer occurs
2. **Mechanism validation**: Instrumentation shows corrected values
3. **Regression check**: Existing functionality still works
4. **Edge case testing**: Fix holds under boundary conditions

**After applying fix:**
1. Run same test scenario
2. Confirm logs show corrected values
3. Verify symptom is gone
4. Check no new issues introduced
5. Test edge cases

**Re-instrumentation:**
After fix, keep instrumentation active during verification.
Confirm not just that symptom disappeared, but that mechanism now operates correctly.

════════════════════════════════════════════════════════════════════════════════

## Domain-Agnostic Debugging Patterns

### Pattern 1: Value Magnitude Deviation

**Symptom:** Values are wrong by orders of magnitude (10x, 100x, 1000x)

**Common causes:**
- Unit inconsistency (milliseconds treated as seconds)
- Scale mismatch (pixels vs viewport units)
- Missing/double conversion

**Diagnostic approach:**
- Log value at entry point, at transformation, at use point
- Check: Does value make physical sense at each point?
- Verify: Are units explicitly converted or assumed?

────────────────────────────────────────────────────────────────────────────────

### Pattern 2: Temporal Compression/Expansion

**Symptom:** Events that should take time happen instantly (or vice versa)

**Common causes:**
- Time unit confusion
- Async coordination failure
- State machine skipping states

**Diagnostic approach:**
- Log timestamps at state transitions
- Measure time deltas between events
- Verify: Is time being scaled somewhere?

────────────────────────────────────────────────────────────────────────────────

### Pattern 3: Event Flooding

**Symptom:** Single-occurrence event fires continuously

**Common causes:**
- Termination condition never met
- Event not consumed/cleared after processing
- State not updated after event

**Diagnostic approach:**
- Count event frequency (should be rare, observed as constant)
- Log state before/after event processing
- Verify: Is state change preventing re-trigger?

────────────────────────────────────────────────────────────────────────────────

### Pattern 4: Premature Termination

**Symptom:** Process ends before expected completion

**Common causes:**
- End condition evaluated with wrong initial state
- State initialization order incorrect
- Conditional logic inverted

**Diagnostic approach:**
- Log initialization sequence (what state is set when)
- Log end condition evaluation (what values trigger it)
- Verify: Is end condition checked before initialization complete?

════════════════════════════════════════════════════════════════════════════════

## Expected Value Ranges (Domain-Specific)

Use these to spot anomalies:

### Web Applications

| Metric | Normal Range | Red Flag |
|--------|--------------|----------|
| HTTP latency | 10-500ms | >2000ms or <1ms |
| Request size | 100B-1MB | >10MB (check unit) |
| Timeout | 5-60 seconds | >300s or <100ms |
| Cache TTL | 60s-3600s | >86400s or <1s |
| Rate limit | 10-1000/min | >10000/min (check unit) |

### Real-time Applications (Games, Chat, Streaming)

| Metric | Normal Range | Red Flag |
|--------|--------------|----------|
| Frame time | 8-33ms (30-120 FPS) | >50ms or <5ms |
| Frame deltaTime (seconds) | 0.008-0.033s | >0.1s (unit confusion) |
| Event rate | 1-60/second | >100/second (flooding) |
| State update lag | <50ms | >200ms |
| Input latency | 10-50ms | >100ms |

### Data Processing

| Metric | Normal Range | Red Flag |
|--------|--------------|----------|
| Batch size | 10-1000 records | >10000 (check pagination) |
| Processing time | 100ms-5s/batch | >30s (timeout risk) |
| Memory per record | 100B-10KB | >100KB (leak?) |
| Retry attempts | 1-5 | >10 (infinite retry?) |

**Usage:**
When debugging, compare observed values against these ranges.
Values outside range suggest unit confusion or logic error.

════════════════════════════════════════════════════════════════════════════════

## Meta-Debugging: When Protocol Fails

**If hypothesis repeatedly rejected:**
1. **Question assumptions**: What are you assuming is true?
2. **Broaden scope**: Is bug in different subsystem than suspected?
3. **Check environment**: Is runtime environment configured correctly?
4. **Simplify**: Create minimal reproduction case

**If symptoms inconsistent:**
1. **Timing dependency**: Add more precise timestamps
2. **Race condition**: Look for async coordination issues
3. **External state**: Check if external systems affect behavior

**If fix causes regression:**
1. **Shared dependency**: Fixed component used in multiple contexts
2. **Hidden coupling**: Components more interconnected than understood
3. **Over-correction**: Fix addresses symptom but breaks mechanism

════════════════════════════════════════════════════════════════════════════════

## Success Criteria

You have successfully debugged when:

- [ ] Root cause identified through evidence (not speculation)
- [ ] Fix addresses mechanism, not symptom
- [ ] Verification shows corrected behavior
- [ ] No regressions introduced
- [ ] Understanding of why bug occurred (prevents similar bugs)

**Critical indicator:** Can you explain the causal chain from root cause to symptom?

If not, you've only suppressed the symptom, not fixed the bug.

════════════════════════════════════════════════════════════════════════════════

## Debugging Skill Progression

**Level 1 (Reactive):**
- See error message → guess fix → try
- No systematic approach
- Multiple random attempts

**Level 2 (Methodical):**
- Read error → identify file/line → examine code
- Make educated guess → apply fix
- 1-3 attempts usually sufficient for simple bugs

**Level 3 (Hypothesis-Driven):** ← Target level
- Classify bug category → form hypothesis → test with logging
- Analyze evidence → validate hypothesis → fix root cause
- Single attempt for most bugs

**Level 4 (Predictive):**
- Recognize pattern from symptoms → predict location
- Minimal instrumentation needed
- Fix on first try

**Your Goal:** Operate at Level 3 (Hypothesis-Driven) for all behavioral bugs.

════════════════════════════════════════════════════════════════════════════════

## Debugging Checklist

For every behavioral bug:

- [ ] **Classify**: Which bug category? (Unit/State/Timing/Boundary)
- [ ] **Hypothesize**: Specific, testable claim about root cause
- [ ] **Instrument**: Add strategic logging to gather evidence
- [ ] **Execute**: Run application and observe actual behavior
- [ ] **Analyze**: Does evidence support hypothesis?
- [ ] **Fix**: Apply minimal change to address root cause
- [ ] **Verify**: Confirm fix resolves issue, no regression

**Critical: Do not skip runtime execution for behavioral bugs.**

Static analysis cannot reveal behavioral errors.

════════════════════════════════════════════════════════════════════════════════

## Integration with Development Workflow

**For behavioral bugs, this protocol is mandatory, not optional.**

Static validation (type checking, linting, building) cannot catch behavioral errors.
Runtime observation is the only valid verification method.

**Workflow integration:**
1. Classify bug: Structural (static) or Behavioral (runtime)?
2. If Behavioral → Apply this protocol
3. If Structural → Use static analysis tools

**Do not skip runtime verification for behavioral bugs.**
