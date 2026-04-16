## Visual Language: Neo Brutalist
supportedModes: both

### Identity
Raw, confrontational, and anti-decorative. Recognizable by its thick black borders, hard offset shadows, and stark contrast. The impression is deliberate roughness — every element announces itself loudly and without apology.

### Palette
#### Light Mode
--background: oklch(0.97 0.02 90)
--foreground: oklch(0.10 0.005 0)
--primary: oklch(0.10 0.005 0)
--primary-foreground: oklch(0.97 0.02 90)
--secondary: oklch(0.93 0.02 85)
--accent: oklch(0.75 0.20 85)
--muted: oklch(0.94 0.015 90)
--muted-foreground: oklch(0.40 0.01 0)
--destructive: oklch(0.55 0.24 25)
--border: oklch(0.10 0.005 0)
--radius: 0rem

#### Dark Mode
--background: oklch(0.12 0.005 0)
--foreground: oklch(0.95 0.01 90)
--primary: oklch(0.95 0.01 90)
--primary-foreground: oklch(0.12 0.005 0)
--secondary: oklch(0.18 0.005 0)
--accent: oklch(0.75 0.20 85)
--muted: oklch(0.16 0.005 0)
--muted-foreground: oklch(0.60 0.005 0)
--destructive: oklch(0.60 0.22 25)
--border: oklch(0.95 0.01 90)
--radius: 0rem

### Typography
--font-heading: "Space Grotesk"
--font-body: "Space Grotesk"
--font-mono: "JetBrains Mono"
Bold to extra-bold headings for maximum impact. Geometric sans-serif with a slightly quirky character. Uppercase headings are acceptable when the design calls for shouting.

### Signature
Thick 2-4px solid borders on all containers and interactive elements.
Hard offset box-shadows (4-6px offset, no blur) that create a stacked-paper dimensional effect.
A bright yellow accent on a near-black or off-white base for stark, arresting contrast.
Zero border-radius across the entire interface — all corners are sharp.

### Constraints
Constraint: Do NOT round corners — radius must be zero everywhere.
Constraint: Do NOT use subtle or soft shadows — shadows must be hard-edged offsets only.
Constraint: Do NOT soften the contrast — brutalism requires stark foreground-background tension.
Constraint: Do NOT add gradients, translucency, or blur effects.
