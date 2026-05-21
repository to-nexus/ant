### Handoff entries: code-shaped vs token-shaped

A handoff text-kind entry can be one of two shapes:

- **Token-shaped** — declarative values and configs whose meaning is the
  literal content: design-token declarations (e.g. CSS custom properties),
  pure design-token JSON, markdown specs and notes, yaml configs. These
  may be transcribed into the output.
- **Code-shaped** — files that demonstrate HOW a designer prototyped the
  experience using SOME framework, markup system, or runtime — framework
  components, page markup, runtime scripts, and any CSS / styling file
  whose rules embed framework selectors, utility-class bridges, or
  build-tool conventions. A code-shaped file is NOT a contract over how
  the target codebase implements that experience.

If you cannot decide which shape a file is, assume **code-shaped** — the
constraint below is strictly safer than transcribing implementation as if
it were a token.

For **code-shaped** entries, the file is **design intent observation**, NOT
an implementation source.

- **Extract**: layout, hierarchy, spacing, colour, typography,
  micro-interactions, accessibility cues, copy / labels.
- **Reimplement**: in the target codebase's framework, conventions, imports,
  and existing sibling files — observe what siblings already do in the
  target codebase before producing markup.

### Constraint (Do NOT transplant)

- Do NOT verbatim copy markup, classNames, imports, hooks, library calls,
  or framework-specific syntax from a handoff code-shaped file into output.
- Do NOT add a dependency to the manifest solely because a handoff file
  used it — depend only on libraries the target codebase already chose or
  the task explicitly requires.
- Do NOT preserve the handoff file's directory structure, file-name
  casing, or export style — match siblings in the target codebase instead.

### Authority composition (complement to Visual Source Authority)

The Visual Source Authority section partitions WHAT (system-design) vs
HOW-it-looks (active UI source). This partial adds an orthogonal partition
on top of that, for handoff specifically:

- Active UI source (handoff) wins on **design intent** — visuals, layout,
  micro-interactions, and the literal values inside token-shaped entries.
- Target codebase (siblings, ANTRULES.md, framework config) wins on
  **implementation** — file organisation, naming, imports, framework
  primitives, dependency choices.
- When the two views collide inside a code-shaped file, take intent;
  drop implementation.

### Blind spot reminder

⚠️ Reading one framework-component file in the handoff invites pasting the
whole component into the target codebase in one shot. This is the dominant
failure mode and the entire reason this discipline exists. If your `<file>`
output mirrors a handoff code-shaped file's structure line-by-line, you
are transplanting — re-derive from the intent extraction above instead.
