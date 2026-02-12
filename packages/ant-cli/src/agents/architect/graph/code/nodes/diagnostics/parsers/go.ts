/**
 * Go Error Parser
 * 
 * Parses Go compiler, go vet, and go build error output.
 * 
 * Go error output formats:
 * - Compiler: ./main.go:10:5: undefined: foo
 * - Vet: ./main.go:15:2: printf: Sprintf format %d has arg str of wrong type string
 * - Module: go: module example.com/foo: not found
 * - Build: # example.com/myapp/cmd/server\n./main.go:10:5: ...
 */

import { BaseErrorParser, ParsedError, ErrorParserOptions } from './base';

export class GoErrorParser extends BaseErrorParser {
  constructor(options: ErrorParserOptions = {}) {
    super(options);
  }

  parse(output: string): ParsedError[] {
    const errors: ParsedError[] = [];
    const lines = output.split('\n');
    const maxErrors = this.options.maxErrors || 100;

    for (let i = 0; i < lines.length && errors.length < maxErrors; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Pattern 1: Go compiler error - file:line:col: message
      const compilerMatch = line.match(/^(.+\.go):(\d+):(\d+):\s+(.+)$/);
      if (compilerMatch) {
        const severity = this.classifySeverity(compilerMatch[4]);
        if (severity === 'warning' && !this.options.includeWarnings) continue;

        errors.push({
          raw: line,
          file: this.resolveFilePath(compilerMatch[1]),
          line: parseInt(compilerMatch[2], 10),
          column: parseInt(compilerMatch[3], 10),
          severity,
          message: compilerMatch[4],
        });
        continue;
      }

      // Pattern 2: Go compiler error - file:line: message (no column)
      const compilerMatch2 = line.match(/^(.+\.go):(\d+):\s+(.+)$/);
      if (compilerMatch2) {
        const severity = this.classifySeverity(compilerMatch2[3]);
        if (severity === 'warning' && !this.options.includeWarnings) continue;

        errors.push({
          raw: line,
          file: this.resolveFilePath(compilerMatch2[1]),
          line: parseInt(compilerMatch2[2], 10),
          severity,
          message: compilerMatch2[3],
        });
        continue;
      }

      // Pattern 3: Module error - go: <message>
      const moduleMatch = line.match(/^go:\s+(.+)$/);
      if (moduleMatch) {
        // Skip informational lines (e.g., "go: downloading ...")
        if (/^downloading\s/.test(moduleMatch[1])) continue;
        if (/^finding\s/.test(moduleMatch[1])) continue;

        errors.push({
          raw: line,
          severity: 'error',
          message: moduleMatch[1],
        });
        continue;
      }

      // Pattern 4: Package header - # <package-path>
      // Just skip, the actual errors follow on next lines
      if (line.startsWith('# ')) {
        continue;
      }

      // Pattern 5: Generic error line containing "error"
      if (/\berror\b/i.test(line) && !line.startsWith('---') && !line.startsWith('ok')) {
        errors.push({
          raw: line,
          severity: 'error',
          message: line,
        });
      }
    }

    return errors;
  }

  /**
   * Classify error severity based on message content.
   * Go treats warnings as errors (compilation fails), but go vet may produce warnings.
   */
  private classifySeverity(message: string): 'error' | 'warning' | 'info' {
    const lowerMsg = message.toLowerCase();

    // Unused imports/variables are compile errors in Go but minor in nature
    if (lowerMsg.includes('imported and not used') ||
        lowerMsg.includes('declared and not used') ||
        lowerMsg.includes('declared but not used')) {
      return 'warning';
    }

    return 'error';
  }

  /**
   * Resolve file path relative to project root.
   */
  private resolveFilePath(filePath: string): string {
    if (!this.options.projectRoot) return filePath;

    // Go errors typically use relative paths (./main.go)
    // Strip leading ./ for consistency
    return filePath.replace(/^\.\//, '');
  }
}
