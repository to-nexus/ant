# React Native Framework Hints

Blind-spot reminders. Pre-training gap only.

## Forbidden Patterns

- Web-only primitives (`<div>`, `<span>`, `<p>`, `<button>`) as JSX tags — runtime rejects them, not TS compile.
- Text outside a `<Text>` element → "Text strings must be rendered within a <Text> component".
- `ScrollView` + `.map()` for non-trivial lists → frame drops; use `FlatList`.
- Web-style `display: block/inline/grid` → silently ignored; RN is flexbox-only, `column` main axis.

## Symptom → Upstream Cues

If many files need the same shim, fix upstream:

- Repeated `Platform.select({ ios, android })` per component → a dependency is wrong for one platform; replace the library.
- `SafeAreaView` wrappers leaf-by-leaf → `SafeAreaProvider` missing at root/navigator.
- Persistent `Keyboard.dismiss()` per screen → a keyboard-aware container at the screen root.

## Version Notes

- New Architecture (Fabric + TurboModules) is the recent default — legacy `RCT_EXPORT_MODULE` is deprecated.
- Hermes is the default JS engine — verify Hermes support for features relying on JSC-only behavior.
- Expo SDK majors pin specific RN versions — do NOT upgrade RN independently on an Expo project.

## Toolchain Compatibility

- Metro resolves `.ios.tsx` > `.android.tsx` > `.tsx`; new variants need `metro.config.js` registration.
- Reanimated requires a Babel plugin — missing it yields "worklet" runtime errors, not build errors.
- Default Node Jest fails to parse JSX in `node_modules`; RN needs the `react-native` preset.
