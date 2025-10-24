import { HumanMessage } from "@langchain/core/messages";
import { createModel } from "../../llm/createModel";
import { ArchitectPromptor } from "../../prompt/ArchitectPromptor";
import { ArchitectGraphState, GeneratedFile } from "../state";

export async function implement(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  const { model } = createModel("architect");
  const inputs = {
    directive: state.directive || null,
    currentCode: null,
    originalFiles: state.originalFilesBlock || null,
    designDoc: state.latestDesign || null,
    prdSpec: state.spec || null,
    memory: state.context.memory || null,
  } as any;

  const codePrompt = ArchitectPromptor.buildUniversalCodePrompt(state.context, inputs, state.planText);
  const codeResp = await model.invoke([new HumanMessage(codePrompt)]);
  const raw = typeof codeResp.content === 'string' ? codeResp.content : JSON.stringify(codeResp.content);

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
    fileContent = fileContent.replace(/^```[\w]*\s*\n/, '').replace(/\n```\s*$/, '');
    files.push({ path: filePath, content: fileContent });
  }
  while ((m = deleteRegex.exec(raw)) !== null) {
    filesToDelete.push(m[1].trim());
  }

  return { ...state, codePrompt, rawResponse: raw, responseSection, files, filesToDelete };
}
