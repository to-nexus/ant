# Quickstart

Get Ant running and produce your first generated code in under 10 minutes.

## Prerequisites

You have:

- Node 18.17+, pnpm 9+, Docker, an Anthropic or OpenAI API key.
- Cloned the repo and run `pnpm install`. If not, see
  [installation](installation.md).

## 1. Start everything

```bash
# Boot Redis + ChromaDB
pnpm dev:infra

# Configure your LLM key
cp packages/ant-cli/.env.example.local packages/ant-cli/.env
# Edit packages/ant-cli/.env:
#   ANT_ANTHROPIC_API_KEY=sk-ant-...
#   ANT_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Run all 4 backend processes + the UI
pnpm dev:local:all
```

You should see five concurrent log streams: `cli`, `ui`, optionally `site`,
plus `realtime-server`, `job-worker`, `preview-server` if you use the
per-process scripts. The UI will say it is listening on
[http://localhost:5173](http://localhost:5173).

## 2. Open the UI

Visit [http://localhost:5173](http://localhost:5173). The setup wizard will
ask you to:

1. **Create a project** — name, repository type (default *cloud* metadata,
   but everything stays on your machine in local mode), domain (pick
   `service` for web/backend; the `game` domain is **in development** and
   not recommended for first-time use).
2. **Create a feature** — a feature is a unit of work inside a project.
   Conceptually it's a branch + workspace.

## 3. Write your first directive

In the chat panel, type a directive. Some good first directives:

- `Build a TODO app with React and Tailwind. Show due dates and group by priority.`
- `Build a marketing landing page with hero, features grid, and pricing.`
- `Build a REST API in Express that exposes /users and /posts with SQLite.`

Send the directive. Ant will:

1. Run the `triage` and `detect` phases to classify the request.
2. Pick an execution tier (Reflex / OneShot / Exploratory / Task / RefsGrounded).
3. For Tier 3+, decompose into tasks. The kanban panel will fill with cards.
4. Run `plan` and `execute` phases per task. The agent's tool calls (file
   writes, shell commands) appear live in the workflow stream.
5. Save outputs into `workspaces/<project>/<feature>/codebase/`.

Read [concepts/jobs.md](../concepts/jobs.md) for what each phase does, and
[concepts/execution-tiers.md](../concepts/execution-tiers.md) for the tier
matrix.

## 4. Open the live preview

If your feature builds a frontend, the preview server starts a dev server
inside the feature workspace and exposes it at
[http://localhost:5173/preview/<feature-id>](http://localhost:5173) (the UI
proxies it). Hot reload follows file writes.

## 5. Iterate

Send follow-up directives. Each one becomes a new job; the running session
state is reused so the agent has the context of what just shipped.

Useful follow-ups:

- `Review the code for security issues.` — `rev-code` intent.
- `Explain how the auth flow works.` — `explain-code` intent.
- `Add a dark mode toggle.` — feature task on the existing codebase.

## What just happened?

You ran a 4-process modular monolith locally:

```
ant-api (4100)  ────┐
ant-realtime(4101)──┼── Redis Pub/Sub + BullMQ ── ant-job (worker)
ant-preview (4102)──┘                                    │
                                                          ▼
                                              spawned: job-runner
                                              executes LangGraph
```

The UI talks to `ant-api` over HTTP and to `ant-realtime` over SSE. Job
state, kanban snapshots, and intermediate streams flow through Redis.

## Common follow-up tasks

| Task                                  | Where                                         |
|---------------------------------------|-----------------------------------------------|
| Add a Figma source                    | [guides/design-input/figma-mcp.md](../guides/design-input/figma-mcp.md) |
| Drop a Claude design bundle           | [guides/design-input/claude-handoff.md](../guides/design-input/claude-handoff.md) |
| Customize prompts                     | [guides/custom-prompts.md](../guides/custom-prompts.md) |
| Deploy to your cloud                  | [guides/cloud-deployment.md](../guides/cloud-deployment.md) |
| Tear down infra                       | `pnpm dev:infra:down`                         |

If something didn't work, see [troubleshooting](troubleshooting.md).
