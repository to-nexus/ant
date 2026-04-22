import { getTechTier } from '@ant/shared';
import { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';
import { ArchitectGraphState } from '../../state';

export function extractTags(lessons: string, directive: string = ''): string[] {
  const text = (lessons + ' ' + directive).toLowerCase();
  
  const keywords = [
    'auth', 'authentication', 'login', 'jwt', 'bcrypt', 'session',
    'api', 'endpoint', 'rest', 'graphql', 'http',
    'database', 'sql', 'orm', 'prisma', 'mongodb',
    'react', 'component', 'hook', 'state', 'redux',
    'async', 'await', 'promise', 'callback',
    'error', 'validation', 'security', 'encryption',
    'test', 'testing', 'jest', 'unit-test',
    'performance', 'optimization', 'cache',
    'ui', 'ux', 'design', 'css', 'style',
    'typescript', 'javascript', 'python', 'go',
    'docker', 'kubernetes', 'deploy', 'ci/cd',
    'git', 'github', 'version-control',
    'refactor', 'clean-code', 'architecture'
  ];
  
  return keywords.filter(k => text.includes(k));
}

/**
 * Extract structured lessons from code generation state
 * 
 * Problem-Solution-Outcome format:
 * - Focus on actionable knowledge
 * - Reference documents, don't include full content
 * - Keep under 1KB to prevent OOM
 */
export function extractCodeLessons(state: ArchitectGraphState): string {
  const problem = extractProblem(state);
  const solution = extractSolution(state);
  const outcome = extractOutcome(state);
  const patterns = extractPatterns(state);
  const antipatterns = extractAntipatterns(state);
  const relatedFiles = extractRelatedFiles(state);
  const references = extractReferences(state);
  const tags = extractTags(problem + solution, state.directive || '');
  
  return `
## Lesson: ${state.currentTask?.name || 'Unknown Task'}

### Problem
${problem}

### Solution
${solution}

### Outcome
${outcome}

### Patterns Applied
${patterns.length > 0 ? patterns.map(p => `- ${p}`).join('\n') : '- None'}

### Mistakes Avoided
${antipatterns.length > 0 ? antipatterns.map(a => `- ${a}`).join('\n') : '- None'}

### Related Files
${relatedFiles.length > 0 ? relatedFiles.map(f => `- ${f}`).join('\n') : '- None'}

### References
${references.map(r => `- ${r}`).join('\n')}

### Tags
${tags.join(', ')}

### Context
- **Project**: ${state.context.project}
- **Feature**: ${state.context.featureFolder || 'main'}
- **Mode**: ${state.resolvedAction?.mode || 'auto'}
- **Language**: ${getTechTier(state)?.language || 'unknown'}
- **Framework**: ${getTechTier(state)?.framework || 'N/A'}
- **Timestamp**: ${new Date().toISOString()}
  `.trim();
}

function extractProblem(state: ArchitectGraphState): string {
  const directive = state.directive || state.currentTask?.description || 'No problem description';
  return directive.substring(0, 300) + (directive.length > 300 ? '...' : '');
}

function extractSolution(state: ArchitectGraphState): string {
  const parts: string[] = [];

  const filesToDelete = state.filesToDelete || [];
  if (filesToDelete.length > 0) {
    parts.push(`deleted ${filesToDelete.length} file(s)`);
  }

  parts.push(`using ${state.resolvedAction?.mode || 'generate'} mode`);

  const _techTier = getTechTier(state);
  if (_techTier) {
    parts.push(`with ${_techTier.language}${_techTier.framework ? ` + ${_techTier.framework}` : ''}`);
  }

  return parts.join(', ') + '.';
}

function extractOutcome(state: ArchitectGraphState): string {
  const violations = state.violations || [];
  if (violations.length === 0 && state.retries === 0) {
    return '✅ **Success** - All quality checks passed on first attempt';
  } else if (state.retries > 0 && violations.length === 0) {
    return `✅ **Success** - Issues resolved after ${state.retries} retry(ies)`;
  } else if (state.retries > 0 && violations.length > 0) {
    return `⚠️ **Partial** - ${violations.length} issue(s) remain after ${state.retries} retry(ies)`;
  } else {
    return `❌ **Issues** - ${violations.length} unresolved issue(s)`;
  }
}

function extractAntipatterns(state: ArchitectGraphState): string[] {
  const antipatterns: string[] = [];
  const violations: any[] = state.violations || [];
  
  for (const v of violations.slice(0, 3)) {
    if (typeof v === 'string') {
      const text: string = v;
      antipatterns.push(text.substring(0, 80) + (text.length > 80 ? '...' : ''));
    } else if (v && typeof v === 'object') {
      const msg = `${v.type}: ${v.message}`.substring(0, 80);
      antipatterns.push(msg + (msg.length >= 80 ? '...' : ''));
    }
  }
  
  return antipatterns;
}

function extractRelatedFiles(_state: ArchitectGraphState): string[] {
  // Observability consumers read `git diff` post-run for the file list.
  return [];
}

function extractReferences(state: ArchitectGraphState): string[] {
  const poolView = new ArtifactPoolView(state.artifacts || []);
  const refs: string[] = [];
  
  const firstDesign = poolView.firstDesignContent();
  if (firstDesign) {
    const designTitle = extractDesignTitle(firstDesign);
    refs.push(`Design: ${designTitle}`);
  }
  
  if (state.directive) {
    const directiveId = extractDirectiveId(state);
    refs.push(`Directive: ${directiveId}`);
  }
  
  if (poolView.hasSources()) {
    refs.push(`PRD: Available in documents collection`);
  }
  
  return refs.length > 0 ? refs : ['No references'];
}

function extractDesignTitle(designContent: string): string {
  const titleMatch = designContent.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    return titleMatch[1].substring(0, 50);
  }
  return 'Design Document';
}

function extractDirectiveId(state: ArchitectGraphState): string {
  const sessionId = (state as any).sessionId || 'unknown';
  const runId = (state as any).runId || 0;
  return `${sessionId.substring(0, 8)}-run-${runId}`;
}

function extractPatterns(state: ArchitectGraphState): string[] {
  const patterns: string[] = [];

  const _tt = getTechTier(state);
  if (_tt?.framework) {
    patterns.push(_tt.framework);
  }

  if (state.resolvedAction?.mode) {
    patterns.push(state.resolvedAction.mode);
  }

  return patterns.length > 0 ? patterns : ['general-implementation'];
}
