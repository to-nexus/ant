/**
 * MCP tool-result content unwrapping — transport-agnostic.
 *
 * Promoted from `periphery/adapters/figma/MCPTransport.ts` so both the Figma
 * transport and the universal-job `McpConnectionManager` share one unwrap
 * implementation (the figma module re-exports these for its existing callers).
 */

/**
 * Extract the actual text content from an MCP tool result.
 * MCP tools wrap results as: { content: [{ type: "text", text: "..." }] }
 * or after one unwrap: [{ type: "text", text: "..." }].
 * Returns the concatenated text from all text items, or null if none found.
 */
export function extractMCPTextContent(content: unknown): string | null {
  if (!content) return null;

  if (typeof content === 'string') return content;

  // { content: [...] } wrapper
  if (typeof content === 'object' && !Array.isArray(content)) {
    const arr = (content as any).content;
    if (Array.isArray(arr)) return extractMCPTextContent(arr);
  }

  // [{ type: "text", text: "..." }, ...] MCP content items
  if (Array.isArray(content)) {
    const texts = content
      .filter((item: any) => item?.type === 'text' && typeof item?.text === 'string')
      .map((item: any) => item.text);
    return texts.length > 0 ? texts.join('\n') : null;
  }

  return null;
}

/**
 * Extract the first image content item from an MCP tool result.
 * MCP image items: { type: "image", data: "base64...", mimeType: "image/png" }
 * Handles the same wrapper formats as extractMCPTextContent.
 */
export function extractMCPImageContent(content: unknown): { base64: string; mimeType: string } | null {
  if (!content || typeof content === 'string') return null;

  if (typeof content === 'object' && !Array.isArray(content)) {
    const arr = (content as any).content;
    if (Array.isArray(arr)) return extractMCPImageContent(arr);
  }

  if (Array.isArray(content)) {
    const img = content.find(
      (item: any) => item?.type === 'image' && typeof item?.data === 'string' && typeof item?.mimeType === 'string',
    );
    if (img) return { base64: img.data, mimeType: img.mimeType };
  }

  return null;
}
