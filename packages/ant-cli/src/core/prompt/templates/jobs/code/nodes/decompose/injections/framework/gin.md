{{> jobs/code/basis/techTier/framework/_entry-points-shared-registry}}

**Decompose (task breakdown)**: handler creation belongs to feature-band tasks (so handlers exist before route registration); the router setup is owned by exactly ONE `integration` task — do NOT scatter router-registration edits across feature tasks.
