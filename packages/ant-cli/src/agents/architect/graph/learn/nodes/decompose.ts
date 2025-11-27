/**
 * Learn Decompose Node
 * 
 * LLM이 자연어를 분해(decompose)하여 정규화된 명령으로 변환
 */

import { LearnGraphState, LearnCommand } from "../state";
import * as fs from "fs";
import * as path from "path";

export async function decompose(state: LearnGraphState): Promise<Partial<LearnGraphState>> {
  const llm = state.deps?.llm;
  if (!llm) {
    throw new Error("LLM not provided for analysis");
  }

  // Get ChatAPI for status updates
  const { getChatAPIClient } = await import('../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();

  // Show analyzing status
  await chatAPI.addChatStatus({
    type: 'thinking',
    message: 'Analyzing your learning request...'
  });

  // Load system prompt
  const promptPath = path.join(
    __dirname,
    '../../../../../core/prompt/templates/learn/system.md'
  );
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

  // Call LLM
  const response = await llm.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: state.spec }
  ]);

  // Parse <learn_command> tag
  const commandMatch = response.content.match(/<learn_command>\s*([\s\S]*?)\s*<\/learn_command>/);
  if (!commandMatch) {
    // Fallback: treat as raw text
    return {
      command: {
        action: 'learn_text',
        text: state.spec
      }
    };
  }

  try {
    const command: LearnCommand = JSON.parse(commandMatch[1]);
    
    // Validate command
    if (!['index_branch', 'index_codebase', 'learn_files', 'learn_text'].includes(command.action)) {
      throw new Error(`Invalid action: ${command.action}`);
    }

    console.log(`✅ [Learn] Parsed command:`, JSON.stringify(command, null, 2));

    return { command };
  } catch (error) {
    console.error('⚠️  Failed to parse learn command:', error);
    // Fallback
    return {
      command: {
        action: 'learn_text',
        text: state.spec
      }
    };
  }
}

