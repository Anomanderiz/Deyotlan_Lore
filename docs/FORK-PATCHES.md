---
title: Fork patches
draft: true
---

# Fork patches

This repository is a **fork of Quartz v5 itself**, not a Quartz consumer project. The
engine in `quartz/` is vendored and locally modified, so pulling upstream will conflict.

This file is the register of every deliberate divergence from upstream. Keep it current:
a patch that is not listed here is a patch that will be lost or silently reverted at the
next upstream merge.

## Conventions

- Every patch hunk inside an upstream file carries a `// DEYOTLAN:` comment (or
  `# DEYOTLAN:` in YAML, `/* DEYOTLAN: */` in SCSS) so the full set is greppable:

  ```bash
  grep -rn "DEYOTLAN:" quartz/ api/ vercel.json quartz.config.yaml
  ```

- **Prefer new files over edits to upstream files.** New code belongs in
  `quartz/components/wiki/`, `quartz/components/admin/`, `quartz/styles/`, or `api/` —
  none of which exist upstream, so none of them can conflict. Only add a hunk to an
  upstream file when there is genuinely no registration point.
- `docs/` is upstream Quartz documentation, not site content. It is excluded from the
  build only because the build reads `content/`. This file lives here because it
  documents the engine, not the campaign.

---

## Current patches

### Theme and layout

| File                                        | Change                                                                                                                                                                                    | Why                                                                                                                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quartz/components/Body.tsx`                | Injects a `.mobile-topo-backdrop` layer (lines 6–7)                                                                                                                                       | The topographic background needs a transform layer on mobile; a `position: fixed` background does not work reliably on iOS Safari.                                                                        |
| `quartz/components/Head.tsx`                | Adds `viewport-fit=cover` to the viewport meta (line 63)                                                                                                                                  | Required for iOS safe-area insets, which `mobile-glass.scss` relies on.                                                                                                                                   |
| `quartz/components/frames/DefaultFrame.tsx` | Injects two SVG filter defs, `#deyotlan-liquid-distortion` and `#deyotlan-liquid-distortion-mobile` (lines 29–92)                                                                         | The liquid-glass effect is `backdrop-filter` to capture the real backdrop, then an SVG `feTurbulence`/`feDisplacementMap` pass to distort the captured layer. The mobile variant uses cheaper parameters. |
| `quartz/styles/custom.scss`                 | Entry point that `@use`s the nine bespoke stylesheets; also hides `.page-listing` on the campaign index                                                                                   | The campaign index is hand-authored, so the generated folder listing is redundant.                                                                                                                        |
| `quartz/styles/*.scss`                      | ~5,000 lines of bespoke theme across `deyotlan-glass`, `liquid-glass`, `glass-refraction`, `glass-polish`, `ambient-background`, `mobile-glass`, `mobile-properties`, `mobile-navigation` | The entire visual identity. New files, so no upstream conflict.                                                                                                                                           |

### Configuration

