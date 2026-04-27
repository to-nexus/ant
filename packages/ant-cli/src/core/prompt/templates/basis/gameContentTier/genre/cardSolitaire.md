## Genre: Card Solitaire

**Activation gate**: `gameContentTier.genre === 'cardSolitaire'`.

### One-liner

Card-solitaire promises **legal-stack manipulation** — the player observes a tableau of card stacks where each card carries a suit and a rank, identifies a legal placement (rank descends, suit alternates, foundation builds up), and commits the move. The deck slowly drains; the foundations slowly fill; the win condition is reached when every card has been promoted to its foundation pile.

### Defining systems (the project MUST cover all three)

| System category | What this means in code / design |
|---|---|
| **Card model + suit/rank algebra** | Each card is `(suit, rank)` from a fixed universe (4 suits × 13 ranks for Klondike-class; smaller decks for Memory-class; specialized decks for Spider / Mahjong-tiles variants). The project commits the deck composition, the comparator (`rank - 1`, alternating-color? same-suit?), and the printing (numerals + suit pictograms `♠♥♦♣` are the css-only sweet spot). |
| **Tableau structure (stacks + foundations)** | The named layout of card piles: tableau columns (Klondike has 7 with 1..7 face-down + 1 face-up), foundations (one per suit, builds Ace→King), waste / stockpile, free cells (FreeCell variants). The structure is fixed for the variant; only contents move during play. |
| **Legal-move predicate** | The deterministic rule that decides whether a chosen card (or sub-stack) can move to a chosen target: tableau accepts rank-1 alternating-color (Klondike), or rank-1 same-suit (Spider), or any rank into an empty cell (FreeCell free-cell). Foundations accept rank+1 same-suit. The predicate MUST be checkable from board state alone. |

The project's twist — "Klondike with redo limit", "FreeCell with 6 cells instead of 4", "Spider with two suits", "Memory with 12 unique pairs and a flip-back-on-mismatch" — is the SBS payload.

### Coreloop affinity

Natural: `solve` (every move requires reading suit / rank state and predicting downstream consequences). Strong fit: `collect` (each card promoted to foundation is a collected unit, score progression is the payoff). The `GENRE_CORELOOP_MATRIX` exposes both. `survive` mismatches the genre's reflective tone.

### HUD essentials

- **Score** (variant-specific — Klondike has Vegas/Standard scoring, Spider counts moves, Memory counts pair-flips).
- **Move count / hint count** — both surface the player's efficiency relative to the variant's "par".
- **Stock-pile state indicator** — "N cards left in stockpile, M passes available" matters in stockpile-bound variants.
- **Undo button** — solitaire's expected affordance. Commit whether unlimited or cost-bound.

### Concept affinity (guidance, not a hard gate)

Naturally readable concepts: `cardClassic` (the canonical green-felt + white card face + suit pictogram tone — the 1st-class match for this genre), `flatMinimal` (modern app-store solitaire with rounded card corners), `softPastel` (cozy variant with muted hues). `pixelRetro` works for a Game-Boy-era solitaire; `neonArcade` is unusual.

### What NOT to commit at PRD level

- ❌ Specific scoring tables (Vegas vs Standard) — balancing.
- ❌ Card-back / card-face artwork — `gameArtTier`.
- ❌ Per-card animation timing — `gameArtTier.motionPattern` (Phase 4).

### Blind-spot reminders

- ⚠️ **Reachable / unreachable starts** are a real concern in some variants (Klondike has unsolvable shuffles). Commit whether the PRD requires solver-validated deals or accepts random shuffles with restart affordance.
- ⚠️ **Multi-card drag** semantics (selecting a sub-stack from a tableau column) are an interaction-grammar trap — touch interfaces need clear pivot feedback. Single-card drag avoids this but limits play feel.
- ⚠️ **Suit pictogram readability at small font sizes** is the css-only constraint that bites first. The PRD MUST commit a minimum tile size (px or em) that accommodates `♠♥♦♣` plus a 2-character rank.
