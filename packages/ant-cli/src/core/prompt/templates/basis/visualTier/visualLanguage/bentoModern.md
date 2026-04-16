## Visual Language: Bento Modern
supportedModes: both

### Identity
Modular, vibrant, and grid-conscious. Recognizable by its bento-box card layout, subtle gradient accents, and the feeling of a well-organized mosaic. The impression is contemporary polish — structured yet expressive.

### Palette
#### Light Mode
--background: oklch(0.98 0.005 270)
--foreground: oklch(0.16 0.01 270)
--primary: oklch(0.55 0.18 275)
--primary-foreground: oklch(0.99 0.00 0)
--secondary: oklch(0.95 0.01 270)
--accent: oklch(0.65 0.15 310)
--muted: oklch(0.96 0.005 270)
--muted-foreground: oklch(0.50 0.01 270)
--destructive: oklch(0.55 0.20 25)
--border: oklch(0.90 0.008 270)
--radius: 1rem

#### Dark Mode
--background: oklch(0.14 0.01 270)
--foreground: oklch(0.94 0.005 270)
--primary: oklch(0.65 0.16 275)
--primary-foreground: oklch(0.99 0.00 0)
--secondary: oklch(0.20 0.01 270)
--accent: oklch(0.65 0.13 310)
--muted: oklch(0.18 0.008 270)
--muted-foreground: oklch(0.58 0.01 270)
--destructive: oklch(0.60 0.18 25)
--border: oklch(0.24 0.008 270)
--radius: 1rem

### Typography
--font-heading: "Outfit"
--font-body: "Outfit"
--font-mono: "JetBrains Mono"
Semibold headings with a modern geometric feel. Clean, slightly rounded letterforms. Medium body weight for comfortable reading inside bento cards.

### Signature
Large rounded-corner cards arranged in asymmetric bento-grid compositions.
Subtle gradient fills (primary-to-accent direction) on hero cards and featured surfaces.
A secondary purple-pink accent tone that complements the blue primary for gradient richness.

### Constraints
Constraint: Do NOT use flat uniform backgrounds on feature cards — subtle gradients define this style.
Constraint: Do NOT break the grid rhythm — cards must align to a visible modular grid.
Constraint: Do NOT use more than two gradient hue stops (primary and accent).
Constraint: Do NOT apply gradients to text — gradients are for surfaces only.
