/**
 * Learn Resolve Node
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations (not fs directly)
 */

import * as path from "path";
import { LearnGraphState } from "../state";

function extractPaths(spec: string): string[] {
  const re = /(?:^|\s)(\/{1}[^\s]+|\.?\/?[^\s]+\.[a-zA-Z0-9]+)(?=\s|$)/g;
  const paths: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec)) !== null) {
    paths.push(m[1]);
  }
  return Array.from(new Set(paths));
}

export async function resolve(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const gitPort = state.deps?.git;
  if (!gitPort) {
    throw new Error("GitPort not provided for file operations");
  }
  
  // ✅ Get ChatAPI client for file read tracking
  const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  
  const base = state.context.workingDir;
  const targets = extractPaths(state.spec);
  const texts: string[] = [];

  if (targets.length) {
    for (const t of targets) {
      const abs = path.isAbsolute(t) ? t : path.join(base, t);
      const repoRoot = await gitPort.getRepoRoot();
      const relativePath = path.relative(repoRoot, abs);
      
      const exists = await gitPort.fileExists(relativePath);
      if (exists) {
        // Check if it's a file or directory
        try {
          // ✅ Send reading status
          await chatAPI.addReadingFile(relativePath);
          
          const content = await gitPort.readFile(relativePath);
          if (content) {
            // It's a file
            texts.push(content);
            
            // ✅ Send read complete
            await chatAPI.addReadComplete(relativePath);
          }
        } catch {
          // Might be a directory - try to read it
          try {
            const entries = await gitPort.readDirectory(relativePath);
            for (const entry of entries) {
              if (!entry.isDirectory) {
                const filePath = path.join(relativePath, entry.name);
                
                // ✅ Send reading status
                await chatAPI.addReadingFile(filePath);
                
                const fileContent = await gitPort.readFile(filePath);
                if (fileContent) {
                  texts.push(fileContent);
                  
                  // ✅ Send read complete
                  await chatAPI.addReadComplete(filePath);
                }
              }
            }
          } catch {
            // Skip
          }
        }
      }
    }
  }

  if (!texts.length) {
    texts.push(state.spec);
  }

  return { targets, texts };
}
