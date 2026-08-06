/**
 * Response Cleaners
 *
 * Shared utilities for cleaning LLM responses before storing in conversation
 * history. File authoring is tool-call-only (`create_file` / `append_file` /
 * `edit_file`); no parser consumes `<file>` / `<append>` / `<edit>` tags, so
 * a tag body in the text is a hallucination that wrote NOTHING. This scrubber
 * collapses such bodies into truthful "NOT written — use the tool" markers so
 * the history stays compact and never confirms a phantom write.
 */

/**
 * Replace hallucinated file-tag bodies with truthful compact markers.
 * Used by the execute conversation-history paths (no-done, tool-call,
 * subagent-join) before a response enters NODE_EXECUTE history.
 */
export function cleanFileContentFromResponse(text: string): string {
  const marker = (tag: string, tool: string) => (match: string): string => {
    const pathMatch = match.match(/path=["']([^"']+)["']/);
    return pathMatch
      ? `[<${tag}> tag is not supported - file NOT written: ${pathMatch[1]} - use the ${tool} tool]`
      : `[<${tag}> tag is not supported - no file written - use the ${tool} tool]`;
  };
  let cleaned = text;
  cleaned = cleaned.replace(/<file[^>]*>[\s\S]*?<\/file>/g, marker('file', 'create_file'));
  cleaned = cleaned.replace(/<append[^>]*>[\s\S]*?<\/append>/g, marker('append', 'append_file'));
  cleaned = cleaned.replace(/<edit[^>]*>[\s\S]*?<\/edit>/g, marker('edit', 'edit_file'));
  return cleaned.trim();
}
