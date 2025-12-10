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

  // Show placeholder while waiting for LLM
  await chatAPI.showChatStatus('placeholder');

  // Load system prompt
  const promptPath = path.join(
    __dirname,
    '../../../../../core/prompt/templates/learn/system.md'
  );
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

  // Call LLM with streaming for thinking display
  const combinedPrompt = `${systemPrompt}\n\n---\n\nUser Request:\n${state.spec}`;
  
  if (!llm.stream) {
    throw new Error('LLM client does not support streaming');
  }
  
  // Setup stream orchestrator for thinking display
  const { StreamOrchestrator } = await import('../../../../../core/streaming/StreamOrchestrator');
  const { XMLStreamParser } = await import('../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { detectUserLanguage } = await import('../../../../../core/utils/languageDetector');
  
  // ✅ Detect user language for localized messages
  const userLanguage = detectUserLanguage(state.spec);
  
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(chatAPI, userLanguage, undefined, false, undefined);
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles: new Set(),
  });
  
  let responseText = '';
  for await (const event of llm.stream([{ role: 'user', content: combinedPrompt }])) {
    // Pass to orchestrator for UI display
    await orchestrator.processEvent(event);
    
    // Collect text for parsing
    if (event.type === 'text' && event.text) {
      responseText += event.text;
    }
  }
  
  // Finalize orchestrator (this ends the thinking message)
  await orchestrator.finalize(false);
  
  console.log('✅ [Decompose] LLM thinking completed');

  // Parse <learn_command> tag
  const commandMatch = responseText.match(/<learn_command>\s*([\s\S]*?)\s*<\/learn_command>/);
  if (!commandMatch) {
    console.log('⚠️  [Learn] No <learn_command> tag found, defaulting to learn_text');
    // Fallback: treat as raw text
    return {
      command: {
        action: 'learn_text',
        text: state.spec
      } as LearnCommand
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
    console.log('   Falling back to learn_text');
    // Fallback
    return {
      command: {
        action: 'learn_text',
        text: state.spec
      } as LearnCommand
    };
  }
}

