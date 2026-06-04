{{> jobs/code/basis/techTier/framework/_entry-points-shared-registry}}

**Decompose (task breakdown)**: unit creation belongs to feature-band tasks (so units exist before registration); the navigator/registry is owned by exactly ONE `integration` task — do NOT scatter navigator edits across feature tasks, and do NOT emit a per-unit task whose sole job is to register into the navigator.
