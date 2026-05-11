# Guides

How-to guides for deploying, extending, and operating Ant. These assume
you've read the [concepts](../concepts/) docs at least once.

| Guide                                                              | When to read                                              |
|--------------------------------------------------------------------|-----------------------------------------------------------|
| [../local-mode/install.md](../local-mode/install.md)               | Self-host on one machine (laptop / single VM, no OAuth).  |
| [../cloud-mode/install.md](../cloud-mode/install.md)               | Managed account or self-host cloud (OAuth, K8s).          |
| [../infra/cloud-deployment-guide.md](../infra/cloud-deployment-guide.md) | EKS-specific long-form runbook (DevOps audience).     |
| [design-input/](design-input/)                                     | Bring your own design — Claude / Figma / native tokens.   |
| [custom-prompts](custom-prompts.md)                                | Tune Ant's prompt templates for your stack or codebase.   |
| [observability](observability.md)                                  | Logging, debug artifacts, metric strategy.                |

If you're looking for runtime defaults and config knobs, see
[reference/env-vars.md](../reference/env-vars.md).
