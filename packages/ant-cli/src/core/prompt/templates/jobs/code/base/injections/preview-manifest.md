## Preview Provisioning Manifest

**Principle**: A backend whose runtime depends on a prepared persistent store (existing tables / collections / namespaces) cannot serve requests against the empty store the preview platform brings up on each start. The platform runs the store as a fresh, ephemeral dependency — its volumes are wiped every start — so a **declared provisioning step** must prepare the store before the application boots. The platform executes only what is declared; it infers nothing about your stack, ORM, or migration tooling.

### Where the declaration lives

**Constraint**: Provisioning commands are declared in a single checked-in file at the project root: `ant.manifest.json`. This file is git-tracked, user-editable, and survives resets. It is the ONE source — there is no auto-detection and no out-of-band configuration.

```json
{
  "preview": {
    "setupCommands": ["<command run at the project root>"],
    "packages": {
      "<package-path-relative-to-root>": { "setupCommands": ["<command run in that package>"] }
    }
  }
}
```

| Field | Meaning | Runs in |
|-------|---------|---------|
| `preview.setupCommands` | Project-level provisioning (single-package projects, or shared root steps) | project root |
| `preview.packages[<src>].setupCommands` | Per-package provisioning in a monorepo; `<src>` is the package directory path relative to the project root | that package directory |

- A monorepo declares **one** manifest at the root with a `packages` entry per backend that needs provisioning — do NOT scatter manifests into sub-packages.
- Each package's commands run with that package's resolved environment, so a command that reads the database connection sees the same value the running app will use.

### Deciding the commands (principle, not enumeration)

**Principle**: Derive the provisioning command from how THIS project's persistence tooling applies a schema — observe the project, do not assume a tool.

- If the project carries a committed migration history, declare the command that **applies** those migrations.
- If the project has no migration history and relies on schema synchronization, declare the command that **syncs** the schema to the store.
- If preparing the store requires seeding reference data the app assumes on boot, declare the seed command after the schema command.

**Constraint**: Declared commands run on EVERY preview start against a freshly-created store. They MUST be idempotent — re-running them on an already-prepared (or empty) store must not fail.

**Constraint**: Declare the command exactly as it is invoked in this project (the project's own scripts or its tooling's CLI). Do NOT declare a command for tooling the project does not actually use.

### Scope boundary

**Constraint**: This manifest declares only the **boot-time apply step** — the command the platform runs to bring the persistent store to the schema the code expects. Authoring the schema-definition artifact itself (the migration / DDL / schema file that matches the code's queries) is owned by the persistence-schema rule, not by this contract. The two are paired: the schema artifact defines the schema; this manifest declares the command that applies it.

### Blind spot

⚠️ **A backend that queries a store but declares no provisioning command boots against an empty store**, and every query fails at runtime with no build or type error — the preview appears to start, then errors continuously. When this task adds or relies on a persistence layer, verify `ant.manifest.json` declares a command that prepares its store. When fixing a backend whose preview fails on empty-schema errors, the missing or wrong `setupCommands` declaration is the first thing to inspect.
