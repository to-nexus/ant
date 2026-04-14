export interface ClarifyBlock {
  question: string;
  options: string[];
}

/**
 * Parse <clarify> blocks from LLM response text.
 * 
 * Expected format:
 *   <clarify question="What is the target platform?">
 *   <option>Web application</option>
 *   <option>Mobile app</option>
 *   </clarify>
 */
export function parseClarifyBlocks(text: string): ClarifyBlock[] {
  const blocks: ClarifyBlock[] = [];
  const clarifyRegex = /<clarify\s+question="([^"]*)">([\s\S]*?)<\/clarify>/g;
  const optionRegex = /<option>([\s\S]*?)<\/option>/g;
  
  let match;
  while ((match = clarifyRegex.exec(text)) !== null) {
    const question = match[1].trim();
    const body = match[2];
    const options: string[] = [];
    
    let optMatch;
    while ((optMatch = optionRegex.exec(body)) !== null) {
      const optText = optMatch[1].trim();
      if (optText) options.push(optText);
    }
    optionRegex.lastIndex = 0;
    
    if (question && options.length > 0) {
      blocks.push({ question, options });
    }
  }
  
  return blocks;
}

/**
 * Remove <clarify> blocks from response text for clean chat display.
 */
export function stripClarifyBlocks(text: string): string {
  return text.replace(/<clarify\s+question="[^"]*">[\s\S]*?<\/clarify>/g, '').trim();
}
