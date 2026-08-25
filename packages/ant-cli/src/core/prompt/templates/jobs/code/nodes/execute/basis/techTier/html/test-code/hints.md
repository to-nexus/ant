## Static HTML Test Generation Hints

**Principle**: A static HTML/CSS/JS project has no unit-test toolchain — there is no runner to configure and nothing to install.

**Constraint**: Do NOT introduce a dependency manifest, test runner, or any toolchain to make tests runnable. Verification for a static deliverable is static inspection: reference integrity (every `href`/`src` resolves to a real file) and document well-formedness (doctype, balanced tags).

**Constraint**: If the directive explicitly demands automated tests, report that a static deliverable carries no test toolchain and record the static checks performed instead — do not convert the project into a Node project to host a runner.
