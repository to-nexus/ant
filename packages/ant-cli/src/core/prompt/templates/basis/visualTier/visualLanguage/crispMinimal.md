## Visual Language: Crisp Minimal
supportedModes: both

### Identity
Reductive, typographic, and monochrome. Recognizable by its near-absence of color, single deliberate accent, and reliance on type hierarchy as the primary visual tool. The impression is quiet confidence — nothing is present unless it earns its place.

### Palette
#### Light Mode
--background: oklch(0.995 0.00 0)
--foreground: oklch(0.13 0.003 0)
--primary: oklch(0.13 0.003 0)
--primary-foreground: oklch(0.99 0.00 0)
--secondary: oklch(0.96 0.003 0)
--accent: oklch(0.55 0.15 185)
--muted: oklch(0.96 0.002 0)
--muted-foreground: oklch(0.50 0.003 0)
--destructive: oklch(0.52 0.20 25)
--border: oklch(0.90 0.003 0)
--radius: 0.25rem

#### Dark Mode
--background: oklch(0.12 0.003 0)
--foreground: oklch(0.92 0.003 0)
--primary: oklch(0.92 0.003 0)
--primary-foreground: oklch(0.12 0.003 0)
--secondary: oklch(0.18 0.003 0)
--accent: oklch(0.60 0.13 185)
--muted: oklch(0.16 0.002 0)
--muted-foreground: oklch(0.55 0.003 0)
--destructive: oklch(0.58 0.18 25)
--border: oklch(0.22 0.003 0)
--radius: 0.25rem

### Typography
--font-heading: "Instrument Serif"
--font-body: "Inter"
--font-mono: "JetBrains Mono"
Serif headings at regular to medium weight for quiet elegance. Sans-serif body for functional clarity. The serif–sans pairing is the primary decorative gesture in an otherwise austere interface.

### Signature
True monochrome base (zero chroma) with a single teal accent reserved exclusively for interactive affordances.
Serif heading typeface as the sole decorative element in an otherwise minimal system.
Typography-driven hierarchy where size, weight, and spacing carry all visual structure.

### Constraints
Constraint: Do NOT introduce additional colors beyond the single teal accent.
Constraint: Do NOT add decorative elements, icons as ornament, or illustrative graphics.
Constraint: Do NOT use large border-radius or pill shapes — keep geometry crisp and minimal.
Constraint: Do NOT compete with typography by adding visual noise — let type lead the hierarchy.
