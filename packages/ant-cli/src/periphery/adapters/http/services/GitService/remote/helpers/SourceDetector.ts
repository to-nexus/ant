import * as fs from 'fs';
import * as path from 'path';

/**
 * SourceDetector
 * 
 * Detects the actual source root in a cloned repository.
 * Some repos have nested structure like:
 * - repo-name/
 *   - src/  <-- actual source is here
 *   - README.md
 * 
 * This detector identifies if the source is in a subdirectory.
 */
export class SourceDetector {
  /**
   * Detect source root in cloned repository
   * 
   * @param repoPath - Path to cloned repository
   * @returns Subdirectory name if nested, null if source is at repo root
   */
  static async detect(repoPath: string): Promise<string | null> {
    const entries = await fs.promises.readdir(repoPath, { withFileTypes: true });
    
    // Common source indicators (prioritized)
    const sourceIndicators = [
      'package.json',
      'Cargo.toml',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'setup.py',
      'composer.json'
    ];
    
    // Check if source indicators exist at root
    const hasSourceAtRoot = sourceIndicators.some(indicator =>
      entries.some(e => e.name === indicator && e.isFile())
    );
    
    if (hasSourceAtRoot) {
      // Repo root is the source
      return null;
    }
    
    // Look for common wrapper directories
    const wrapperCandidates = ['src', 'codebase', 'code', 'source', 'app'];
    
    for (const candidate of wrapperCandidates) {
      const candidateEntry = entries.find(e => 
        e.name === candidate && e.isDirectory()
      );
      
      if (!candidateEntry) continue;
      
      const candidatePath = path.join(repoPath, candidate);
      const candidateEntries = await fs.promises.readdir(candidatePath, { withFileTypes: true });
      
      // Check if this directory has source indicators
      const hasSourceInCandidate = sourceIndicators.some(indicator =>
        candidateEntries.some(e => e.name === indicator && e.isFile())
      );
      
      if (hasSourceInCandidate) {
        // Found source in nested directory
        return candidate;
      }
      
      // Also check for common source directories
      const hasSourceDirs = candidateEntries.some(e =>
        e.isDirectory() && ['src', 'lib', 'app', 'components'].includes(e.name)
      );
      
      if (hasSourceDirs) {
        return candidate;
      }
    }
    
    // No wrapper detected, use repo root
    return null;
  }
}

