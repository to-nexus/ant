────────────────────────────────────────────────────────────────────────────────
### Persistence schema initialization (language- and stack-neutral)
────────────────────────────────────────────────────────────────────────────────

**Principle**: Code that reads or writes a persistent store assumes that store exists. The design describes schema conceptually; it does not emit executable schema definitions. The code job must close that gap.

**Constraint**: When you add a persistence layer that assumes existing tables, collections, or namespaces, you MUST also add the artifact that creates or initializes that schema so the application can run. Use the project's normal mechanism for the stack in use. Ensure the schema is applied before the application depends on it (e.g. on first run or via a documented step).

**Constraint**: Schema definitions MUST match the queries and mutations you write (names, types). Derive them from the same design or spec the persistence code uses.

**Blind spot**: It is easy to implement persistence code that queries the store and omit the step that creates it, causing runtime failures. Always pair "code that uses schema" with "artifact that creates schema."
