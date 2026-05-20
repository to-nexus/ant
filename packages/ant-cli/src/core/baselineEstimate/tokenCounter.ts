import Anthropic from '@anthropic-ai/sdk';
import type { LooseToolDef } from './toolDefs';

let cachedClient: Anthropic | undefined;
function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return cachedClient;
}

export interface CountTokensRequest {
  model: string;
  system: string;
  userText: string;
  tools: LooseToolDef[];
}

export async function countTokens(req: CountTokensRequest): Promise<number> {
  const client = getClient();
  const params: Anthropic.Beta.Messages.MessageCountTokensParams = {
    model: req.model,
    messages: [{ role: 'user', content: req.userText || ' ' }],
    system: req.system || undefined,
    tools: req.tools.length > 0
      ? (req.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
        })))
      : undefined,
  };
  const result = await client.beta.messages.countTokens(params);
  return result.input_tokens;
}
