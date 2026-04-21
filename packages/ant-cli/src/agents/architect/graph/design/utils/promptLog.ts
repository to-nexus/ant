/**
 * Non-blocking prompt structure logger for design graph.
 *
 * Signature is state-free (takes `featurePath` string directly), so it is
 * pure at call-site — axis ⑧ per NODE_GRAPH_LAYOUT §3 R3. Internal file I/O
 * lives in `core/utils/promptLogger`.
 */

import { logPrompt } from "../../../../../core/utils/promptLogger";

export async function safeLogPrompt(
  featurePath: string | undefined,
  jobId: string,
  subNode: string,
  promptLength: number,
  metadata: Record<string, any>,
): Promise<void> {
  if (!featurePath) return;
  try {
    await logPrompt(featurePath, jobId, 'design', subNode, promptLength, metadata);
  } catch {
    // Non-critical.
  }
}
