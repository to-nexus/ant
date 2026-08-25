/**
 * Manifest → language / framework lookup tables.
 *
 * Ordered, dependency-name driven. Each table is consulted in array order, so
 * a meta-framework (Next.js) wins over the UI library it is built on (React).
 *
 * Vocabulary SSOT: `ProjectProfile.language` / `.framework` in
 * `@ant/shared/preview`. This is the OBSERVATION axis — deliberately broader
 * than TechTier's closed decision enum.
 */

/** Ordered `[dependency name, framework id]` pairs for Node manifests. */
export const NODE_META_FRAMEWORKS: ReadonlyArray<readonly [string, string]> = [
  ['next', 'nextjs'],
  ['nuxt', 'nuxt'],
  ['@remix-run/react', 'remix'],
  ['@remix-run/dev', 'remix'],
  ['@sveltejs/kit', 'sveltekit'],
  ['astro', 'astro'],
  ['@angular/core', 'angular'],
  ['expo', 'expo'],
  ['react-native', 'react-native'],
];

export const NODE_SERVER_FRAMEWORKS: ReadonlyArray<readonly [string, string]> = [
  ['@nestjs/core', 'nestjs'],
  ['fastify', 'fastify'],
  ['hono', 'hono'],
  ['@hapi/hapi', 'hapi'],
  ['koa', 'koa'],
  ['express', 'express'],
];

export const NODE_UI_LIBRARIES: ReadonlyArray<readonly [string, string]> = [
  ['react-scripts', 'cra'],
  ['vue', 'vue'],
  ['svelte', 'svelte'],
  ['solid-js', 'solid'],
  ['preact', 'preact'],
  ['react', 'react'],
];

export const PYTHON_FRAMEWORKS: ReadonlyArray<readonly [string, string]> = [
  ['django', 'django'],
  ['fastapi', 'fastapi'],
  ['streamlit', 'streamlit'],
  ['flask', 'flask'],
  ['sanic', 'sanic'],
  ['tornado', 'tornado'],
];

/** Go module paths are matched as substrings of `go.mod`. */
export const GO_FRAMEWORKS: ReadonlyArray<readonly [string, string]> = [
  ['github.com/gin-gonic/gin', 'gin'],
  ['github.com/gofiber/fiber', 'fiber'],
  ['github.com/labstack/echo', 'echo'],
  ['github.com/go-chi/chi', 'chi'],
  ['github.com/gorilla/mux', 'gorilla-mux'],
];

export const RUST_FRAMEWORKS: ReadonlyArray<readonly [string, string]> = [
  ['axum', 'axum'],
  ['actix-web', 'actix-web'],
  ['rocket', 'rocket'],
  ['warp', 'warp'],
  ['tide', 'tide'],
];

export const JVM_FRAMEWORKS: ReadonlyArray<readonly [string, string]> = [
  ['spring-boot', 'spring-boot'],
  ['quarkus', 'quarkus'],
  ['micronaut', 'micronaut'],
  ['ktor', 'ktor'],
];

/** Makefile targets that count as "this project can be started". */
export const RUNNABLE_MAKE_TARGETS: readonly string[] = ['dev', 'run', 'serve'];

/**
 * Doc-root candidates for a manifest-less static site, in probe order — the
 * first directory holding {@link STATIC_ENTRY_FILE} wins. Depth-1 allowlist, so
 * the probe stays a handful of `existsSync` calls (the manifest module's
 * shallow/synchronous contract).
 */
export const STATIC_DOC_ROOTS: readonly string[] = [
  '.',
  'public',
  'www',
  'site',
  'dist',
  'build',
  'src',
];

/** The file whose presence makes a directory a servable static site. */
export const STATIC_ENTRY_FILE = 'index.html';
