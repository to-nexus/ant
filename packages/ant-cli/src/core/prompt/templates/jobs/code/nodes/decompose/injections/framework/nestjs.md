{{> jobs/code/basis/techTier/framework/_entry-points-shared-registry}}

**Decompose (task breakdown)**: controller/service/module creation belongs to feature-band tasks (so they exist before module registration); the root module composition is owned by exactly ONE `integration` task — do NOT scatter root-module `imports` edits across feature tasks.
