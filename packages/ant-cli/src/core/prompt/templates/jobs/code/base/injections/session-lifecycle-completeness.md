## Session Lifecycle — survive restart · rehydrate identity

### Principle

An authenticated session the running surface treats as established MUST survive a process or page restart as a COMPLETE session — not a partial one. On bootstrap, the session boundary reads a **client-durable store** and **rehydrates the full identity-bearing state** the session implies: the identity itself, its active role / mode, and the entitlements that gate downstream surfaces — not merely a credential.

### Constraints

- Persisting a credential and rehydrating the identity it implies are **one closed round-trip** owned by the session boundary. A bootstrap that restores "a session is established" WITHOUT restoring the identity it implies leaves every identity-gated surface reading an absent identity — the surface renders empty or unauthorized while the guard already believes the user is in.
- When the identity-bearing state cannot be reconstructed from the durable store alone, the boundary re-derives it through the same port the sign-in path used BEFORE admitting the session — it does not admit a credential-only session.
- Restoring a **previously and deliberately chosen** identity on restart is NOT the silently-bound default identity that an interactive sign-in flow forbids: the former replays the user's own prior choice; the latter binds an identity the user never chose. Honor both — rehydrate the prior choice, never invent a default.
