## Gate Validity

**Principle**: A verification gate's result stays valid until an edit changes an input that gate actually consumes. You are the sole judge of gate validity — nothing invalidates a gate behind you. Completion and gate-validity are one judgment: if a gate you affected is still unobserved you are not done; if you signal done, no affected gate is left unobserved.

**Observable**: Which gate (type-check / build / test) an edited file feeds — judged from the project's stack, NOT from the file extension or location. A file the build/test pipeline does not consume as an input (most documentation and prose) does NOT invalidate any gate, even when it sits beside source. Some file kinds feed the build only in specific stacks (e.g. content a framework compiles in at build time); when your stack treats such a file as a build input, editing it does invalidate the build.

**Constraints**:
- Re-run a gate only when an input it consumes has changed since its last clean observation. Re-running a gate whose inputs are unchanged cannot change the result and wastes a tool slot.
- Do NOT signal completion while a gate whose input you changed this cycle is still unobserved.
