import { HumanMessage } from "@langchain/core/messages";
import { createModel } from "../../llm/createModel";
import { ArchitectGraphState, GeneratedFile } from "../state";

export async function enforce(state: ArchitectGraphState, reasonHeader: string): Promise<ArchitectGraphState> {
  const { model } = createModel("architect");
  const prompt = `${reasonHeader}\n\n${state.codePrompt}`;
  const resp = await model.invoke([new HumanMessage(prompt)]);
  const raw = typeof resp.content === 'string' ? resp.content : JSON.stringify(resp.content);

  const responseRegex = /=== RESPONSE ===\n([\s\S]*?)\n=== END RESPONSE ===/;
  const fileRegex = /=== FILE: (.+?) ===\n([\s\S]*?)\n=== END FILE ===/g;
  const deleteRegex = /=== DELETE: (.+?) ===/g;

  const responseMatch = responseRegex.exec(raw);
  const responseSection = responseMatch ? responseMatch[1].trim() : state.responseSection || null;

  const files: GeneratedFile[] = [];
  const filesToDelete: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = fileRegex.exec(raw)) !== null) {
    const filePath = m[1].trim();
    let fileContent = m[2].trim();
    fileContent = fileContent.replace(/^```[\w]*\s*\n/, '').replace(/\n```\s*$/, '');
    files.push({ path: filePath, content: fileContent });
  }
  while ((m = deleteRegex.exec(raw)) !== null) {
    filesToDelete.push(m[1].trim());
  }

  return { ...state, rawResponse: raw, responseSection, files, filesToDelete };
}
