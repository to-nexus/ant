import type { LLMStreamEvent } from '../../../../core/ports/llm';

export function* executeStreamEvents(): Generator<LLMStreamEvent> {
  yield {
    type: 'text',
    text: '// Mock generated file\nexport function main() {\n  console.log("Hello from mock");\n}\n',
  };

  yield {
    type: 'text',
    text: '\n<done>true</done>',
  };

  yield {
    type: 'done',
    done: true,
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
}

export function executeInvokeResponse(): string {
  return '// Mock generated file\nexport function main() {\n  console.log("Hello from mock");\n}\n\n<done>true</done>';
}
