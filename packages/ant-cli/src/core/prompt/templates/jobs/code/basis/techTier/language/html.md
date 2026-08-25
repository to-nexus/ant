# Static HTML Hints

Blind-spot reminders for plain static HTML/CSS/JS deliverables. The browser is the runtime; files are served as written.

## Forbidden Patterns

- Creating `package.json`, lockfiles, `tsconfig.json`, or any build/bundler/linter/test-runner config — a static project has no toolchain, and a manifest silently reclassifies it as a Node project at serve time.
- Running `npm` / `pnpm` / `yarn` / `bun` commands — there is nothing to install or build.
- Importing framework runtimes (module bundler imports, JSX, components) — script behavior is plain browser JS in `<script>` tags or sibling `.js` files.
- Root-absolute (`/assets/...`) or filesystem-absolute asset paths — they break file-open viewing and subpath-mounted serving; use relative paths with exact-case filenames.

## Symptom → Upstream Cues

- Blank page or 404 asset → relative-path or filename-case mismatch between the reference and the file on disk.
- Styles/scripts silently absent → `<link>`/`<script>` path resolves outside the project tree, or the tag was emitted inside a comment or unclosed element.

## Toolchain Compatibility

- There is no install, typecheck, build, or test toolchain. Validation is document well-formedness (doctype, balanced tags, no truncated markup) plus reference integrity (every `href`/`src` resolves to a real file).
- A "build succeeded" observation is meaningless here — the only meaningful gates are the files themselves.
