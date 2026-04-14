import { extractMCPTextContent } from '../../../../../../periphery/adapters/figma/MCPTransport';

export interface MetadataNode {
  id: string;
  name: string;
  type: string;
  children?: MetadataNode[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export function parseMetadataXML(rawContent: any): MetadataNode[] {
  if (!rawContent) return [];

  const extracted = extractMCPTextContent(rawContent);
  let content: any = extracted ?? rawContent;

  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      const xmlNodes = parseXMLToNodes(content);
      if (xmlNodes.length > 0) return xmlNodes;
      console.warn('⚠️  [parseMetadataXML] Failed to parse as JSON or XML, content preview:', content.substring(0, 300));
      return [];
    }
  }

  if (Array.isArray(content)) return content;
  if (content.children) return content.children;
  return [content];
}

/**
 * Parse Figma MCP XML metadata into MetadataNode[].
 * Handles format like: <FRAME id="1:2" name="Header" type="FRAME" x="0" y="0" width="1440" height="80">...</FRAME>
 */
export function parseXMLToNodes(xml: string): MetadataNode[] {
  const nodes: MetadataNode[] = [];
  const tagPattern = /<(\w+)\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  let match;

  while ((match = tagPattern.exec(xml)) !== null) {
    const [, tagName, attrs, innerContent] = match;
    const node: MetadataNode = {
      id: extractAttr(attrs, 'id') || '',
      name: extractAttr(attrs, 'name') || tagName,
      type: extractAttr(attrs, 'type') || tagName.toUpperCase(),
    };

    const x = extractAttr(attrs, 'x');
    const y = extractAttr(attrs, 'y');
    const w = extractAttr(attrs, 'width') || extractAttr(attrs, 'w');
    const h = extractAttr(attrs, 'height') || extractAttr(attrs, 'h');
    if (x) node.x = Number(x);
    if (y) node.y = Number(y);
    if (w) node.width = Number(w);
    if (h) node.height = Number(h);

    if (innerContent?.trim()) {
      const children = parseXMLToNodes(innerContent);
      if (children.length > 0) node.children = children;
    }

    if (node.id) nodes.push(node);
  }

  return nodes;
}

function decodeXMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractAttr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}=["']([^"']*)["']`);
  const raw = pattern.exec(attrs)?.[1];
  return raw ? decodeXMLEntities(raw) : undefined;
}
