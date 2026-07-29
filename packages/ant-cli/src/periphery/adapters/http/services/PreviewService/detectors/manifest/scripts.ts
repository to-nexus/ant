/**
 * npm script resolution — which script starts a package's dev preview.
 *
 * Lives in the manifest module because it is pure `package.json` reading, and
 * because `canStartFromManifests` needs it (keeping it in `PackageDetector`
 * created an import cycle once that class became a projection over these
 * tables). Re-exported from `PackageDetector` for existing importers.
 */

/**
 * Preference order for the npm script that starts a dev preview, per package
 * type. The decision is version/framework-independent — it relies only on the
 * scripts the project itself declares. `start:dev` (NestJS `nest start --watch`)
 * is preferred over plain `start` for backends, since a backend `start` is
 * typically `node dist/main` and requires a prior build. The backend list is a
 * superset of the others, so it doubles as the type-agnostic runnability probe.
 */
const RUN_SCRIPT_PREFERENCE: Record<'frontend' | 'backend' | 'other', readonly string[]> = {
  frontend: ['dev', 'develop', 'serve', 'start'],
  backend: ['dev', 'start:dev', 'develop', 'serve', 'dev:server', 'start'],
  other: ['dev', 'start:dev', 'develop', 'serve', 'start'],
};

/**
 * Resolve the npm script name to run for a dev preview, or `undefined` if the
 * package declares none. SSOT for "which script starts this package" — used by
 * the spawner (to build `npm run <script>`) and the structure detector.
 */
export function resolveRunScript(pkgJson: any, type: 'frontend' | 'backend' | 'other'): string | undefined {
  const scripts = pkgJson?.scripts ?? {};
  return RUN_SCRIPT_PREFERENCE[type].find(
    name => typeof scripts[name] === 'string' && scripts[name].trim().length > 0,
  );
}

/** Type-agnostic runnability: does the package declare any recognized dev-server script? */
export function hasRunnableScript(pkgJson: any): boolean {
  return resolveRunScript(pkgJson, 'backend') !== undefined;
}
