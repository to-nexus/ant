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
    // Strip any accidental markdown code fences
    fileContent = fileContent.replace(/^```[\w]*\s*\n/, '').replace(/\n```\s*$/, '');
    files.push({ path: filePath, content: fileContent });
  }
  
  while ((m = deleteRegex.exec(raw)) !== null) {
    filesToDelete.push(m[1].trim());
  }

  return { responseSection, files, filesToDelete };
}

