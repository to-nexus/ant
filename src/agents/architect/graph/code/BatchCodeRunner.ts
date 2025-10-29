import { LLMClient, GitPort } from "../../../../core/ports";
import { PromptEngine } from "../../../../core/prompt/engine";
import { CodebaseRetriever, BatchResult } from "../../../../core/codebase";
import { ProjectContext } from "../../types";
import { parseResponse } from "./nodes/parseResponse";
import * as path from "path";

/**
 * Batch execution result
 */
export interface BatchExecutionResult {
  batchNumber: number;
  status: 'success' | 'failed' | 'skipped';
  filesModified: string[];
  error?: string;
}

/**
 * Overall batch run result
 */
export interface BatchRunResult {
  totalBatches: number;
  successCount: number;
  failCount: number;
  skipCount: number;
  batches: BatchExecutionResult[];
  totalFilesModified: number;
}

/**
 * Phase 2: Batch Code Runner
 * 
 * 대규모 전역 리팩토링을 위한 배치 처리 시스템
 * - 각 배치마다 plan → execute → validate → apply
 * - 배치별 독립적 검증 및 재시도
 * - 실패 시 조기 중단 또는 계속 (옵션)
 * 
 * ✅ Hexagonal Architecture Compliance:
 * - Uses GitPort for file operations
 */
export class BatchCodeRunner {
  constructor(
    private llm: LLMClient,
    private promptEngine: PromptEngine,
    private gitPort: GitPort
  ) {}

