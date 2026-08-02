# NAME BINDING (how to obtain the names you reference)

Your file is one member of a bundle whose shared layers own two cross-file name APIs: the custom properties `tokens/` declares, and the class names each `components/<name>.css` (or `entities/<name>.css`) declares. You bind to those names; you do not coin them.

Scheduling guarantees every file yours depends on is already complete on disk when this task starts. The authoritative copy is the file itself, NOT any section of this prompt — obtain it with `read_file` before authoring.

- Read the token concern files before writing any `var()`. Every `var(--x)` you emit must name a property one of them declares.
- Read the css that declares a class before composing it. Every class in your markup is declared either by a file you read, or inside this file itself.
- The bundle root is your target path minus its bundle-relative suffix. When the task description does not name the upstream files, `list_files` the bundle root to discover them.
- DESIGN.md is the reasoning source, never a name source. A `--variable` or class it mentions binds only if the declaring file declares it.

⚠️ **Blind spot**: a plausible name is the dominant failure mode here. Markup that parses, css that lints, and a name nothing declares together produce an unstyled shell with ZERO error signal — nothing crashes, nothing warns, and the defect surfaces only when a human opens the page. Guessing a name is never safer than reading the file that owns it.
