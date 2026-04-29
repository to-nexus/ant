import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parseClassifyResponse } from '../src/agents/creator/graph/visual/nodes/classifyParser';
import { ExecutionTierId } from '@ant/shared';

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('parseClassifyResponse', () => {
  it('parses valid <classify> XML response with jobMode', () => {
    const input = `<classify>
{ "assetType": "logo", "jobMode": "generate", "reasoning": "User explicitly asked for a logo" }
</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('logo');
    expect(result.jobMode).toBe('generate');
    expect(result.reasoning).toContain('logo');
  });

  it('parses explain jobMode', () => {
    const input = `<classify>{"assetType":"icon","jobMode":"explain","reasoning":"Question about icon design"}</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('icon');
    expect(result.jobMode).toBe('explain');
  });

  it('parses valid icon classification', () => {
    const input = `<classify>{"assetType":"icon","jobMode":"generate","reasoning":"UI icon request"}</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('icon');
    expect(result.jobMode).toBe('generate');
  });

  it('parses hero classification', () => {
    const input = `<classify>{ "assetType": "hero", "jobMode": "generate", "reasoning": "Background image" }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('hero');
  });

  it('parses illustration classification', () => {
    const input = `<classify>{ "assetType": "illustration", "jobMode": "generate", "reasoning": "Creating scene illustration" }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('illustration');
    expect(result.jobMode).toBe('generate');
  });

  it('parses general classification', () => {
    const input = `<classify>{ "assetType": "general", "jobMode": "generate", "reasoning": "Unclear type" }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('general');
  });

  it('defaults jobMode to generate when missing', () => {
    const input = `<classify>{ "assetType": "logo", "reasoning": "No mode field" }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('logo');
    expect(result.jobMode).toBe('generate');
  });

  it('defaults jobMode to generate for unknown value', () => {
    const input = `<classify>{ "assetType": "icon", "jobMode": "edit", "reasoning": "Invalid mode" }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('icon');
    expect(result.jobMode).toBe('generate');
  });

  it('falls back to JSON without XML wrapper', () => {
    const input = `{ "assetType": "icon", "jobMode": "explain", "reasoning": "No XML wrapper" }`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('icon');
    expect(result.jobMode).toBe('explain');
  });

  it('falls back to ```json code block', () => {
    const input = "```json\n{ \"assetType\": \"hero\", \"jobMode\": \"generate\", \"reasoning\": \"code block\" }\n```";
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('hero');
    expect(result.jobMode).toBe('generate');
  });

  it('normalizes unknown asset type to general', () => {
    const input = `<classify>{ "assetType": "banner", "jobMode": "generate", "reasoning": "Not a valid type" }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('general');
  });

  it('normalizes case-insensitive asset type and mode', () => {
    const input = `<classify>{ "assetType": "LOGO", "jobMode": "EXPLAIN", "reasoning": "Uppercase" }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('logo');
    expect(result.jobMode).toBe('explain');
  });

  it('defaults refactor jobMode to generate (legacy mode)', () => {
    const input = `<classify>{"assetType":"icon","jobMode":"refactor","reasoning":"Legacy mode"}</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('icon');
    expect(result.jobMode).toBe('generate');
  });

  it('returns defaults on completely invalid response', () => {
    const input = 'This is not JSON at all, just free text rambling';
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('general');
    expect(result.jobMode).toBe('generate');
    expect(result.reasoning).toContain('Classification failed');
  });

  it('returns defaults on empty string', () => {
    const result = parseClassifyResponse('');
    expect(result.assetType).toBe('general');
    expect(result.jobMode).toBe('generate');
  });

  it('returns defaults on malformed JSON', () => {
    const input = `<classify>{ assetType: logo }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('general');
    expect(result.jobMode).toBe('generate');
  });

  it('returns defaults when all fields are missing', () => {
    const input = `<classify>{ "reasoning": "no type or mode" }</classify>`;
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('general');
    expect(result.jobMode).toBe('generate');
  });

  // SSOT consolidation guard — `<classify>` body inherits the same prose-tolerance
  // class as the per-`<task>` decompose contract (`tiny-logging-haven` regression).
  // Pre-SSOT this would silently fall through to FALLBACK because `JSON.parse`
  // rejects "Unexpected non-whitespace character after JSON" once prose follows.
  it('tolerates trailing prose inside <classify> (regression: prose-leak class)', () => {
    const input = [
      '<classify>',
      '{"assetType":"logo","jobMode":"generate","reasoning":"User asked for a logo"}',
      '',
      '**Reasoning**: this classification covers the brand mark request.',
      '</classify>',
    ].join('\n');
    const result = parseClassifyResponse(input);
    expect(result.assetType).toBe('logo');
    expect(result.jobMode).toBe('generate');
    expect(result.reasoning).toContain('logo');
  });

  describe('executionTier', () => {
    it('parses <executionTier> tag emitted alongside <classify>', () => {
      const input = `<executionTier>1</executionTier>
<classify>{"assetType":"logo","jobMode":"generate","reasoning":"Single logo"}</classify>`;
      const result = parseClassifyResponse(input);
      expect(result.executionTier).toBe(ExecutionTierId.OneShot);
      expect(result.assetType).toBe('logo');
    });

    it('accepts RefsGrounded tier for brand-grounded requests', () => {
      const input = `<executionTier>4</executionTier>
<classify>{"assetType":"icon","jobMode":"generate","reasoning":"Icon set from brand refs"}</classify>`;
      const result = parseClassifyResponse(input);
      expect(result.executionTier).toBe(ExecutionTierId.RefsGrounded);
    });

    it('degrades to Tier 0 Reflex when <executionTier> is missing', () => {
      const input = `<classify>{"assetType":"icon","jobMode":"generate","reasoning":"No tier tag"}</classify>`;
      const result = parseClassifyResponse(input);
      expect(result.executionTier).toBe(ExecutionTierId.Reflex);
    });

    it('degrades to Tier 0 Reflex on malformed tier value', () => {
      const input = `<executionTier>9</executionTier>
<classify>{"assetType":"logo","jobMode":"generate","reasoning":"Bad tier"}</classify>`;
      const result = parseClassifyResponse(input);
      expect(result.executionTier).toBe(ExecutionTierId.Reflex);
    });

    it('fallback response still carries Tier 0 Reflex', () => {
      const result = parseClassifyResponse('garbage');
      expect(result.executionTier).toBe(ExecutionTierId.Reflex);
    });
  });
});
