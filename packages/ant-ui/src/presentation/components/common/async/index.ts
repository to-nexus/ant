/**
 * Public API for the Async UI Policy module.
 *
 * External consumers MUST import exclusively from this barrel — never
 * reach into `primitives/`, `hooks/`, `boundary/`, or `ambient/` directly.
 * ESLint + CI grep guard enforce the primitive usage; this barrel keeps
 * the consumer surface narrow.
 *
 * See docs/architecture/ui-async-policy.md for the rationale.
 */
export * from './primitives';
export * from './hooks';
export * from './boundary';
export * from './ambient';
