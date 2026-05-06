/**
 * Phase 3 — Service Virtualization toggle component.
 *
 * Locks the truth table from plan §6.3:
 *
 *   | input                                | expectation                     |
 *   |--------------------------------------|---------------------------------|
 *   | infrastructure (no virtualization)   | renders nothing                 |
 *   | business + active=false              | Real disabled, Virtualized live |
 *   | business + active=true               | Real live, Virtualized disabled |
 *   | click Virtualized when active=false  | onToggle(true) called once      |
 *   | click Real when active=true          | onToggle(false) called once     |
 */

import { describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ServiceConnection } from '../../src/infrastructure/http/api';

import { VirtualizationToggle } from '../../src/presentation/components/PreviewConfigEditor/components/ConnectionRow/VirtualizationToggle';

function makeBusinessConn(active: boolean): ServiceConnection {
  return {
    id: 'stripe-api',
    name: 'Stripe API',
    category: 'business',
    envVar: 'STRIPE_API_KEY',
    value: 'http://localhost:4242',
    resolution: { type: 'url', url: 'http://localhost:4242' },
    virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active },
  };
}

function makeInfraConn(): ServiceConnection {
  return {
    id: 'postgres',
    name: 'PostgreSQL',
    category: 'infrastructure',
    envVar: 'DATABASE_URL',
    value: 'postgres://user:pw@localhost:5432/db',
    resolution: { type: 'docker', service: 'postgres', port: 5432 },
  };
}

function findButtons(tree: ReactTestRenderer): {
  realBtn: ReturnType<ReactTestRenderer['root']['findByProps']> | null;
  virtBtn: ReturnType<ReactTestRenderer['root']['findByProps']> | null;
} {
  const buttons = tree.root.findAllByType('button');
  const realBtn = buttons.find((b) => b.children.some((c) => typeof c === 'string' && c.includes('Real'))) || null;
  const virtBtn = buttons.find((b) => b.children.some((c) => typeof c === 'string' && c.includes('Virtualized'))) || null;
  return { realBtn, virtBtn };
}

describe('VirtualizationToggle', () => {
  it('renders nothing for infrastructure connections (no virtualization field)', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<VirtualizationToggle conn={makeInfraConn()} onToggle={() => {}} />);
    });
    expect(tree!.toJSON()).toBeNull();
  });

  it('renders both buttons for business + active=false; Real is disabled, Virtualized is live', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<VirtualizationToggle conn={makeBusinessConn(false)} onToggle={() => {}} />);
    });
    const { realBtn, virtBtn } = findButtons(tree!);
    expect(realBtn).not.toBeNull();
    expect(virtBtn).not.toBeNull();
    expect(realBtn!.props.disabled).toBe(true);
    expect(virtBtn!.props.disabled).toBe(false);
    expect(realBtn!.props['aria-pressed']).toBe(true);
    expect(virtBtn!.props['aria-pressed']).toBe(false);
  });

  it('renders both buttons for business + active=true; Real is live, Virtualized is disabled', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<VirtualizationToggle conn={makeBusinessConn(true)} onToggle={() => {}} />);
    });
    const { realBtn, virtBtn } = findButtons(tree!);
    expect(realBtn!.props.disabled).toBe(false);
    expect(virtBtn!.props.disabled).toBe(true);
    expect(realBtn!.props['aria-pressed']).toBe(false);
    expect(virtBtn!.props['aria-pressed']).toBe(true);
  });

  it('clicking Virtualized when active=false invokes onToggle(true) exactly once', () => {
    const onToggle = vi.fn();
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<VirtualizationToggle conn={makeBusinessConn(false)} onToggle={onToggle} />);
    });
    const { virtBtn } = findButtons(tree!);
    act(() => {
      virtBtn!.props.onClick();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('clicking Real when active=true invokes onToggle(false) exactly once', () => {
    const onToggle = vi.fn();
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<VirtualizationToggle conn={makeBusinessConn(true)} onToggle={onToggle} />);
    });
    const { realBtn } = findButtons(tree!);
    act(() => {
      realBtn!.props.onClick();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('exposes the toggle env var in the title attribute (debuggability)', () => {
    let tree: ReactTestRenderer | undefined;
    act(() => {
      tree = create(<VirtualizationToggle conn={makeBusinessConn(false)} onToggle={() => {}} />);
    });
    const dump = JSON.stringify(tree!.toJSON());
    expect(dump).toContain('USE_MOCK_STRIPE_API');
  });
});
