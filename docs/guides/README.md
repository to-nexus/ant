# Guides

How-to guides for deploying, extending, and operating Ant. These assume
you've read the [concepts](../concepts/) docs at least once.

| Guide                                                              | When to read                                              |
|--------------------------------------------------------------------|-----------------------------------------------------------|
| [../local-mode/install.md](../local-mode/install.md)               | Self-host on one machine (laptop / single VM, no OAuth).  |
| [../cloud-mode/install.md](../cloud-mode/install.md)               | Managed account or self-host cloud (OAuth, K8s).          |
| [design-input/](design-input/)                                     | Bring your own design — Claude / Figma / native tokens.   |
| [custom-agent-authoring](custom-agent-authoring.md)                | Define a custom agent/job (universal runtime) with files. *(Experimental.)* |
| [custom-prompts](custom-prompts.md)                                | Tune Ant's prompt templates for your stack or codebase.   |
| [observability](observability.md)                                  | Logging, debug artifacts, metric strategy.                |

If you're looking for runtime defaults and config knobs, see
[reference/env-vars.md](../reference/env-vars.md).

Worked examples that pair with these guides — a reference MCP server and the
agent definitions that consume it — live in
[examples/](../../examples/README.md).