  /**
   * Run batch processing with per-batch validation
   */
  async run(
    directive: string,
    context: ProjectContext,
    deps: {
      git?: any;
      vectorDB?: any;
    },
    options: {
      batchSize?: number;
      maxBatches?: number;
      stopOnError?: boolean;  // Stop on first error (default: false)
      maxRetries?: number;    // Max retries per batch (default: 2)
    } = {}
  ): Promise<BatchRunResult> {
    const stopOnError = options.stopOnError ?? false;
    const maxRetries = options.maxRetries ?? 2;
    
    const retriever = new CodebaseRetriever();
    const results: BatchExecutionResult[] = [];
    
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;
    let totalFilesModified = 0;

    console.log(`\n🚀 Starting batch processing...`);
    console.log(`   Directive: ${directive}`);
    console.log(`   Stop on error: ${stopOnError}`);
    console.log(`   Max retries: ${maxRetries}\n`);

    // Stream batches
    for await (const batch of retriever.retrieveInBatches(
      directive,
      context.workingDir,
      deps,
      {
        batchSize: options.batchSize,
        maxBatches: options.maxBatches
      }
    )) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📦 Batch ${batch.batchNumber}/${options.maxBatches || '?'}`);
      console.log(`   Files: ${batch.files.join(', ')}`);
      console.log(`   Tokens: ~${batch.estimatedTokens}`);
      console.log(`${'='.repeat(60)}\n`);

      try {
        // Process single batch with retries
        const batchResult = await this.processBatch(
          batch,
          directive,
          context,
          maxRetries
        );

        if (batchResult.status === 'success') {
          successCount++;
          totalFilesModified += batchResult.filesModified.length;
          console.log(`✅ Batch ${batch.batchNumber} completed successfully`);
        } else {
          failCount++;
          console.error(`❌ Batch ${batch.batchNumber} failed: ${batchResult.error}`);
          
          if (stopOnError) {
            console.log(`\n⛔ Stopping due to error (stopOnError=true)`);
            results.push(batchResult);
            break;
          }
        }

        results.push(batchResult);

      } catch (error: any) {
        console.error(`❌ Batch ${batch.batchNumber} unexpected error:`, error.message);
        
        failCount++;
        results.push({
          batchNumber: batch.batchNumber,
          status: 'failed',
          filesModified: [],
          error: error.message
        });

        if (stopOnError) {
          console.log(`\n⛔ Stopping due to error`);
          break;
        }
      }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Batch Processing Complete`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total batches: ${results.length}`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`⏭️  Skipped: ${skipCount}`);
    console.log(`📝 Total files modified: ${totalFilesModified}`);
    console.log(`${'='.repeat(60)}\n`);

    return {
      totalBatches: results.length,
      successCount,
      failCount,
      skipCount,
      batches: results,
      totalFilesModified
    };
  }

  /**
   * Process single batch with validation and retries
   */
  private async processBatch(
    batch: BatchResult,
    directive: string,
    context: ProjectContext,
    maxRetries: number
  ): Promise<BatchExecutionResult> {
    let retries = 0;
    let lastError = '';

    while (retries <= maxRetries) {
      try {
        // === Plan Phase ===
        console.log(`📋 Planning batch ${batch.batchNumber}...`);
        const plan = await this.planBatch(batch, directive, context);

        // === Execute Phase ===
        console.log(`⚙️  Executing batch ${batch.batchNumber}...`);
        const result = retries === 0
          ? await this.executeBatch(batch, plan, directive, context)
          : await this.enforceBatch(batch, plan, directive, context, lastError);

        // === Validate Phase ===
        console.log(`🔍 Validating batch ${batch.batchNumber}...`);
        const validation = this.validateBatch(result);

        if (validation.ok) {
          // === Apply Phase ===
          console.log(`💾 Applying batch ${batch.batchNumber}...`);
          await this.applyBatch(result, context.workingDir);

          return {
            batchNumber: batch.batchNumber,
            status: 'success',
            filesModified: result.files.map((f: any) => f.path)
          };
        }

        // Validation failed
        lastError = validation.violations.join(', ');
        console.warn(`⚠️  Validation failed (attempt ${retries + 1}/${maxRetries + 1}): ${lastError}`);
        retries++;

      } catch (error: any) {
        lastError = error.message;
        console.error(`❌ Batch execution error (attempt ${retries + 1}/${maxRetries + 1}):`, lastError);
        retries++;
      }
    }

    // All retries exhausted
    return {
      batchNumber: batch.batchNumber,
      status: 'failed',
      filesModified: [],
      error: `Failed after ${maxRetries} retries: ${lastError}`
    };
  }

  /**
   * Plan phase for batch
   */
  private async planBatch(
    batch: BatchResult,
    directive: string,
    context: ProjectContext
  ): Promise<string> {
    const artifacts = {
      directive,
      currentCode: batch.code,
      designDoc: undefined,
      prdSpec: undefined,
      originalFiles: undefined
    };

    const result = await this.promptEngine.buildPlanPrompt(
      "code",
      context,
      artifacts,
      'refactor'  // Batch는 주로 refactor
    );

    const plan = await this.llm.invoke(result.formatted.messages);
    return plan;
  }

  /**
   * Execute phase for batch (initial)
   */
  private async executeBatch(
    batch: BatchResult,
    plan: string,
    directive: string,
    context: ProjectContext
  ): Promise<any> {
    const artifacts = {
      directive,
      currentCode: batch.code,
      designDoc: undefined,
      prdSpec: undefined,
      originalFiles: undefined
    };

    const result = await this.promptEngine.buildExecutePrompt(
      "code",
      context,
      artifacts,
      plan,
      'refactor'
    );

    const raw = await this.llm.invoke(result.formatted.messages);
    const parsed = parseResponse(raw);

    return {
      raw,
      files: parsed.files,
      filesToDelete: parsed.filesToDelete
    };
  }

  /**
   * Execute phase for batch (enforcement/retry)
   */
  private async enforceBatch(
    batch: BatchResult,
    plan: string,
    directive: string,
    context: ProjectContext,
    previousError: string
  ): Promise<any> {
    const artifacts = {
      directive,
      currentCode: batch.code,
      designDoc: undefined,
      prdSpec: undefined,
      originalFiles: undefined
    };

    const result = await this.promptEngine.buildExecutePrompt(
      "code",
      context,
      artifacts,
      plan,
      'refactor'
    );

    const enforcement = this.promptEngine.buildEnforcementPrompt(
      result,
      `Previous attempt failed with: ${previousError}\n\nPlease fix these issues and regenerate the code.`
    );

    const raw = await this.llm.invoke(enforcement.messages);
    const parsed = parseResponse(raw);

    return {
      raw,
      files: parsed.files,
      filesToDelete: parsed.filesToDelete
    };
  }

  /**
   * Validate batch result
   */
  private validateBatch(result: any): { ok: boolean; violations: string[] } {
    const violations: string[] = [];

    // 1. Check if files exist
    if (!result.files || result.files.length === 0) {
      violations.push('No files generated');
    }

    // 2. Check file format
    for (const file of result.files || []) {
      if (!file.path || !file.content) {
        violations.push(`Invalid file format: ${file.path || 'unknown'}`);
      }
    }

    // 3. Basic syntax check (simple)
    for (const file of result.files || []) {
      if (file.path.endsWith('.ts') || file.path.endsWith('.js')) {
        // Check for basic syntax issues
        if (file.content.includes('```')) {
          violations.push(`Code block markers found in ${file.path}`);
        }
      }
    }

    return {
      ok: violations.length === 0,
      violations
    };
  }

  /**
   * Apply batch changes to file system
   */
  private async applyBatch(result: any, workingDir: string): Promise<void> {
    const repoRoot = await this.gitPort.getRepoRoot();
    
    // Write files
    for (const file of result.files || []) {
      const relativePath = path.relative(repoRoot, path.join(workingDir, file.path));
      
      // Write file (GitPort handles directory creation)
      await this.gitPort.writeFile(relativePath, file.content);
      console.log(`  ✓ ${file.path}`);
    }

    // Delete files
    for (const filePath of result.filesToDelete || []) {
      const relativePath = path.relative(repoRoot, path.join(workingDir, filePath));
      const exists = await this.gitPort.fileExists(relativePath);
      
      if (exists) {
        // Note: GitPort doesn't have deleteFile method yet
        // For now, write empty file as placeholder
        await this.gitPort.writeFile(relativePath, '');
        console.log(`  🗑️  ${filePath} (marked for deletion)`);
      }
    }
  }
}

