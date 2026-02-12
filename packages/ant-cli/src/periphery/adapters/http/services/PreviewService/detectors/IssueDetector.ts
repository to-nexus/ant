import * as fs from 'fs';
import * as path from 'path';
import { PreviewIssue, PreviewIssueReasoning } from '../types';

/**
 * IssueDetector
 * 
 * Detects potential issues in frontend projects that may affect preview server operation.
 * Issues can be fatal (blocking) or warnings (non-blocking).
 */
export class IssueDetector {
  /**
   * Detect non-fatal issue when frontend API base isn't compatible with dynamic backend ports.
   * This is best-effort (heuristic) and should NOT block dev server startup.
   */
  async detectApiBaseIssue(frontendPath: string): Promise<PreviewIssue | null> {
    try {
      const srcPath = path.join(frontendPath, 'src');
      const viteConfigCandidates = [
        path.join(frontendPath, 'vite.config.ts'),
        path.join(frontendPath, 'vite.config.js'),
      ];
      
      let hasConfigurableApiBase = false;
      for (const p of viteConfigCandidates) {
        if (!fs.existsSync(p)) continue;
        const c = await fs.promises.readFile(p, 'utf8');
        if (c.includes('VITE_API_BASE_URL') || c.includes("'/api'") || c.includes('\"/api\"')) {
          hasConfigurableApiBase = true;
        }
      }
      
      // Scan a limited subset of src files for API base usage patterns
      const files: string[] = [];
      const stack = [srcPath];
      const maxFiles = 200;
      while (stack.length && files.length < maxFiles) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (files.length >= maxFiles) break;
          if (e.name.startsWith('.')) continue;
          if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) stack.push(full);
          else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(full);
        }
      }
      
      let hasEnvApiBase = false;
      let hasHardcodedHttpLocal = false;
      let usesRelativeApi = false;
      
      for (const f of files) {
        try {
          const c = await fs.promises.readFile(f, 'utf8');
          if (c.includes('VITE_API_BASE_URL')) hasEnvApiBase = true;
          if (c.includes("'/api/") || c.includes('\"/api/')) usesRelativeApi = true;
          if (/https?:\/\/localhost:\d+/.test(c)) hasHardcodedHttpLocal = true;
        } catch {
          // ignore
        }
      }
      
      // If they already use env or relative /api or configure proxy, assume OK
      if (hasEnvApiBase || usesRelativeApi || hasConfigurableApiBase) {
        return null;
      }
      
      const reason = hasHardcodedHttpLocal
        ? 'Frontend API client appears to use a fixed localhost URL and may not work with dynamic backend ports.'
        : 'Frontend API client may not be configured for dynamic backend ports in Ant-managed dev servers.';
      
      return {
        reasoning: 'api-base-missing',
        severity: 'warning',
        reason,
        suggestedFix: [
          'This project runs as a fullstack dev server under the Ant platform.',
          'The frontend must read the backend API base URL from the environment.',
          '',
          'Use `import.meta.env.VITE_API_BASE_URL` as the prefix for all API calls:',
          '',
          '```typescript',
          "const API_BASE = import.meta.env.VITE_API_BASE_URL || '';",
          'fetch(`${API_BASE}/api/users`)',
          '```',
          '',
          'The `VITE_API_BASE_URL` is injected automatically by the Ant platform at runtime.',
          'When running outside Ant, it defaults to empty string (direct localhost access).',
          '',
          'Alternatively, route API calls through a stable relative path (e.g., `/api`)',
          'and rely on Vite dev server proxy routing.',
        ].join('\n')
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Combine multiple issue fixes into a single LLM-ready prompt.
   * Order: fatal first, then warnings (stable).
   */
  combineIssueFixes(issues: PreviewIssue[]): string | undefined {
    const withFix = issues.filter(i => i.suggestedFix && i.suggestedFix.trim().length > 0);
    if (withFix.length === 0) return undefined;
    const ordered = [...withFix].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'fatal' ? -1 : 1));
    return ordered.map(i => i.suggestedFix!.trim()).join('\n\n---\n\n');
  }
  
  /**
   * Create a fatal issue from validation result
   */
  createFatalIssue(
    reasoning: PreviewIssueReasoning,
    reason: string,
    suggestedFix?: string
  ): PreviewIssue {
    return {
      reasoning,
      severity: 'fatal',
      reason,
      suggestedFix
    };
  }
}
