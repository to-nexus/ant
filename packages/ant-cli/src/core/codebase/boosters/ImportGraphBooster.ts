import * as path from "path";
import { FileWithSource } from "../types";
import { ImportGraphAnalyzer } from "../ImportGraphAnalyzer";

/**
 * Import Graph Booster
 * 
 * Boosts priority of Git changed files that are connected
 * to relevant files via import relationships.
 */
export class ImportGraphBooster {
  
  /**
   * Boost files using import graph connections
   * 
   * @param files - Files from hybrid search
   * @param gitChanges - Git changed files (empty if no Git or no changes)
   * @param importGraph - Import graph analyzer
   * @returns Files with boosted priorities and Git change tracking
   */
  async boost(
    files: FileWithSource[],
    gitChanges: string[],
    importGraph: ImportGraphAnalyzer | null
  ): Promise<FileWithSource[]> {
    
    // ✅ Early return: No Git or no changes
    if (gitChanges.length === 0) {
      console.log('   📝 Git boost: skipped (no Git or no changes)');
      return files;
    }

    const changedSet = new Set(gitChanges.map(f => path.normalize(f)));
    const relevantPaths = files.map(f => path.normalize(f.path));
    const relevantSet = new Set(relevantPaths);

    // Track which files to boost
    const boostedFiles = new Set<string>();
    const addedFiles: FileWithSource[] = [];

    if (importGraph) {
      console.log('   🔗 Git boost: using import graph...');
      
      // Check each Git changed file
      for (const changedFile of gitChanges) {
        const normalized = path.normalize(changedFile);
        
        // Case 1: Changed file is already in search results
        if (relevantSet.has(normalized)) {
          boostedFiles.add(normalized);
          continue;
        }
        
        // Case 2: Changed file is connected to relevant files
        const connectedTo = relevantPaths.filter(relevantPath =>
          importGraph.isConnected(normalized, relevantPath)
        );
        
        if (connectedTo.length > 0) {
          // Add the changed file (it's connected!)
          addedFiles.push({
            path: normalized,
            sources: [{
              type: 'import-graph',
              connectedTo: connectedTo.map(p => path.basename(p))
            }],
            priority: 'high',
            hasLocalChanges: true
          });
          
          boostedFiles.add(normalized);
          console.log(`      🔗 ${path.basename(normalized)} → ${connectedTo.length} relevant files`);
        }
      }
    } else {
      console.log('   📝 Git boost: simple overlap check...');
      
      // Simple overlap: boost files that are both changed and relevant
      for (const file of files) {
        const normalized = path.normalize(file.path);
        if (changedSet.has(normalized)) {
          boostedFiles.add(normalized);
        }
      }
    }

    // Apply boosting to existing files
    const boosted = files.map(file => {
      const normalized = path.normalize(file.path);
      const isChanged = changedSet.has(normalized);
      const isBoosted = boostedFiles.has(normalized);
      
      if (isChanged) {
        return {
          ...file,
          sources: [...file.sources, { type: 'git-changed' as const }],
          priority: 'high' as const,
          hasLocalChanges: true
        };
      } else if (isBoosted) {
        return {
          ...file,
          priority: 'high' as const,
          hasLocalChanges: false
        };
      }
      
      return file;
    });

    // Merge with added files
    const result = [...addedFiles, ...boosted];

    // Sort: high priority first
    result.sort((a, b) => {
      if (a.priority === b.priority) return 0;
      return a.priority === 'high' ? -1 : 1;
    });

    const highPriorityCount = result.filter(f => f.priority === 'high').length;
    const changedCount = result.filter(f => f.hasLocalChanges).length;

    console.log(`   🔥 Git boost: ${highPriorityCount} high priority, ${changedCount} changed files`);

    return result;
  }
}

