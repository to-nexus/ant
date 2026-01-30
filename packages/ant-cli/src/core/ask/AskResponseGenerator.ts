/**
 * Ask Response Generator
 * 
 * Generates responses to Ant system questions using LLM.
 * Uses static knowledge, job definitions, and workspace state.
 * 
 * ✅ FPOP Compliant: Uses template files (base.md, rules.md) for WHAT/HOW separation
 */

import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { AskContext, AskResponse, AskDependencies, StaticKnowledge } from './types.js';
import { WorkspaceState } from '../../agents/common/nodes/triage/types.js';
import { AgentRegistry } from '../../agents/common/nodes/triage/AgentRegistry.js';
import { WorkspacePathResolver } from '../../infrastructure/workspace/WorkspaceResolver.js';
import type { LLMStreamEvent } from '../ports/llm.js';

// Template cache
let askBaseTemplate: Handlebars.TemplateDelegate | null = null;
let askRulesTemplate: Handlebars.TemplateDelegate | null = null;

/**
 * Load ask templates from files
 * Uses WHAT/HOW separation: base.md (WHAT) + rules.md (HOW)
 */
function loadAskTemplates(): { 
  base: Handlebars.TemplateDelegate; 
  rules: Handlebars.TemplateDelegate;
} {
  if (askBaseTemplate && askRulesTemplate) {
    return { base: askBaseTemplate, rules: askRulesTemplate };
  }
  
  const templateDir = path.join(WorkspacePathResolver.getPromptTemplatesPath(), 'ask');
  
  const basePath = path.join(templateDir, 'base.md');
  const rulesPath = path.join(templateDir, 'rules.md');
  
  const baseContent = fs.readFileSync(basePath, 'utf-8');
  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');
  
  askBaseTemplate = Handlebars.compile(baseContent);
  askRulesTemplate = Handlebars.compile(rulesContent);
  
  return { base: askBaseTemplate, rules: askRulesTemplate };
}

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
   * Build template variables from context and workspace state
   */
  private buildTemplateVars(context: AskContext, knowledge: StaticKnowledge): Record<string, any> {
    const { userQuestion, workspaceState, currentJob, currentAgent, language } = context;
    
    // Get job information from AgentRegistry (YAML data)
    const jobCapabilities = AgentRegistry.generatePromptContext();
    
    // Calculate workspace maturity
    const missingCount = [
      !workspaceState.hasPrd,
      !workspaceState.hasScreens,
      !workspaceState.hasUiDocs,
      !workspaceState.hasSystemDesignDoc,
      !workspaceState.hasCodebase
    ].filter(Boolean).length;
    
    const readyCount = [
      workspaceState.hasPrd,
      workspaceState.hasScreens,
      workspaceState.hasUiDocs,
      workspaceState.hasSystemDesignDoc,
      workspaceState.hasCodebase
    ].filter(Boolean).length;
    
    return {
      // Session
      currentAgent: currentAgent || 'Not selected',
      currentJob: currentJob || 'Not selected',
      
      // System knowledge
      agentOverview: knowledge.agentOverview,
      workflow: knowledge.workflow,
      outputs: knowledge.outputs,
      features: knowledge.features,
      jobCapabilities,
      
      // Workspace state
      hasPrd: workspaceState.hasPrd,
      prdPath: workspaceState.prdPath || 'available',
      hasDirective: workspaceState.hasDirective,
      hasScreens: workspaceState.hasScreens,
      screenCount: workspaceState.screenCount || 0,
      hasComponents: workspaceState.hasComponents,
      componentCount: workspaceState.componentCount || 0,
      hasAssets: workspaceState.hasAssets,
      assetCount: workspaceState.assetCount || 0,
      hasUiDocs: workspaceState.hasUiDocs,
      hasSystemDesignDoc: workspaceState.hasSystemDesignDoc,
      hasDesignDoc: workspaceState.hasDesignDoc,
      hasCodebase: workspaceState.hasCodebase,
      indexedFileCount: workspaceState.indexedFileCount || 'unknown',
      
      // Workspace maturity
      isEmptyWorkspace: missingCount >= 4,
      isReadyWorkspace: readyCount >= 3,
      
      // Job readiness
      canRunUiDesign: workspaceState.hasScreens || workspaceState.hasAssets,
      canRunSystemDesign: workspaceState.hasPrd || workspaceState.hasDirective,
      canRunCodeRecommended: workspaceState.hasDesignDoc,
      canRunCodePossible: workspaceState.hasDirective,
      
      // User question
      userQuestion,
      
      // Language
      isKorean: language === 'ko',
    };
  }
  
  /**
   * Build prompt for streaming (pure text response)
   * Uses template files with WHAT/HOW separation
   */
  private buildStreamingPrompt(context: AskContext, knowledge: StaticKnowledge): string {
    const { base, rules } = loadAskTemplates();
    const vars = {
      ...this.buildTemplateVars(context, knowledge),
      useJsonFormat: false  // Streaming = plain text response
    };
    
    // Render base template (WHAT)
    const basePrompt = base(vars);
    
    // Render rules template (HOW)
    const rulesPrompt = rules(vars);
    
    // Combine: WHAT + HOW
    return `${basePrompt}\n\n---\n\n${rulesPrompt}`;
  }
  
  /**
   * Build LLM prompt with JSON response format
   * Uses template files with WHAT/HOW separation
   */
  private buildPrompt(context: AskContext, knowledge: StaticKnowledge): string {
    const { base, rules } = loadAskTemplates();
    const vars = {
      ...this.buildTemplateVars(context, knowledge),
      useJsonFormat: true  // Non-streaming = JSON response
    };
    
    // Render base template (WHAT)
    const basePrompt = base(vars);
    
    // Render rules template (HOW)
    const rulesPrompt = rules(vars);
    
    // Combine: WHAT + HOW
    return `${basePrompt}\n\n---\n\n${rulesPrompt}`;
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
