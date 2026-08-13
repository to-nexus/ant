# Examples

Worked examples that ship in this repository but are **not product code**. They
are here to be read and copied, not to run in production.

| Example | What it shows |
|---|---|
| [`mcp-reference-server/`](mcp-reference-server/) | The **external** side of an MCP integration: a fixture-only ops incident/SLA server (streamable HTTP + stdio, bearer auth) that the team owning a domain copies and refills with its own API. |
| [`custom-agents/ops-team/`](custom-agents/ops-team/) | The **Ant** side: an agent with two jobs — one that declares the connection above, one that deliberately does not. |

The two halves are one end-to-end example, split at the seam. Read
[docs/guides/custom-agent-authoring.md](../docs/guides/custom-agent-authoring.md)
alongside them.

## This tree is not loaded at runtime

The distinction that is easy to get wrong:

|  | `examples/custom-agents/` | `packages/ant-cli/src/core/data/agents/` |
|---|---|---|
| Loaded by the runtime | **no** — copy it to use it | yes, as the read-only `builtin` scope |
| Shipped in an image | no | yes |
| May declare `mcp.servers` | **yes — the point of the example** | **no** |

`builtin` is wired in
[`core/customAgents/scopeRoots.ts`](../packages/ant-cli/src/core/customAgents/scopeRoots.ts)
and gated by `tests/customAgents/builtin-agents.test.ts`, which asserts every
shipped agent declares zero MCP servers — an MCP server runs arbitrary code and
depends on credentials a shipped sample cannot assume. That is precisely why the
MCP example lives here instead, and the same test file has a second block that
holds *this* tree to the opposite contract.

## Using the agent definitions

Definitions are account-owned. Copy the agent into your account root and it is
available to every project you own:

```bash
cp -r examples/custom-agents/ops-team \
      "$ANT_WORKSPACE_BASE_PATH/{org}/{user}/.ant/agents/"
```

The path mirrors the destination one-to-one — `examples/custom-agents/ops-team/`
→ `.ant/agents/ops-team/`. Then register the credential the definition
references (`OPS_API_TOKEN`, whose value is the full `Bearer <token>` string)
and start the server from the repository root:

```bash
pnpm build:example:mcp
MCP_AUTH_TOKEN=dev-token pnpm start:example:mcp    # :8931
```

Both steps in full, plus stdio mode and the smoke test, are in
[`mcp-reference-server/README.md`](mcp-reference-server/README.md); the
end-to-end walkthrough is
[custom-agent-authoring.md](../docs/guides/custom-agent-authoring.md).

## Repository wiring

`examples/*` is a `pnpm-workspace.yaml` member, so `pnpm install` at the repo
root installs these too and CI typechecks them. No Dockerfile copies this
directory — every image `COPY`s `packages/` selectively — so nothing here
reaches a runtime image.
