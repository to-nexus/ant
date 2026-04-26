## Genre: Casual

**Activation gate**: `gameContentTier.genre === 'casual'`.

### One-liner

Casual promises **immediate engagement, short sessions, low cognitive cost** — the player learns the verb in under a minute, plays for 2–10 minutes, and quits without losing meaningful state.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **One-touch (or one-axis) input** | The verb is a single tap, drag, or swipe. Multi-button inputs disqualify a game from "casual" classification — that is fine but the genre commitment changes. |
| **One-screen scope** | The play state fits on one screen (with optional scroll on one axis). No camera systems, no inventory deep-screens. |
| **Session-length cap** | The stated maximum length of one play session, in minutes. Casual without a length cap (endless runners, infinite scrollers) MUST commit how the player chooses to stop. |

The twist: "tap-to-jump endless runner with daily-best score and 90-second target session" is a commitment; "easy fun game" is empty.

### Coreloop affinity

The coreLoop depends on the directive. The most common pairings are:

- Endless runner → `collect` (collect coins / dodge obstacles)
- Match-game → `solve`
- Idle game → `build` (very slow tempo)
- Hyper-casual physics → `solve` (one-shot puzzles)

When the directive does not name a loop, surface as an open question rather than picking silently.

### HUD essentials

- **Score** — minimum and often only readout.
- **Session timer / progress** — when the session length is bounded explicitly.
- **Daily best / streak** — when the design uses meta-progression to drive return.

A casual HUD with more than 3 readouts is suspect — the genre's promise is "low cognitive cost".

### What NOT to commit at PRD level

- ❌ Multiple difficulty modes — casual has one default.
- ❌ Tutorial sequences longer than the first session's run — casual learns by playing.
- ❌ Long-form narrative — casual narrative is a single sentence at boot.

### Blind-spot reminders

- ⚠️ A casual game with a **steep input curve** (combo systems, charge-and-release with timing) is no longer casual. State the input scope clearly.
- ⚠️ **Persistence model** (save state across sessions, daily reset, no save) is a tone-defining decision.
- ⚠️ **Monetization hooks** (rewarded ads, IAP) live outside this overlay — but if present, the PRD MUST commit at what cycle boundary they fire (mid-session vs end-session).
