/**
 * Design-decompose discovery tools — shared `read_file` / `list_files` seam.
 *
 * Mirrors the code-job decompose tool surface
 * (`code/nodes/decompose/index.ts`): the same `read_file` / `list_files`
 * common handlers, gated by the same RAC whitelist (`computeRacScope` +
 * `decideRacGate`). Exposed to EVERY design decompose intent (ui / game-art),
 * regardless of source, so:
 *
 *   - handoff sub-sources — loaded as read_file STUBS by
 *     `loadResolvedArtifacts` (`isStubLoadedPath`) — can be dereferenced
 *     on demand during decompose (previously impossible: decompose only
 *     had `read_source_doc`, which reads `plan/` sources from an in-memory
 *     record, never the filesystem). This is the fix for the by-handoff
 *     revise decompose that crashed because the prompt promised the bundle
 *     "as documents" while the pool held only stubs.
 *   - the LLM can `list_files` to survey a bundle's structure before
 *     deciding which files a revise touches.
 *
 * Codebase paths are orthogonal (allowed); sibling-tree paths (plan/,
 * architecture/, visual/, assets/, ...) are gated to the RAC whitelist —
 * the same 2-site RAC policy the code decompose uses. `read_source_doc`
 * (plan sources) stays owned by the individual decompose nodes.
 */
import type { DesignGraphState } from '../../state';

export interface DesignDiscoveryTools {
  /** Tool schemas to append to the decompose tool loop (always available). */
  tools: any[];
  /**
   * Dispatch a discovery tool call. Returns the stringified tool result, or
   * `null` if `name` is not a discovery tool (caller handles its own tools,
   * e.g. `read_source_doc`).
   */
  dispatch: (name: string, args: any) => Promise<string | null>;
}

export async function buildDesignDiscoveryTools(
  state: DesignGraphState,
): Promise<DesignDiscoveryTools> {
  const { ARCHITECT_TOOLS } = await import('../../../../../common/tool/toolSchemas');
  const { handleReadFile, handleListFiles } = await import('../../../../../common/tool/handlers');
  const { computeRacScope, decideRacGate } = await import('../../../code/nodes/decompose/racGate');

  const racScope = computeRacScope(state.resolvedAction);

  // Silent chatStatus — the decompose tool loop owns UI emission; forwarding
  // the common handler's cards would double-emit. Mirrors code decompose.
  const silentChatStatus = new Proxy({}, { get: () => async () => undefined }) as any;

  const ctx: any = {
    fileSystem: state.deps?.fileSystem,
    chatStatus: silentChatStatus,
    workingDir: state.context?.featurePath || process.cwd(),
    featurePath: state.context?.featurePath,
    project: state.context?.project,
    featureFolder: state.context?.featureFolder,
    command: state.deps?.command,
    git: state.deps?.git,
    redis: state.deps?.redis,
    workspaceResolver: state.deps?.workspaceResolver,
    userId: state.context?.userId,
    organizationId: state.context?.organizationId,
    activePhase: 'plan',
  };

  const dispatch = async (name: string, args: any): Promise<string | null> => {
    if (name !== 'read_file' && name !== 'list_files') return null;
    const target = (args?.path ?? args?.directory ?? '') as string;
    const gate = decideRacGate(target, racScope);
    if (!gate.allowed) return `Error: ${gate.error}`;
    const res =
      name === 'read_file'
        ? await handleReadFile(ctx, args as { path: string; startLine?: number; endLine?: number })
        : await handleListFiles(ctx, args as { directory?: string; pattern?: string });
    return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
  };

  return { tools: [ARCHITECT_TOOLS.read_file, ARCHITECT_TOOLS.list_files], dispatch };
}
