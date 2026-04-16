## Visual Language: Deep Muted
supportedModes: dark

### Identity
Quiet, composed, and restful. Recognizable by its deep charcoal canvas, low-chroma surfaces, and soft foreground tones. The impression is calm focus — the interface recedes so content can breathe.

### Palette
#### Dark Mode
--background: oklch(0.17 0.008 270)
--foreground: oklch(0.88 0.005 270)
--primary: oklch(0.62 0.08 250)
--primary-foreground: oklch(0.98 0.00 0)
--secondary: oklch(0.22 0.006 270)
--accent: oklch(0.26 0.01 260)
--muted: oklch(0.20 0.005 270)
--muted-foreground: oklch(0.55 0.008 270)
--destructive: oklch(0.58 0.17 25)
--border: oklch(0.27 0.006 270)
--radius: 0.5rem

### Typography
--font-heading: "Inter"
--font-body: "Inter"
--font-mono: "JetBrains Mono"
Regular weight body, medium headings. Slightly elevated line-height for comfortable dark-mode reading. Size hierarchy kept gentle — no dramatic jumps.

### Signature
Uniformly low-chroma surfaces where card, sidebar, and background differ only by subtle lightness steps.
A single desaturated blue primary that provides orientation without demanding attention.
Soft foreground colors (never pure white) to reduce eye strain in prolonged dark-mode use.

### Constraints
Constraint: Do NOT use pure white text — foreground must remain slightly desaturated.
Constraint: Do NOT introduce bright or saturated accent colors — keep chroma under control.
Constraint: Do NOT add light-mode surfaces or bright cards in this dark-only palette.
Constraint: Do NOT use gradients, glows, or neon effects.
