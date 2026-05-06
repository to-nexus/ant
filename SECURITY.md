# Security Policy

We take the security of Ant seriously. This document describes how to report
vulnerabilities and what to expect from us in return.

## Supported Versions

Ant is in early-stage development. Security fixes are applied to the latest
`main` branch only. Once a numbered release line is announced, the most recent
minor will receive backports for at least 90 days after the next minor ships.

| Version | Supported          |
|---------|--------------------|
| `main`  | :white_check_mark: |
| < 0.x   | :x:                |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, send a private report using one of the following channels:

1. **GitHub Security Advisories** (preferred): use the
   [Report a vulnerability](../../security/advisories/new) button on the
   repository's Security tab. This creates a private, encrypted thread with the
   maintainers.
2. **Email**: `security@ant.example` (replace with the maintainer contact when
   the project transfers to its public org). PGP key fingerprint will be
   published on the repository homepage when available.

Include in your report:

- A clear description of the issue, including the affected component
  (ant-cli / ant-ui / ant-shared / docker image / k8s manifest).
- A minimal reproduction. Stack traces, request/response captures, and
  environment details (Node version, OS, deployment mode) help triage.
- The impact you observed and what you believe an attacker could achieve.
- Whether you have shared the issue with anyone else.

## What to Expect

We acknowledge new reports within **3 business days**. After triage we aim to:

| Severity | Initial Fix Target |
|----------|--------------------|
| Critical | 7 days             |
| High     | 14 days            |
| Medium   | 30 days            |
| Low      | Best effort        |

We will keep you informed about progress and request your input before any
public disclosure. If a fix requires coordinated release with downstream
consumers, we will agree on an embargo window with you.

## Disclosure Policy

Our preferred process is **coordinated disclosure**:

1. You report the issue privately.
2. We confirm and develop a fix.
3. We agree on a disclosure date with you (typically the patch release date).
4. We credit you in the release notes and the security advisory unless you ask
   to remain anonymous.

For issues that are clearly already public (e.g. duplicates of an upstream
dependency CVE), we may publish the advisory and patch on the same day.

## Out of Scope

The following typically do **not** qualify as security vulnerabilities:

- Reports generated solely by automated scanners without a working
  proof-of-concept.
- Self-XSS that requires the victim to paste arbitrary content into their own
  developer console.
- Denial-of-service caused by sending the API millions of requests when the
  deployer has not configured a rate limiter.
- Exposed `.env` / API keys committed by users into their own forks. Run
  `git filter-repo` and rotate credentials.
- Issues affecting unsupported configurations explicitly listed in
  `docs/internals/` as "not production-ready".

## LLM-specific Considerations

Ant integrates LLM providers (Anthropic, OpenAI, etc.) and ships a multi-agent
pipeline that executes tool calls (file I/O, shell, git). When reporting,
please flag whether the issue involves:

- **Prompt injection** that escalates privileges beyond the agent sandbox.
- **Tool-call escape** that lets an LLM read or modify files outside the
  workspace boundary.
- **Credential leakage** through prompt logs or debug artifacts.
- **Workspace isolation** breaks across feature branches or projects.

These categories are first-class to our threat model.

## Responsible Use

Ant ships with sensible defaults but ultimately runs on your infrastructure
and uses your LLM credits. You are responsible for:

- Securing the environment where you deploy `ant-api`, `ant-job`,
  `ant-realtime`, and `ant-preview`.
- Keeping `ANT_ENCRYPTION_KEY` and provider API keys out of source control.
- Auditing any code Ant writes before you merge it. Ant ships verifiers and a
  rubric system, but generated code is your responsibility.

Thank you for helping keep Ant and its users safe.
