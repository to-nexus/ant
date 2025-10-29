import { GeneratedFile } from "../state";

/**
 * Parse LLM response to extract files and response section
 */
export function parseResponse(raw: string): {
  responseSection: string | null;
  files: GeneratedFile[];
  filesToDelete: string[];
} {
  const responseRegex = /=== RESPONSE ===\n([\s\S]*?)\n=== END RESPONSE ===/;
  const fileRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
  const deleteRegex = /=== DELETE: (.+?) ===/g;

  const responseMatch = responseRegex.exec(raw);
  const responseSection = responseMatch ? responseMatch[1].trim() : null;

  const files: GeneratedFile[] = [];
  const filesToDelete: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = fileRegex.exec(raw)) !== null) {
    const filePath = m[1].trim();
    let fileContent = m[2].trim();
    
    // ✅ Strip any accidental markdown code fences (at start/end)
    fileContent = fileContent.replace(/^```[\w]*\s*\n/, '').replace(/\n```\s*$/, '');
    
    // ✅ Also handle if the entire file is wrapped in markdown
    if (fileContent.startsWith('```')) {
      const lines = fileContent.split('\n');
      // Remove first line if it's a code fence
      if (lines[0].match(/^```[\w]*$/)) {
        lines.shift();
      }
      // Remove last line if it's a code fence
      if (lines.length > 0 && lines[lines.length - 1].match(/^```\s*$/)) {
        lines.pop();
      }
      fileContent = lines.join('\n').trim();
    }
    
    files.push({ path: filePath, content: fileContent });
  }
  
  while ((m = deleteRegex.exec(raw)) !== null) {
    filesToDelete.push(m[1].trim());
  }

  return { responseSection, files, filesToDelete };
}

