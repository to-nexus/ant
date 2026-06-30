## Framework Grounding — React Native

**Applies when**: a React Native app is the grounded codebase.

When the spec/design is grounded on an existing React Native codebase, anchor decisions in the app's observed structure and the mobile runtime's constraints. Inspect before asserting.

---

### Composition & navigation

**Principle**: Behavior is partitioned across screens, navigation, state, and native-bridge I/O — the spec must place a new feature against this split, not a web SPA model.

- Where screens live vs the navigation configuration (navigator tree / route registry).
- Where state lives vs where device/native access (storage, permissions, platform APIs) is mediated.

### Mobile-runtime observables the spec must respect

**Principle**: The platform imposes constraints a backend/web spec would omit.

- Platform divergence (iOS vs Android) when behavior differs — name it explicitly in the contract.
- Lifecycle/background constraints and permission flows for any device capability the feature touches.

### What the spec owns vs defers

Specify the screen/navigation placement, the data + permission contract, and platform-specific behavior. Do NOT author component/native code or restate React Native APIs — name *what* and *where*; the code job decides *how*.
