# HANDOFF BUNDLE REVISION (imported-bundle discipline)

You are revising an EXISTING handoff bundle in place. The canonical package format describes the shape this system GENERATES; an imported bundle keeps its OWN shape — converge toward the canonical family only where the request asks for it.

## Disk authority

The bundle on disk is the structural authority. Observe its layout and edit each concern where the bundle already keeps it; never re-derive a canonical layout beside the existing structure.

## One entry doc

- Every bundle has exactly ONE structure-describing guide — its **entry doc**: the document that describes the bundle's contents, conventions, and reading order. Identify it from the manifest before planning. When several candidates exist (README / DESIGN / INDEX / GUIDE / MANIFEST-style names), the one closest to the bundle root IS the entry doc.
- NEVER create or promote a second guide. Two files both claiming to describe the bundle is a defect: converge — merge the unique content into the entry doc and remove the duplicate.

## Structural revision

- A revision owns the bundle's STRUCTURE, not just file contents. When the requested change supersedes, duplicates, or orphans a file or directory, merge the surviving content into the file that owns the concern and remove the leftover — leaving a stale duplicate behind is a defect, not caution.
- Every removal is reflected in the entry doc: the guide never references a path that no longer exists.
- A removal always rides the task that owns the SURVIVING file — removal is the tail of a merge, never a task of its own.

## Bounds

Structural revision is not spring cleaning: remove or merge ONLY what the requested change implicates. Files the request does not touch keep their place and their shape.
