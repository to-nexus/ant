## Visual Language: NEXUS Design System
supportedModes: both

### Identity
Data-dense, functional, and composed. Dark-mode-first enterprise interface designed for trading platforms, dashboards, and professional tools where information density matters but readability must not be sacrificed. Every visual element serves a purpose — no decorative flourishes.

### Palette
#### Light Mode
--background: oklch(1.00 0.00 0)
--foreground: oklch(0.17 0.02 255)
--primary: oklch(0.65 0.12 170)
--primary-foreground: oklch(1.00 0.00 0)
--secondary: oklch(0.96 0.005 240)
--accent: oklch(0.70 0.12 170)
--muted: oklch(0.96 0.005 240)
--muted-foreground: oklch(0.55 0.01 250)
--destructive: oklch(0.50 0.22 25)
--border: oklch(0.88 0.005 240)
--radius: 0.5rem

#### Dark Mode
--background: oklch(0.20 0.02 255)
--foreground: oklch(0.92 0.005 240)
--primary: oklch(0.65 0.12 170)
--primary-foreground: oklch(1.00 0.00 0)
--secondary: oklch(0.24 0.02 255)
--accent: oklch(0.70 0.12 170)
--muted: oklch(0.17 0.02 255)
--muted-foreground: oklch(0.55 0.01 250)
--destructive: oklch(0.55 0.20 25)
--border: oklch(0.28 0.015 255)
--radius: 0.5rem

### Typography
--font-heading: "Inter"
--font-body: "Inter", "Pretendard"
--font-mono: "JetBrains Mono"
Weight-driven hierarchy: Regular (400) body, Medium (500) labels, Semi-bold (600) headings, Bold (700) display. Tight letter-spacing for body, neutral for headings. Line-height tuned per token level — do not override.

### Signature
Teal/green accent as the single brand color, reserved for primary CTA, links, and active states.
Three-layer surface depth system: bg (page) -> surface-default (cards) -> surface-subtle (nested). Never skip layers.
Semantic token hierarchy for text: highlight -> primary -> secondary -> tertiary -> muted, each with defined purpose.
Borders preferred over shadows for static elements; shadows only for interactive overlays.

### Constraints
Constraint: Do NOT use shadows on static cards or panels — use 1px borders instead. Shadows imply interactivity or overlay.
Constraint: Do NOT apply accent-primary to more than one CTA per visible area — secondary actions use outline or ghost.
Constraint: Do NOT place surface-subtle directly on bg-default — always use surface-default as an intermediate layer.
Constraint: Do NOT use status colors (success, warning, danger) for decorative purposes — status colors appear only on alerts, badges, and indicators.
Constraint: Do NOT use font-bold (700) for body text — bold is reserved for display and h1-h2 headings only.
