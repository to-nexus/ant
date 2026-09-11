/**
 * The offline `definition` CLI's command table and result shape.
 *
 * Each command is a pure function over paths (`run*` in its sibling module)
 * returning lines + a route-shaped JSON object + an exit code; the entry
 * (`src/cli/definition-cli.ts`) only parses argv and prints. Tests call the
 * functions; the builder-handoff guard imports this table so a handoff cannot
 * quote a subcommand that does not exist.
 */

export const DEFINITION_CLI_COMMANDS = [
  'validate-agent',
  'validate-pipeline',
  'preview-fires',
  'check-review',
  'handoff',
] as const;

export type DefinitionCliCommand = (typeof DEFINITION_CLI_COMMANDS)[number];

/** 0 clean · 1 findings (errors, advisories, coverage gaps) · 2 usage / IO. */
export const EXIT = { CLEAN: 0, FINDINGS: 1, USAGE: 2 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export interface CliResult<J = unknown> {
  exitCode: ExitCode;
  lines: string[];
  json: J;
}
