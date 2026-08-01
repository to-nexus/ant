# Third-Party Notices

Ant is licensed under the [Apache License 2.0](LICENSE). It depends on
third-party software distributed under its own terms. The overwhelming majority
of those dependencies are permissively licensed (MIT, ISC, Apache-2.0,
BSD-2/3-Clause) and require no notice beyond the license text shipped inside
each package under `node_modules/`.

This file records the cases that carry an obligation or that a license scanner
will flag. It is maintained by hand; if you add a dependency whose license is
not MIT / ISC / Apache-2.0 / BSD, add a row here in the same PR.

---

## 1. libvips prebuilt binaries — LGPL-3.0-or-later

`@ant/cli` depends on [`sharp`](https://github.com/lovell/sharp) (Apache-2.0)
for image processing. `sharp` resolves a platform-specific prebuilt binary
package — `@img/sharp-libvips-{platform}-{arch}` — which bundles
[libvips](https://github.com/libvips/libvips) and is licensed
**LGPL-3.0-or-later**. This is the only copyleft component in the dependency
tree.

Ant links against an **unmodified** libvips through `sharp`'s standard N-API
binding and does not statically incorporate it into any Ant source file. Under
LGPL-3.0 §4 you may modify and relink libvips: the binary is a separate,
independently replaceable package under `node_modules/@img/`, and you may swap
it for your own build of the same library. Nothing in Ant's Apache-2.0 grant
restricts you from doing so.

- Upstream: https://github.com/libvips/libvips
- License text: https://www.gnu.org/licenses/lgpl-3.0.html
- Installed copy: `node_modules/@img/sharp-libvips-*/LICENSE`

## 2. Web fonts — SIL Open Font License 1.1

The marketing site (`packages/ant-site`) uses `next/font/google` to load
**Plus Jakarta Sans** and **JetBrains Mono**. `next/font` downloads the font
files at build time and **self-hosts** them from the production build output,
which means Ant's built site redistributes them.

Both families are licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/), which permits
bundling and redistribution provided the fonts are not sold on their own and
the license accompanies them.

| Font | Copyright | License |
|---|---|---|
| Plus Jakarta Sans | Copyright (c) Tokotype | SIL OFL 1.1 |
| JetBrains Mono | Copyright (c) JetBrains s.r.o. | SIL OFL 1.1 |

The web application (`packages/ant-ui`) loads the same two families from
`fonts.googleapis.com` at runtime rather than self-hosting them, so it
redistributes nothing. Note that this is an outbound request to Google on every
page load; if that is unacceptable for your deployment, self-host the fonts and
drop the `<link>` tags in `packages/ant-ui/index.html`.

## 3. Mozilla Public License 2.0 components

MPL-2.0 is a file-level copyleft: you may combine MPL files with
differently-licensed code, but modifications to the MPL files themselves must
stay under MPL-2.0. Ant does not modify either package.

| Package | Role | Reached via |
|---|---|---|
| `@vercel/og` | Open Graph image generation | transitive dependency of `next` (`packages/ant-site`) |
| `dompurify` | HTML sanitisation | transitive dependency of `mermaid` (`packages/ant-ui`) — dual-licensed `MPL-2.0 OR Apache-2.0`; Ant elects **Apache-2.0** |

## 4. Runtime services (not redistributed)

Ant runs these as unmodified container images pulled at deploy time. Ant does
not build, modify, or redistribute them, so their licenses impose no obligation
on Ant or on you as an Ant deployer. They are listed because they affect anyone
who chooses to **build and ship their own derived images**.

| Image | License | Note |
|---|---|---|
| `redis:7-alpine` | RSALv2 / SSPL-1.0 (dual, non-OSI) | The `7` tag now resolves to Redis 7.4+, which left BSD-3-Clause. Used as a plain network service. A BSD-licensed drop-in (Valkey, or `redis:7.2-alpine`) works if you need an OSI-licensed image. |
| `chromadb/chroma` | Apache-2.0 | Optional — only when `ANT_VECTOR_DB_ENABLED=true`. |
| `gitpod/openvscode-server` | MIT | Optional — the browser IDE. Bundles a large third-party userland with its own notices. |

The optional Python sidecars under
`packages/ant-cli/src/periphery/integrations/` pull `rembg` (MIT) and
`sentence-transformers` (Apache-2.0); the default model weights they download
(`u2net`, `all-MiniLM-L6-v2`) are Apache-2.0. No model weights are vendored in
this repository.

## 5. Scanner notes

- **`khroma`** (transitive under `mermaid`) declares no `license` field in its
  npm manifest, though its source carries an MIT header. Automated scanners
  report it as "unknown". No action taken.
- **`caniuse-lite`** is CC-BY-4.0. It is a build-time browser-support dataset,
  not shipped code.
- **`argparse@2.0.1`** is Python-2.0, a permissive license.
- **Linux desktop builds only**: `ant-desktop` links the system GTK3 and
  WebKitGTK, which are LGPL-2.1. The Rust bindings are MIT. This applies only
  if the currently-disabled Linux build targets are re-enabled.

## 6. Generating a full inventory

To produce a complete machine-readable list of every installed dependency and
its declared license:

```bash
pnpm licenses list --json > licenses.json
```
