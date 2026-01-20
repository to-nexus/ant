/**
 * Ask Response Generator
 * 
 * Generates responses to Ant system questions using LLM.
 * Uses static knowledge, job definitions, and workspace state.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AskContext, AskResponse, AskDependencies, StaticKnowledge } from './types.js';
import { WorkspaceState } from '../../agents/common/nodes/triage/types.js';
import { AgentRegistry } from '../../agents/common/nodes/triage/AgentRegistry.js';
import type { LLMStreamEvent } from '../ports/llm.js';

/**
 * AskResponseGenerator
 * 
 * Generates contextual responses to Ant system questions.
 */
export class AskResponseGenerator {
  private staticKnowledge: StaticKnowledge | null = null;
  
  /**
   * Load static knowledge files
   */
  async loadStaticKnowledge(): Promise<StaticKnowledge> {
    if (this.staticKnowledge) {
      return this.staticKnowledge;
    }
    
    const guideDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../prompt/templates/triage/guide'
    );
    
    const loadFile = (filename: string): string => {
      const filePath = path.join(guideDir, filename);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      return '';
    };
    
    this.staticKnowledge = {
      agentOverview: loadFile('agent-overview.md'),
      workflow: loadFile('workflow.md'),
      outputs: loadFile('outputs.md'),
      features: loadFile('features.md'),
      jobGuide: '', // Deprecated, use AgentRegistry instead
    };
    
