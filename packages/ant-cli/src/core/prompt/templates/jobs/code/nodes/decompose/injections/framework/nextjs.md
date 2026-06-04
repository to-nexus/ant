{{> jobs/code/basis/techTier/framework/_entry-points-file-per-route}}

**Decompose (task breakdown)**: a per-route page is part of the `create` list of the task that authors that route's unit — do NOT emit a separate route-integration task to wire per-route pages. Only the shared frame / host entry gets a dedicated `integration` task.
