import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { createMarkdownComponents } from '../../src/presentation/components/markdown/createMarkdownComponents';

vi.mock('../../src/presentation/components/markdown/MermaidBlock', () => ({
  MermaidBlock: ({ code }: { code: string }) => (
    <div data-testid="mermaid-block">{code}</div>
  ),
}));

describe('createMarkdownComponents', () => {
  it('routes language-mermaid blocks to MermaidBlock', () => {
    const components = createMarkdownComponents();
    const codeRenderer = components.code;
    expect(codeRenderer).toBeTruthy();
    const element = codeRenderer!({
      className: 'language-mermaid',
      children: 'graph TD\nA-->B\n',
    }) as ReactElement<{ code: string }>;

    expect(element.props.code).toContain('graph TD');
  });

  it('keeps non-mermaid markdown rendering behavior for code/table/link', () => {
    const components = createMarkdownComponents({ paragraphTag: 'p' });
    const codeRenderer = components.code!;
    const linkRenderer = components.a!;
    const tableRenderer = components.table!;

    const codeElement = codeRenderer({
      className: 'language-ts',
      children: 'const x = 1;\n',
    }) as ReactElement<{ className?: string }>;
    expect(codeElement.props.className).toBe('language-ts');

    const tableElement = tableRenderer({
      children: 'rows',
    }) as ReactElement<{ children: ReactElement<{ className?: string }> }>;
    expect(tableElement.props.children.props.className).toContain('min-w-full');

    const linkElement = linkRenderer({
      href: 'https://example.com',
      children: 'ant',
    }) as ReactElement<{ target?: string }>;
    expect(linkElement.props.target).toBe('_blank');
  });
});
