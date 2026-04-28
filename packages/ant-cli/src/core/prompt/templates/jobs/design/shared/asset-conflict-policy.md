### Conflict resolution between PRD/GDD prose and Figma source

When the PRD/GDD prose (planned via `gen-plan`) and the Figma export (`visual/ui/figma/figma.json` or live MCP exploration) disagree about the same surface, **classify the conflict by axis** before resolving. Do not silently pick one side — the partial below is the canonical matrix downstream design follows.

#### Axis classification

| Axis | Examples | Authority |
|---|---|---|
| **Visual** | layout / colour / spacing / typography / iconography / illustration | **Figma wins for visual** — the file is the SSOT for what users see |
| **Behavior** | state machine / data policy / permission / routing intent / validation rule / error semantics | **PRD/GDD wins for behavior** — the prose is the SSOT for what the system does |
| **Ambiguous** | structural-but-not-clearly-visual (modal vs full-screen, drawer vs page, nested vs flat IA) | **cite-first**, hold judgement, log to §Open Questions |

#### Role-aware precedence (consult AFTER axis classification)

The decompose-time pool exposes each artifact with `role="ref"` (authoritative) or `role="context"` (background reference, deliberately demoted by the user). Use the following rules in conjunction with the axis matrix:

1. **Both `role="ref"`** (most common; intent matrix activates both as defaults, or the user explicitly promoted both):
   apply the visual / behavior / ambiguous matrix above.
2. **Asymmetric — one `role="ref"`, the other `role="context"`**:
   the `ref` side is the authoritative source for ALL axes. The user demoted the `context` side on purpose; treat it as supplementary reference only and let `ref` decide visual AND behaviour. Note the asymmetry in §Open Questions if the resulting design contradicts what the demoted artifact suggested.
3. **Both `role="context"`** (rare; neither is promoted):
   no clear ground truth. Cite both, hold judgement on every axis, log to §Open Questions and ask the upstream pipeline to promote one to `ref`.

#### Surface every conflict

For every conflict the design encounters — visual, behavior, ambiguous, or asymmetric — emit a §Open Questions entry with the form:

```
- [conflict] {axis}: PRD/GDD says "{prose}" (PRD §X / SC-Y), Figma shows "{frame name / nodeId}". Resolved by {axis-rule}; {note}.
```

This keeps the design output auditable even when the matrix above gives a clean answer.

#### refine-mode stale-source detection

When operating in refine mode (`rev-ui` / `rev-game-art`), check whether the PRD/GDD or Figma source is stale relative to the other:

- Compare PRD/GDD git commit timestamp against Figma `last_modified` (when available via MCP) or the figma.json export timestamp.
- If one side trails the other by an obvious margin (newer plan vs older Figma export, or vice versa), record the stale side in §Open Questions even if the matrix above produces a winner — the conflict is likely a sync gap rather than a design intent.
- Do NOT silently override either side based on timestamps alone. The matrix above is still authoritative; the timestamp is a hint that the upstream pipeline should re-sync.
