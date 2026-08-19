import * as path from 'path';
import { ServiceConnection } from '../../../../../../core/ports/portRegistry';
import { toToggleFramework } from '../../../../../../core/prompt/builder/serviceVirtualization/connectionModel';
import { setToggleDefaultIfAbsent } from '../detectors/ConnectionDetector/envFileWriter';
import { detectFramework } from '../../../../../../infrastructure/deploy';

/**
 * Ensure every business connection of a package has its mock toggle present in
 * the package `.env` (default `true`), writing it when absent. Default-ON lives
 * in the file (one SSOT), so a generated factory reads a real value and a
 * greenfield app boots mocked instead of hitting ECONNREFUSED.
 *
 * Idempotent — `setToggleDefaultIfAbsent` skips when any framework-prefixed
 * variant already exists, so an explicit `.env` toggle (user opting into the
 * real backend) is preserved. Per-connection grain; the toggle name is the
 * detector-stored `virtualization.toggleEnvVar` (SSOT).
 *
 * Standalone (no PreviewService coupling) so both the dev-server spawn
 * (ProcessSpawner) and the deploy-side backend runtime (ProcessServer) share
 * one implementation.
 */
export function backfillMockToggles(
  workspaceRoot: string,
  connections: ServiceConnection[] | undefined,
  packageSource: string | undefined,
  pkgPath: string,
): void {
  if (!connections?.length) return;
  const business = connections.filter(
    c => c.virtualization &&
      (c.source === '*' || !packageSource || c.source === packageSource),
  );
  if (business.length === 0) return;

  const framework = toToggleFramework(detectFramework(pkgPath));
  // Workspace-bound: a previous run's user-authored child can still be alive and
  // swapping directory entries under the workspace, so the write descends from
  // the root rather than resolving `pkgPath/.env` by name (H-003).
  const envPath = { root: workspaceRoot, rel: path.join(path.relative(workspaceRoot, pkgPath), '.env') };
  for (const conn of business) {
    setToggleDefaultIfAbsent(envPath, conn.virtualization!.toggleEnvVar, framework);
  }
}