    return this.staticKnowledge;
  }
  
  /**
   * Generate response to user question
   */
  async generate(
    context: AskContext,
    deps: AskDependencies
  ): Promise<AskResponse> {
    // Ensure AgentRegistry is initialized
    await AgentRegistry.initialize();
    
    const knowledge = await this.loadStaticKnowledge();
    const prompt = this.buildPrompt(context, knowledge);
    
    console.log('🤖 [Ask] Generating response...');
    
    const response = await deps.llm.invoke([
      { role: 'user', content: prompt }
    ]);
    
    return this.parseResponse(response);
  }
  
  /**
   * Generate response with streaming support
   * Yields LLM events for real-time display
   */
  async *generateStreaming(
    context: AskContext,
    deps: AskDependencies
  ): AsyncGenerator<LLMStreamEvent, AskResponse> {
    // Ensure AgentRegistry is initialized
    await AgentRegistry.initialize();
    
    const knowledge = await this.loadStaticKnowledge();
    const prompt = this.buildStreamingPrompt(context, knowledge);
    
    console.log('🤖 [Ask] Generating response (streaming)...');
    
    let fullResponse = '';
    
    for await (const event of deps.llm.stream([
      { role: 'user', content: prompt }
    ])) {
      // Yield event for UI streaming
      yield event;
      
      // Accumulate text
      if (event.type === 'text' && event.text) {
        fullResponse += event.text;
      }
    }
    
    return {
      inScope: true,
      content: fullResponse,
      suggestions: [],
    };
  }
  
  /**
   * Build prompt for streaming (no JSON wrapper, pure text response)
   */
  private buildStreamingPrompt(context: AskContext, knowledge: StaticKnowledge): string {
    const { userQuestion, workspaceState, currentJob, currentAgent, language } = context;
    
    // Get job information from AgentRegistry (YAML data)
    const jobCapabilities = AgentRegistry.generatePromptContext();
    
    const workspaceStateText = this.formatWorkspaceState(workspaceState);
    
    return `# ASK SYSTEM

You are an assistant that answers questions about the Ant development system.
You have access to Ant system knowledge and the user's current workspace state.

Reference the appropriate section based on the question type.

## ANT SYSTEM KNOWLEDGE

### [SECTION 1: OVERVIEW] - What is Ant, supported languages/frameworks, project types
${knowledge.agentOverview}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### [SECTION 2: JOB CAPABILITIES] - Job definitions, modes, prerequisites
${jobCapabilities}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### [SECTION 3: WORKFLOW] - How to use Ant, step-by-step guides, scenarios
${knowledge.workflow}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### [SECTION 4: OUTPUTS] - What Ant generates, document contents, file structures
${knowledge.outputs}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### [SECTION 5: FEATURES] - How to use Ant features, settings, Git integration
${knowledge.features}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## CURRENT CONTEXT

**Current Agent**: ${currentAgent || 'Not selected'}
**Current Job**: ${currentJob || 'Not selected'}

## WORKSPACE STATE

${workspaceStateText}

## USER QUESTION

${userQuestion}

## INSTRUCTIONS

### Section Reference Guide
| Question Type | Refer To |
|---------------|----------|
| "What is Ant?", "What languages supported?" | SECTION 1: OVERVIEW |
| "What jobs available?", "What prerequisites?" | SECTION 2: JOB CAPABILITIES |
| "How do I start?", "What workflow for X?" | SECTION 3: WORKFLOW |
| "What does Ant generate?", "What's in ui-spec?" | SECTION 4: OUTPUTS |
| "How to set up Git?", "How to push?", "Config?" | SECTION 5: FEATURES |

### Response Rules

1. **In-scope questions** (about Ant system):
   - Reference the appropriate section(s) above
   - Cross-reference CURRENT CONTEXT and WORKSPACE STATE
   - Suggest concrete next steps based on current state

2. **Codebase questions** (about project code):
   - Guide user to use Code Job with their question
   - Example: "To find that in your codebase, use Code Job and ask the same question"

3. **Out-of-scope questions** (general knowledge):
   - Politely explain this is outside Ant's scope
   - Provide examples of questions you can help with

4. **Language**: Respond in ${language === 'ko' ? 'Korean' : 'English'}

5. **Format**: Respond directly in plain text. Do NOT wrap in JSON or XML tags.

Respond to the user's question now.`;
  }
  
  /**
   * Build LLM prompt with all context
   */
  private buildPrompt(context: AskContext, knowledge: StaticKnowledge): string {
    const { userQuestion, workspaceState, currentJob, currentAgent, language } = context;
    
    // Get job information from AgentRegistry (YAML data)
    const jobCapabilities = AgentRegistry.generatePromptContext();
    
    const workspaceStateText = this.formatWorkspaceState(workspaceState);
    
    return `# ASK SYSTEM

You are an assistant that answers questions about the Ant development system.
You have access to Ant system knowledge and the user's current workspace state.

Reference the appropriate section based on the question type.

## ANT SYSTEM KNOWLEDGE

### [SECTION 1: OVERVIEW] - What is Ant, supported languages/frameworks, project types
${knowledge.agentOverview}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### [SECTION 2: JOB CAPABILITIES] - Job definitions, modes, prerequisites
${jobCapabilities}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### [SECTION 3: WORKFLOW] - How to use Ant, step-by-step guides, scenarios
${knowledge.workflow}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### [SECTION 4: OUTPUTS] - What Ant generates, document contents, file structures
${knowledge.outputs}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### [SECTION 5: FEATURES] - How to use Ant features, settings, Git integration
${knowledge.features}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## CURRENT CONTEXT

**Current Agent**: ${currentAgent || 'Not selected'}
**Current Job**: ${currentJob || 'Not selected'}

## WORKSPACE STATE

${workspaceStateText}

## USER QUESTION

${userQuestion}

## INSTRUCTIONS

### Section Reference Guide
| Question Type | Refer To |
|---------------|----------|
| "What is Ant?", "What languages supported?" | SECTION 1: OVERVIEW |
| "What jobs available?", "What prerequisites?" | SECTION 2: JOB CAPABILITIES |
| "How do I start?", "What workflow for X?" | SECTION 3: WORKFLOW |
| "What does Ant generate?", "What's in ui-spec?" | SECTION 4: OUTPUTS |
| "How to set up Git?", "How to push?", "Config?" | SECTION 5: FEATURES |

### Response Rules

1. **In-scope questions** (about Ant system):
   - Reference the appropriate section(s) above
   - Cross-reference CURRENT CONTEXT and WORKSPACE STATE
   - Suggest concrete next steps based on current state

2. **Codebase questions** (about project code):
   - Guide user to use Code Job with their question
   - Example: "To find that in your codebase, use Code Job and ask the same question"

3. **Out-of-scope questions** (general knowledge):
   - Politely explain this is outside Ant's scope
   - Provide examples of questions you can help with

4. **Language**: Respond in ${language === 'ko' ? 'Korean' : 'English'}

## RESPONSE FORMAT

<ask_response>
{
  "inScope": true | false,
  "content": "Your response here...",
  "suggestions": ["Follow-up question 1?", "Follow-up question 2?"]
}
</ask_response>

Respond to the user's question.`;
  }
  
  /**
   * Format workspace state for prompt
   */
  private formatWorkspaceState(ws: WorkspaceState): string {
    const lines: string[] = [];
    
    lines.push('### Inputs');
    lines.push(ws.hasPrd ? `✅ PRD: ${ws.prdPath || 'available'}` : '❌ PRD: Not found');
    lines.push(ws.hasDirective ? '✅ Directive: Chat input provided' : '➖ Directive: None');
    
    lines.push('\n### References (for UI Design)');
    lines.push(ws.hasScreens ? `✅ Screens: ${ws.screenCount || 'available'} files` : '❌ Screens: None');
    lines.push(ws.hasComponents ? `✅ Components: ${ws.componentCount || 'available'} files` : '➖ Components: None');
    lines.push(ws.hasAssets ? `✅ Assets: ${ws.assetCount || 'available'} files` : '➖ Assets: None');
    
    lines.push('\n### Design Documents');
    lines.push(ws.hasUiDocs ? '✅ UI Specification: Exists' : '❌ UI Specification: None');
    lines.push(ws.hasSystemDesignDoc ? '✅ System Design: Exists' : '❌ System Design: None');
    lines.push(ws.hasDesignDoc ? '✅ Design Documents: Available' : '❌ Design Documents: None');
    
    lines.push('\n### Codebase');
    lines.push(ws.hasCodebase ? `✅ Indexed: ${ws.indexedFileCount || 'unknown'} files` : '❌ Not indexed');
    
    // Determine what's possible
    lines.push('\n### Available Actions');
    
    if (ws.hasScreens || ws.hasAssets) {
      lines.push('✅ Design Job (UI Design): Ready');
    } else {
      lines.push('❌ Design Job (UI Design): Needs reference images');
    }
    
    if (ws.hasPrd || ws.hasDirective) {
      lines.push('✅ Design Job (System Design): Ready');
    } else {
      lines.push('❌ Design Job (System Design): Needs PRD or directive');
    }
    
    if (ws.hasDesignDoc || ws.hasDirective) {
      lines.push('✅ Code Job: Ready');
    } else {
      lines.push('⚠️ Code Job: Can use with chat directive');
    }
    
    lines.push('✅ Learn Job: Always available');
    
    return lines.join('\n');
  }
  
  /**
   * Parse LLM response
   */
  private parseResponse(response: string): AskResponse {
    const jsonMatch = response.match(/<ask_response>\s*([\s\S]*?)\s*<\/ask_response>/);
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          inScope: parsed.inScope ?? true,
          content: parsed.content || response,
          suggestions: parsed.suggestions || [],
        };
      } catch {
        // Fall through to text extraction
      }
    }
    
    return {
      inScope: true,
      content: response.replace(/<\/?ask_response>/g, '').trim(),
      suggestions: [],
    };
  }
}

// Export singleton instance
export const askResponseGenerator = new AskResponseGenerator();
