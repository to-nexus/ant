/**
 * Parse command line arguments
 */
export interface ParsedArgs {
  mode: string;
  inputPath: string;
}

export function parseArgs(args: string[]): ParsedArgs | null {
  const mode = args[0];
  const inputPath = args[1];

  if (!mode || !inputPath) {
    return null;
  }

  return { mode, inputPath };
}

