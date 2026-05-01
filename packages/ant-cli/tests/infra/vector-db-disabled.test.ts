/**
 * Vector DB capability toggle — locks the `ANT_VECTOR_DB_ENABLED` SSOT.
 *
 * The toggle (see `core/config/vectorDbCapability.ts`) governs:
 *   1. `AdapterFactory.createMemoryAdapter()` adapter selection
 *      (NoopMemoryAdapter when off, ChromaMemoryAdapter when on).
 *   2. The `learn` job + `ant index` CLI + git auto-index short-circuits.
 *   3. The `/agents` endpoint dropping the `learn` entry.
 *
 * This file tests the inner contract — env parsing, factory branch, and
 * NoopMemoryAdapter behavior — so a regression in any of those produces a
 * loud, isolated failure rather than a silent ChromaDB connection hang.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEY = "ANT_VECTOR_DB_ENABLED";

// ✅ ChatAPIClient is dynamic-imported inside the learn nodes; provide a
// no-op singleton so the gate-path tests don't try to talk to a real chat
// stream. This is the lightest possible test double — every method is a
// recording vi.fn() so we can assert call counts where needed.
const chatStatusMock = vi.fn(async () => "merge-idx");
const removeChatStatusMock = vi.fn(async () => undefined);
vi.mock("../../src/core/adapters/ChatAPIClient", () => ({
  getChatAPIClient: () => ({
    showChatStatus: chatStatusMock,
    removeChatStatus: removeChatStatusMock,
    addReadingFile: vi.fn(async () => "read-idx"),
    addReadComplete: vi.fn(async () => undefined),
  }),
}));

describe("vectorDbCapability — env parsing", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("isVectorDbEnabled returns false when env is unset (default opt-in)", async () => {
    const { isVectorDbEnabled } = await import(
      "../../src/core/config/vectorDbCapability"
    );
    expect(isVectorDbEnabled()).toBe(false);
  });

  it("isVectorDbEnabled returns true for canonical truthy values", async () => {
    const { isVectorDbEnabled } = await import(
      "../../src/core/config/vectorDbCapability"
    );
    for (const value of ["true", "TRUE", "1", "yes", "on", " true "]) {
      process.env[ENV_KEY] = value;
      expect(isVectorDbEnabled(), `value=${JSON.stringify(value)}`).toBe(true);
    }
  });

  it("isVectorDbEnabled returns false for non-truthy strings", async () => {
    const { isVectorDbEnabled } = await import(
      "../../src/core/config/vectorDbCapability"
    );
    for (const value of ["false", "0", "no", "off", "", "maybe"]) {
      process.env[ENV_KEY] = value;
      expect(isVectorDbEnabled(), `value=${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("assertVectorDbEnabled throws VectorDbDisabledError when off", async () => {
    const { assertVectorDbEnabled, VectorDbDisabledError } = await import(
      "../../src/core/config/vectorDbCapability"
    );
    expect(() => assertVectorDbEnabled("test reason")).toThrow(
      VectorDbDisabledError
    );
  });

  it("assertVectorDbEnabled passes silently when on", async () => {
    process.env[ENV_KEY] = "true";
    const { assertVectorDbEnabled } = await import(
      "../../src/core/config/vectorDbCapability"
    );
    expect(() => assertVectorDbEnabled("test reason")).not.toThrow();
  });
});

describe("AdapterFactory.createMemoryAdapter — capability-driven branch", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("returns NoopMemoryAdapter when ANT_VECTOR_DB_ENABLED is unset", async () => {
    const { AdapterFactory } = await import(
      "../../src/infrastructure/adapters/AdapterFactory"
    );
    const { NoopMemoryAdapter } = await import(
      "../../src/periphery/adapters/memory/NoopMemoryAdapter"
    );
    const adapter = AdapterFactory.createMemoryAdapter();
    expect(adapter).toBeInstanceOf(NoopMemoryAdapter);
  });

  it("returns NoopMemoryAdapter when ANT_VECTOR_DB_ENABLED=false", async () => {
    process.env[ENV_KEY] = "false";
    const { AdapterFactory } = await import(
      "../../src/infrastructure/adapters/AdapterFactory"
    );
    const { NoopMemoryAdapter } = await import(
      "../../src/periphery/adapters/memory/NoopMemoryAdapter"
    );
    const adapter = AdapterFactory.createMemoryAdapter();
    expect(adapter).toBeInstanceOf(NoopMemoryAdapter);
  });

  it("returns ChromaMemoryAdapter when ANT_VECTOR_DB_ENABLED=true", async () => {
    process.env[ENV_KEY] = "true";
    const { AdapterFactory } = await import(
      "../../src/infrastructure/adapters/AdapterFactory"
    );
    const { ChromaMemoryAdapter } = await import(
      "../../src/periphery/adapters/memory/ChromaMemoryAdapter"
    );
    const adapter = AdapterFactory.createMemoryAdapter();
    expect(adapter).toBeInstanceOf(ChromaMemoryAdapter);
  });
});

describe("NoopMemoryAdapter — MemoryPort contract", () => {
  it("query resolves to empty array (RAG step 1 short-circuits gracefully)", async () => {
    const { NoopMemoryAdapter } = await import(
      "../../src/periphery/adapters/memory/NoopMemoryAdapter"
    );
    const adapter = new NoopMemoryAdapter();
    const results = await adapter.query("anything", "any-project");
    expect(results).toEqual([]);
  });

  it("query honors `where` filter shape without throwing", async () => {
    const { NoopMemoryAdapter } = await import(
      "../../src/periphery/adapters/memory/NoopMemoryAdapter"
    );
    const adapter = new NoopMemoryAdapter();
    const results = await adapter.query("q", "project", {
      k: 5,
      where: { type: "lesson" },
      minScore: 0.5,
    });
    expect(results).toEqual([]);
  });

  it("store/delete/clear never throw", async () => {
    const { NoopMemoryAdapter } = await import(
      "../../src/periphery/adapters/memory/NoopMemoryAdapter"
    );
    const adapter = new NoopMemoryAdapter();
    await expect(
      adapter.store([{ content: "x", metadata: {} }], "project")
    ).resolves.toBeUndefined();
    await expect(adapter.delete("project", { type: "lesson" })).resolves
      .toBeUndefined();
    await expect(adapter.clear("project")).resolves.toBeUndefined();
  });
});

describe("ChromaMemoryAdapter — import is side-effect-free", () => {
  it("module import does not connect to ChromaDB / embedder", async () => {
    // The module sets up `ChromaClient` lazily (via `getClient()`) so an
    // operator running with ANT_VECTOR_DB_ENABLED=false and no ChromaDB
    // container can still import the module via the indirect dependency
    // graph (e.g. AdapterFactory) without crashing or warning.
    delete process.env.CHROMA_URL;
    delete process.env.EMBEDDER_URL;
    await expect(
      import("../../src/periphery/adapters/memory/ChromaMemoryAdapter")
    ).resolves.toBeDefined();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Strict invariant — every vector-DB entry point gates on isVectorDbEnabled()
// at function entry, before touching git / memory / chunk. These tests
// pin the contract so a regression that re-introduces a NoOp fallback or
// drops a gate fails loudly.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Strict invariant — retrieve() capability gate", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("returns '' and never calls memory.query when capability is off", async () => {
    const queryMock = vi.fn();
    const fakeMemory = {
      query: queryMock,
      store: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    };

    const { retrieve } = await import("../../src/agents/architect/memory");
    const result = await retrieve("design", "test-project", undefined, {
      memory: fakeMemory as any,
    });

    expect(result).toBe("");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns '' when memory adapter is missing entirely", async () => {
    process.env[ENV_KEY] = "true";
    const { retrieve } = await import("../../src/agents/architect/memory");
    const result = await retrieve("design", "test-project");
    expect(result).toBe("");
  });
});

describe("Strict invariant — learn store node capability gate", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    chatStatusMock.mockClear();
    removeChatStatusMock.mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  function makeState(memory: any) {
    return {
      context: {
        project: "p",
        featureFolder: "f",
        workingDir: "/tmp/wd",
      },
      deps: memory ? { memory } : {},
      texts: ["lesson body"],
      targets: [],
    } as any;
  }

  it("capability=false: store node returns state, never calls memory.store, emits no chat status", async () => {
    const storeFn = vi.fn();
    const fakeMemory = {
      store: storeFn,
      query: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    };

    const { store } = await import(
      "../../src/agents/architect/graph/learn/nodes/store"
    );
    const result = await store(makeState(fakeMemory));

    expect(result).toBeDefined();
    expect(storeFn).not.toHaveBeenCalled();
    expect(chatStatusMock).not.toHaveBeenCalled();
  });

  it("capability=true + missing memory: throws DI-bug error", async () => {
    process.env[ENV_KEY] = "true";

    const { store } = await import(
      "../../src/agents/architect/graph/learn/nodes/store"
    );

    await expect(store(makeState(undefined))).rejects.toThrow(
      /MemoryPort is required for storing lessons/
    );
  });
});

describe("Strict invariant — learn process node (executeIndexing) capability gate", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
    chatStatusMock.mockClear();
    removeChatStatusMock.mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  function makeState(deps: { memory?: any; chunk?: any; git?: any } = {}) {
    return {
      context: {
        project: "p",
        featureFolder: "f",
        workingDir: "/tmp/wd",
      },
      deps,
      command: { action: "index_codebase" },
      texts: [],
      targets: [],
    } as any;
  }

  it("capability=false: gate fires before any git method is called (indexer.index never reached)", async () => {
    // Spy on every git method that the post-gate code path would touch.
    // If the gate is wired correctly, none of these are invoked.
    const git = {
      getRepoName: vi.fn(),
      getCurrentBranch: vi.fn(),
      getCurrentCommit: vi.fn(),
      hasChanges: vi.fn(),
      getChangedFiles: vi.fn(),
    };

    const { processCommand } = await import(
      "../../src/agents/architect/graph/learn/nodes/resolve"
    );
    const result = await processCommand(makeState({ git }));

    expect(result.texts?.[0]).toMatch(/Vector DB disabled/);
    for (const fn of Object.values(git)) {
      expect(fn).not.toHaveBeenCalled();
    }
    // Chat status reports the disabled state once.
    expect(chatStatusMock).toHaveBeenCalledTimes(1);
    expect(chatStatusMock).toHaveBeenCalledWith(
      "indexed",
      expect.objectContaining({
        error: expect.stringMatching(/Vector DB is disabled/),
      })
    );
  });

  it("capability=true + missing memory/chunk: throws DI-bug error (no NoOp fallback)", async () => {
    process.env[ENV_KEY] = "true";

    const git = {
      getRepoName: vi.fn(async () => "repo"),
      getCurrentBranch: vi.fn(async () => "main"),
      getCurrentCommit: vi.fn(async () => "abc1234567890"),
      hasChanges: vi.fn(async () => false),
      getChangedFiles: vi.fn(async () => []),
    };

    const { processCommand } = await import(
      "../../src/agents/architect/graph/learn/nodes/resolve"
    );

    // Note: capability gate passes → reaches the post-gate `state.deps?.memory`
    // null check, which throws. The legacy NoOp fallback would silently
    // proceed instead — this test pins that the fallback is gone.
    await expect(processCommand(makeState({ git }))).rejects.toThrow(
      /MemoryPort and ChunkPort are required/
    );
  });
});
