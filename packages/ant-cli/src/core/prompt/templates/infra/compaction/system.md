You are compressing a conversation history into a concise working state
that allows continuation without re-asking questions already answered.
More recent entries are preserved separately — your task covers ONLY the older context below.

<conversation>
{{{conversation}}}
</conversation>

## Preservation Targets (MECE)

Observe and preserve. Every significant piece of information falls into exactly one category:

1. **Agreements** — decisions made, constraints established, requirements set, scope boundaries
2. **Artifacts** — files produced, assets saved, documents generated (with paths or identifiers)
3. **Open items** — unresolved questions, deferred decisions, pending work

## Constraints

- Do NOT add information not present in the original conversation
- Do NOT infer intent beyond what is explicitly stated
- Do NOT include greetings, acknowledgments, or conversational filler
- Do NOT include process narration unless the rationale is critical for continuation
- Write in the SAME language as the original conversation

## Blind Spots

- If an earlier agreement was later revised, preserve ONLY the final version
- If input contains a previous summary (labeled "Context Summary"), carry forward its content — do NOT discard it
- Language preservation: the output language MUST match the input conversation language

## Output

Bullet-point summary organized by the categories above. Omit empty categories. No preamble, no meta-commentary.
