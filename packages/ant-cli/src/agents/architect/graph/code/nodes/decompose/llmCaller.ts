/**
 * Decompose LLM Caller
 * 
 * Handles LLM streaming for task decomposition with XML tag parsing
 */

import { LLMClient } from "../../../../../../core/ports";
import { LLM_TEMPERATURE } from "../../../../../common/graph/llmConfig";

/**
 * Call LLM for task decomposition (with streaming for Chat UI)
 * Uses job/node-specific model from workspaceConfig
 */
export async function callLLMForDecompose(
  llm: LLMClient,
  prompt: string,
  workspaceConfig?: any
): Promise<{ response: string; tokenUsage?: any }> {
  console.log('🤖 [Decompose] Calling LLM for task breakdown...');
  
  // ✅ NEW: Use decompose-specific model if configured
  let llmToUse = llm;
  if (workspaceConfig) {
    const { createLLMClient } = await import('../../../../../../periphery/adapters/llm/LLMClientFactory');
    llmToUse = createLLMClient(
      'architect',
      undefined,
      { jobType: 'code', nodeType: 'decompose' },
      workspaceConfig
    );
  }
  
  // ✅ Use streaming with XML parsing (same as codeGen)
  const { getChatAPIClient } = await import('../../../../../../core/adapters/ChatAPIClient');
  const chatAPI = getChatAPIClient();
  await chatAPI.showChatStatus('placeholder');
  
  // ✅ Setup StreamOrchestrator for XML tag handling
  const { XMLStreamParser } = await import('../../../../../../core/streaming/parsers/XMLStreamParser');
  const { CommonRenderStrategy } = await import('../../../../../../core/streaming/strategies/CommonRenderStrategy');
  const { StreamOrchestrator } = await import('../../../../../../core/streaming/StreamOrchestrator');
  
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(chatAPI, 'en', undefined, undefined, false, 'code', undefined);  // No gitPort or fileSystem needed for decompose
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles: new Set()
  });
  
  let response = '';
  let capturedUsage: any = undefined;
  
  for await (const event of llmToUse.stream([
    { role: 'user', content: prompt }
  ], {
    temperature: LLM_TEMPERATURE.DECOMPOSE,
    maxTokens: 16000
  })) {
    await orchestrator.processEvent(event);
    
    if (event.text) {
      response += event.text;
    }
    
    // ✅ Extract token usage from done event
    const { extractTokenUsageFromStreamEvent } = await import('../../../../../common/graph/llmHelpers');
    const usage = extractTokenUsageFromStreamEvent(event);
    if (usage) {
      capturedUsage = usage;
    }
  }
  
  await orchestrator.finalize();
  
  return { response, tokenUsage: capturedUsage };
}