| File                 | Change                                                                                                                 | Why                                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quartz.config.yaml` | `@quartz-community/obsidian-plugin-excalidraw` set `enabled: false`                                                    | The package is in neither `package.json` nor `node_modules`, and no content file uses Excalidraw. It resolved only via `quartz plugin install --from-config` at deploy time, so any npm hiccup failed **every production build**. Re-enable only after adding it to `package.json` with a pinned version. |
| `vercel.json`        | Added a `functions` block for `api/**/*.js` and `headers` for `/admin*`, `/static/nav.json`, `/static/build-info.json` | The `functions` block force-enables the serverless builder rather than relying on zero-config detection. **Do not add `rewrites`** — a catch-all would shadow `/api/*`.                                                                                                                                   |
| `.gitignore`         | Added `.env.local` and `.env*.local`                                                                                   | Local admin secrets.                                                                                                                                                                                                                                                                                      |

### The admin surface (new files, no upstream conflict)

| File                                        | Purpose                                                                                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/_lib/http.js`                          | Raw-Node request/response helpers. Deliberately avoids every Vercel-specific convenience (`res.json`, `req.body`, `req.cookies`) so the same handler files run unchanged under Vercel and under `quartz build --serve`. |
| `api/_lib/auth.js`                          | scrypt password verification, HMAC-signed stateless session cookie, CSRF guard, warm-instance login throttle. No dependencies beyond `node:crypto`.                                                                     |
| `api/_lib/store.js`, `api/_lib/fsstore.js`  | Storage adapter. `fs` backend locally, `github` on Vercel, selected by `DEYOTLAN_STORE` or the presence of `VERCEL`.                                                                                                    |
| `api/{health,login,logout,session}.js`      | Endpoints.                                                                                                                                                                                                              |
| `scripts/admin-secrets.mjs`                 | Generates `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET`. The plaintext password is never stored.                                                                                                                     |
| `quartz/plugins/emitters/adminPages.ts`     | Emits `/admin` as standalone HTML, plus `/robots.txt` and `/static/build-info.json`.                                                                                                                                    |
| `quartz/components/admin/*.tsx`             | Admin document shell and views.                                                                                                                                                                                         |
| `quartz/components/scripts/admin.inline.ts` | Admin client.                                                                                                                                                                                                           |
| `quartz/styles/admin.scss`                  | Admin styles. **Not** `@use`d from `custom.scss`, so the two stylesheets stay disjoint.                                                                                                                                 |

Two registration patches were needed for the emitter:

| File                                     | Change                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `quartz/plugins/emitters/index.ts`       | `export { AdminPages } from "./adminPages"`                        |
| `quartz/plugins/loader/config-loader.ts` | Added `builtinPlugins.AdminPages()` to the `builtinEmitters` array |

And one for local development:

| File                     | Change                                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quartz/cli/handlers.js` | Added a `pathToFileURL` import and an `/api/*` dispatch block in the dev server, immediately after the `baseDir` strip. Imports each handler with an mtime cache-buster so function code hot-reloads without restarting the server. |

#### Two sharp edges in this area

1. **`robots.txt` cannot live in `quartz/static/`.** That directory is copied to
   `public/static/`, which would put the file at `/static/robots.txt` where no crawler
   reads it. It is emitted at the site root by `adminPages.ts` instead.

2. **The inline-script-loader rewrites source with naive string replacement.**
   `quartz/cli/handlers.js` runs `text.replace("export default", "")` and then
   `text.replace("export", "")` — each hits the _first_ occurrence anywhere in the
   file, including inside comments. Writing those words in a comment silently consumes
   the replacement and changes what is generated. Any `.inline.ts` file must therefore
   contain the keyword exactly once, on its final line. `admin.inline.ts` documents
   this at the top without spelling the word out.

### The curated navigation (Phase 5-6)

`@quartz-community/explorer` is **disabled**. It is replaced by a first-party
component that renders curated groups from `quartz/static/nav.json` rather than the
folder tree, so a page can sit under any heading without its file moving or its URL
changing.

| File                                           | Purpose                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `quartz/components/wiki/WikiNav.tsx`           | The component. Reproduces the explorer DOM exactly (see the contract below).  |
| `quartz/components/wiki/reconcile.ts`          | Pure index-plus-manifest to rendered-groups logic. No DOM, fully unit-tested. |
| `quartz/components/wiki/dnd.ts`                | Pointer-based drag reordering, admin only.                                    |
| `quartz/components/wiki/register.ts`           | Registers first-party components in `componentRegistry`.                      |
| `quartz/components/scripts/wiki-nav.inline.ts` | Client: fetch, paint, collapse, persistence.                                  |
| `quartz/styles/wiki-nav.scss`                  | Additive only; the theme supplies the rest.                                   |
| `quartz/static/nav.json`                       | The manifest. Committed, and written by `/api/nav`.                           |
| `api/nav.js`                                   | Reads and replaces the manifest.                                              |

`quartz/plugins/loader/config-loader.ts` gained a second patch in `loadQuartzLayout()`
that calls `registerLocalComponents()` and appends synthetic layout entries for
`wiki-nav` (left, priority 50 — the explorer's old slot) and `wiki-tags` (right,
priority 40). This works because `extractPluginName` returns a bare string source
unchanged (`config-loader.ts:79`), so `componentRegistry.get("wiki-nav")` resolves.

**Removed in this phase:** `quartz/components/scripts/explorer-defaults.inline.ts` and
its injection at `componentResources.ts:91`. It existed only because the community
explorer ignored its own `folderDefaultState` option; WikiNav owns that state
natively. Net fork surface in the navigation area went _down_.

### Tag browsing (Phase 7)

| File                                                        | Purpose                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| `quartz/components/wiki/tags.ts`                            | Tag counting, filtering, and unresolved-wikilink detection. Pure. |
| `quartz/components/wiki/WikiTags.tsx`                       | Per-page tag chips in the right sidebar, linking into `/browse`.  |
| `quartz/components/scripts/browse.inline.ts`                | The `/browse` client.                                             |
| `quartz/styles/browse.scss`, `quartz/styles/wiki-tags.scss` | Styles.                                                           |
| `quartz/styles/_surface-tokens.scss`                        | Design tokens shared by `/admin` and `/browse`.                   |

`@quartz-community/tag-page` stays enabled. The division is deliberate: it owns
_one tag to its pages_ as an indexable permalink at `/tags/<tag>`, and `/browse` owns
_many tags to their intersection_, interactively.

#### Two things the content index does not contain

`public/static/contentIndex.json` carries only `slug`, `filePath`, `title`, `links`,
`tags` and `content`. Two consequences bit during development, and both are now
handled by an extra file, `static/wiki-meta.json`, emitted by `adminPages.ts`:

1. **No dates at all.** `autoSort: "date-desc"` was silently inert — session notes
   sorted alphabetically rather than newest-first. The `dates` map fixes it.
2. **No alias slugs.** `@quartz-community/alias-redirects` emits redirect stubs as
   HTML, but they never enter the index, so `/browse` would have reported a link
   through an alias as broken. The `aliases` map fixes it.

Both are covered by regression tests in `quartz/components/wiki/`.

## The `.explorer` DOM contract## The `.explorer` DOM contract

**36 SCSS rules across 5 files** target the explorer's DOM. Any replacement navigation
component must reproduce that structure exactly, or the glass theme and the mobile
drawer state machine break.

| File                                   | Rules |
| -------------------------------------- | ----- |
| `quartz/styles/deyotlan-glass.scss`    | 14    |
| `quartz/styles/mobile-navigation.scss` | 13    |
| `quartz/styles/liquid-glass.scss`      | 5     |
| `quartz/styles/mobile-glass.scss`      | 3     |
| `quartz/styles/glass-polish.scss`      | 1     |

Regenerate the count with:

```bash
grep -rn "explorer\|folder-outer\|folder-container\|folder-icon" quartz/styles/*.scss | wc -l
```

Required structure:

```html
<div class="explorer nav-files-container">
  <button class="explorer-toggle mobile-explorer hide-until-loaded">…</button>
  <div class="explorer-content">
    <ul class="explorer-ul">
      <li class="overflow-end"></li>
    </ul>
  </div>
  <template id="template-file">…</template>
  <template id="template-folder">…</template>
</div>
```

Also load-bearing: the `.collapsed` class on the root as the mobile drawer's state flag,
and the `mobile-no-scroll` class toggled on `documentElement`. `mobile-navigation.scss:97`
documents that contract explicitly and warns against changing it.

## Build pipeline facts worth knowing

- `quartz/cli/handlers.js:346` builds with esbuild `packages: "external"`, so plugin
  packages are **dynamically imported at runtime, never bundled**. A local plugin package
  would have to ship pre-built ESM with no TS, no JSX, no `.inline.ts` and no SCSS.
  Anything under `quartz/` gets all of that for free — which is why first-party code
  lives there rather than in a plugin package.
- `quartz/plugins/loader/config-loader.ts:494` — `builtinEmitters` is a hardcoded array.
  Adding a first-party emitter is a one-line patch there plus an export in
  `quartz/plugins/emitters/index.ts`.
- `quartz/plugins/loader/config-loader.ts:79` — `extractPluginName` falls through to
  `return source`, so a bare-string source such as `"wiki-nav"` resolves straight through
  `componentRegistry` and can be placed in the layout without being an npm package.
- `quartz/plugins/emitters/static.ts:10-20` — `quartz/static/**` is copied to
  `public/static/**` byte-for-byte, with no slugification. Files under `content/` are
  slugified by `assets.ts`, so generated data files belong in `quartz/static/`.
- `quartz/components/renderPage.tsx:75` — `fetchData` is a global promise for
  `contentIndex.json` on every page, so client scripts need no fetch plumbing.
- `.gitignore` ignores `.quartz/` (dotted) and `public/`, but **not** `quartz/`. Files
  written to `quartz/static/` are committed normally.
- All six GitHub workflows are gated `if: github.repository == 'jackyzha0/quartz'`, so
  none of them run on this fork.
