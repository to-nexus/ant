// OSS / cloud seam: `@ant/cloud/ui` is an optional, side-effect-only registrar
// module (store slices + UI slots). It is present only when the `@ant/cloud`
// overlay package is installed (cloud builds). In the public OSS build the
// package is absent and the `import('@ant/cloud/ui')` in `main.tsx` is
// dead-code-eliminated by Vite (gated on `VITE_INCLUDE_CLOUD`). This ambient
// declaration lets `tsc` resolve the bare specifier in both cases without a
// real module on disk. No exports are consumed — the import runs for its
// registration side effects only.
declare module '@ant/cloud/ui';
