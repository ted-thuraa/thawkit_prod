# ThawKit Asset Management — Audit & Implementation Plan

Status labels used throughout: **CONFIRMED** (verified in inspected source) · **PARTIAL** · **MISSING** · **INFERRED** · **UNRESOLVED**.
References are `path:line — symbol` against the baseline commit below.

---

## 1. Executive Summary

ThawKit already has the *read half* of an asset system and almost none of the *write half*:

* The database table, the tenancy model, a tenant-safe paginated read API, a client cache with batched lookup, ID-based references in layer JSON and the canvas ID→URL resolution all exist and work.
* There is **no way to create or delete an asset**. `openFileManager` — called by every image/icon/video/background/link control — is not defined anywhere (`useEditorStore.ts:31` explicitly excludes it: *"no asset system exists yet"*), so every one of those controls is currently non-functional and fails type-checking (`ImageSettings.tsx:131`, `IconSettings.tsx:87`, …). `uploadthing` is **not installed** (`package.json`), although `env.ts:31-33` already requires its variables.
* Two existing code paths are unsafe: the canvas injects asset/CMS-derived SVG markup with `dangerouslySetInnerHTML` (`LayerRenderer.tsx:3582`), and the YouTube video branch builds an iframe URL from an unvalidated string (`LayerRenderer.tsx:3700-3735`).

**What this change delivers** (smallest coherent architecture, no parallel systems):

1. UploadThing v7 file router (`/api/uploadthing`) with authenticated, tenant-bound middleware, server-side *content* verification in `onUploadComplete`, idempotent metadata persistence, and compensating storage cleanup.
2. A DOM-free **allow-list SVG sanitizer** used at upload time *and* again before any inline injection.
3. `openFileManager`/`closeFileManager` in `useEditorStore` + a `FileManagerDialog` (browse, search, paginate, upload, select, delete) that plugs into the existing controls through their existing callback contract — no control had to be rewritten.
4. A deletion lifecycle that **refuses to delete referenced assets** (draft pages, components, layer styles, CMS values, current published snapshot) and otherwise removes the UploadThing object first, then soft-deletes the row — retry-safe, never reports success on partial failure.
5. Provider-aware external video (`youtube`, `loom`) with allow-listed embed origins and ID validation; no video upload.
6. Tests, a migration (idempotency index), and this document.

Assets remain referenced **by stable ID** (`AssetVariable.data.asset_id`); URLs are resolved at render time. This is the key Ycode principle and ThawKit already follows it.

## 2. Repository and Commit Baseline

| Item | Value |
|---|---|
| Repository | `https://github.com/ted-thuraa/thawkit_prod` (fresh clone, no local checkout was provided) |
| Branch / upstream | `main` / `origin/main` |
| Original HEAD at session start | `3945de31f7c48926827804376a4fc02d0b91c831` (2026-10-20) |
| **Effective base (patch target)** | `fedc6cde9914bf0ec7d87c60c312a3589a58caff` (2026-10-22, "editor area nav fixed"). Mid-task the owner pushed 3 commits (editor-area navigation); after `git fetch --prune` the clean clone was fast-forwarded (`merge --ff-only`) with uncommitted task work present — no overlap, nothing stashed/reset. A backup patch of the in-progress work was taken first. |
| Working tree at start | clean; `git fetch --prune` run; `HEAD == origin/main`, nothing to fast-forward |
| Pre-existing local changes | none (fresh clone) |
| Remote modified / pushed | no |
| Benchmark | `ycode/ycode` cloned read-only to a separate directory; `HEAD == 7de3724bd3e72c98577d14a74f26717ce624bf8a` = the documented reference commit, so the report was checked against the exact snapshot it describes |
| Tooling baseline | `npx tsc --noEmit` on a clean worktree of the effective base → **175 pre-existing errors** (9 are the missing `openFileManager`; repo is mid-refactor). Success criterion: no *new* errors, and the `openFileManager` errors disappear. (Was 177 on `3945de3`.) |

Patch target: `asset-management.patch` applies on top of `fedc6cd`.

## 3. Current ThawKit Architecture (Verified Inventory)

Stack (from `package.json`/lockfile): Next.js 16.3.5 App Router, React 19.3, TypeScript, Drizzle ORM 1.0.0-rc.4 (Postgres, `drizzle-kit` migrations in `src/drizzle/migrations/<ts>_<name>/`), better-auth, Zustand 5, Tailwind 4 + shadcn/base-ui primitives, Zod 4, Tiptap. Tests: Vitest conventions in `tests/` (`tests/vitest.config.ts`; vitest is not a declared dependency — see §11). Deploy target: self-hosted Docker/Coolify (`src/drizzle/db.ts` header) → long-lived Node server.

| Layer | What exists | Evidence |
|---|---|---|
| Schema | `assets` + `asset_folders`, org-scoped, composite PK `(id,is_published)`, soft delete, `content`(inline SVG), `content_hash`, partial indexes | `src/drizzle/schemas/assets-schema.ts:120-186`; migration `20261010114210_mature_queen_noir/migration.sql` |
| Tenancy | `assets.organization_id` FK; every read query carries it | `read/asset-queries.ts:48`, `bootstrap/load-assets.ts` |
| Auth | `requireCampaignScope(campaignId)` → session + org role matrix → `{organizationId, funnelId}` (never trusts client tenant ids) | `read/guards.ts:26`, `auth/require-campaign-permission.ts` |
| Read API | `fetchAssetsPageAction`, `getAssetsByIdsAction`, `getAssetFoldersAction` (zod-validated, `ActionResult`) | `actions/editor/editor-read-actions.ts:100-135` |
| Bootstrap | referenced assets + first library page + folders hydrated into the store | `bootstrap/collect-asset-ids.ts:44`, `load-assets.ts` |
| Client cache | `useAssetsStore`: `assetsById`, batched/deduped/negative-cached `getAsset`, `addAsset`, `removeAsset` | `stores/editor/useAssetsStore.ts:296,332,363` |
| Reference model | `{type:"asset", data:{asset_id}}` in `layer.variables.{image,icon,video,backgroundImage}.src`, link `asset.id`, CMS values | `variable-utils.ts:106`, `types/funnel.ts:1246` |
| Resolution | `getImageUrlFromVariable(src, getAsset)` → `public_url` or SVG data-URL | `variable-utils.ts:388` |
| Canvas | `LayerRenderer` uses store `getAsset`; icon branch inlines `asset.content` | `LayerRenderer.tsx:650-670, 3523-3582` |
| Persistence | whole-tree autosave `savePageLayersAction` (2 s debounce, last-write-wins); publish snapshots `layers` into `funnel_version.compiledSchema` | `editor-actions.ts:404, 471` |
| Public/preview | **No public renderer, preview route, or `/a/` proxy exists** in `src/app` (only `(auth)`, `(main)`, `api/auth`). Proxy rewrite is flag-gated off | `asset-utils.ts:473-510` |
| Upload/delete | **None.** No `uploadthing` dependency, no route, no action | `package.json`, `grep` |
| Picker | Callers all use `openFileManager(onSelect(asset)=>void\|false, currentAssetId?, categoryFilter?)`; the store member does not exist | `ImageSettings.tsx:568`, `IconSettings.tsx:181`, `BackgroundsControls.tsx:659`, `VideoSettings.tsx:834`, `RichTextEditor.tsx:1396`, `LinkSettings.tsx:559`, `AudioSettings.tsx:330` |
| Video | `VideoVariable{provider:"youtube", video_id}`; raw string → `https://www.youtube[-nocookie].com/embed/${id}` | `types/funnel.ts:1255`, `LayerRenderer.tsx:3700-3735` |
| Dead code | `useAssetsStore.deleteFolder/batchReorderFolders` call `/ycode/api/asset-folders/*` which does not exist | `useAssetsStore.ts:426,495` |

## 4. Ycode Benchmark Audit

Source: `ycode/ycode @ 7de3724` (also current HEAD). Method: the report was read in full and each load-bearing claim was opened in source.

| # | Claim in report | Source check | Status | Reuse in ThawKit? |
|---|---|---|---|---|
| 1 | Assets referenced by ID (`createAssetVariable`) | `lib/variable-utils.ts:170-177` | CONFIRMED | **Yes** — already adopted by ThawKit |
| 2 | Composite draft/published rows + soft delete | schema migration present; ThawKit already ported | CONFIRMED | Already present; publish sync **out of scope** (no public pipeline) |
| 3 | Server-side bulk ID resolution (`resolveAllAssets`) | `lib/page-fetcher.ts:4182` | CONFIRMED | Principle only; ThawKit's equivalent is bootstrap + batched `getAsset` |
| 4 | Lazy library + client ID cache, in-flight de-dup | `stores/useAssetsStore.ts`, `lib/canvas-asset-sync.ts` (`inFlight`) | CONFIRMED | Already ported |
| 5 | Upload: server validates, stores, inserts draft row | `lib/file-upload.ts` | CONFIRMED | Adapt to UploadThing (direct-to-CDN + callback) |
| 6 | MIME validated from client-supplied `File.type` | `file-upload.ts:98,136`; `files/upload/route.ts:30` (no magic-byte check) | CONFIRMED (weakness) | **Do not copy** — verify bytes server-side |
| 7 | SVG cleaned by regex | `file-upload.ts:51-90` — regex strips `<script>`, quoted `on*=`; leaves `javascript:` hrefs, `<foreignObject>`, `<use>` external refs, `<animate>`, unquoted handlers | CONFIRMED (weakness) | **Do not copy** — DOM-parse + allow-list |
| 8 | Inline SVG stored in `content` for icons | `file-upload.ts:186-221` | CONFIRMED | Keep `content` (sanitized) **and** a stored file for `<img>` use |
| 9 | Delete = cleanup references, then soft-delete; physical file removed only if never published; **storage errors swallowed** | `assets/[id]/route.ts:130-160`; `assetRepository.ts:437-481` ("Continue with soft-delete even if storage deletion fails") | CONFIRMED (weakness) | **Do not copy** — surface storage failure, block when referenced |
| 10 | Reference inventory (layers, links, rich text, components, CMS, SEO) | `lib/asset-usage-utils.ts:35-164` | CONFIRMED | Principle; ThawKit uses a broader text-match over the same stores |
| 11 | Authorization on asset routes | `assets/[id]/route.ts`, `files/upload/route.ts` contain **no** session/membership check | CONFIRMED (report was right to flag it) | **Do not copy** — ThawKit derives tenant from `requireCampaignScope` |
| 12 | Direct presign/register has an orphan window | report §5.5/§15 | PARTIAL (not re-traced) | Solved differently: UploadThing callback + compensating delete |
| 13 | `/a/<id>` proxy, `sharp` resize, SVG CSP | `app/a/[hash]/[...name]/route.ts` exists | CONFIRMED (file present; transforms not re-traced) | **Deferred** — flag-gated off in ThawKit already |
| 14 | Publish sync via `content_hash` | `publish/route.ts:555-558`, `assetRepository.ts:712,885` | CONFIRMED (call sites) | **Deferred** — ThawKit publish = JSON snapshot |
| 15 | Tests | only unrelated `*.test.*` + `inline-svg-asset.test.ts`, `asset-link.test.ts` | CONFIRMED | ThawKit adds its own |

Limitations: Supabase RLS/runtime behaviour, sharp transform output, and static export were **not** executed — they are document-derived for those points. The fixes ThawKit makes for items 6, 7, 9, 11 are *improvements over* the benchmark, justified by the source evidence above.

## 5. ThawKit Gap Analysis

| Capability | ThawKit evidence | Verified Ycode pattern | Gap / status | Pri | Change | Validation |
|---|---|---|---|---|---|---|
| Asset schema | `assets-schema.ts:120` | same | **CONFIRMED present**; lacks idempotency key for upload callbacks | P1 | partial unique index on `storage_path` (draft rows) | migration + test |
| UploadThing dependency/config | not in `package.json`; `env.ts:31-33` requires 3 vars | n/a | **MISSING** (v7 needs only `UPLOADTHING_TOKEN`) | P0 | install `uploadthing@7.7.4`, `@uploadthing/react@7.3.3`; relax legacy vars | `npm ci`, tsc |
| Upload route + auth | none | unauthenticated routes | **MISSING** | P0 | `app/api/uploadthing/{core,route}.ts`, middleware → `requireCampaignScope` + folder check | unit tests (mocked) |
| File validation | none | trusts `File.type` | **MISSING** | P0 | policy allow-list + byte sniff (`image-size`) + size cap | tests |
| SVG handling | canvas `dangerouslySetInnerHTML` of raw `content` (`LayerRenderer.tsx:3582`) | regex clean | **IMPLEMENTED BUT UNSAFE** | P0 | allow-list sanitizer (upload + render) | adversarial test corpus |
| Metadata persistence + partial failure | none | none (orphan window) | **MISSING** | P0 | idempotent insert; delete object on failure; log orphan key if cleanup fails | tests |
| Library UI | none (`FileManagerDialog` absent) | `FileManagerDialog` | **MISSING** | P0 | new dialog; reuse shadcn `Dialog`, `Button`, `Input`, `Skeleton` | typecheck, manual |
| Picker contract / store | `openFileManager` undefined → all controls broken | same contract | **MISSING** | P0 | add to `useEditorStore` + mount dialog | tsc error count ↓ |
| Cache after upload/delete | `addAsset`/`removeAsset` exist | same | **PARTIAL** (never called) | P0 | call from dialog | tests on store |
| Image / SVG / icon / bg assignment | controls already write `AssetVariable` via `onLayerUpdate` | same | **PARTIAL** (blocked only by picker) | P0 | none beyond picker | tests on helper contract |
| Video links | YouTube only, raw ID, no validation, upload option shown | n/a | **IMPLEMENTED BUT INCOMPLETE** | P1 | `video-embed.ts`, Loom, URL paste parsing, drop "upload" option | tests |
| Reload / hydration | IDs persisted, bootstrap collects + resolves | same | **CONFIRMED working** | — | none | covered by existing `collect-asset-ids` + new tests |
| Canvas render | ID → URL via store | same | **CONFIRMED**; missing-asset → empty/placeholder | P2 | keep; icon fallback to default | tests |
| Preview/public render | **absent in repo** | `/a`, `PageRenderer` | **N/A / UNRESOLVED** | — | documented deferral | — |
| Replace / remove on element | controls set new ID / empty variable | same | **CONFIRMED** in controls | — | none | contract test |
| Delete (DB + storage) | none | soft-delete; storage error swallowed; no auth | **MISSING / UNSAFE benchmark** | P0 | `deleteAssetAction` lifecycle | tests |
| Reference integrity | collector exists (`collect-asset-ids.ts`) | `asset-usage-utils.ts` | **PARTIAL** (read-only, bootstrap only) | P0 | `findAssetUsages` (SQL text-match, org-scoped) | tests |
| Tests | 3 small suites, no asset tests | few | **MISSING** | P1 | `tests/assets/*` | `vitest run` |

## 6. Target Architecture

```
Browser                                   Next.js server                         UploadThing
───────                                   ──────────────                         ───────────
FileManagerDialog ──useUploadThing──▶ POST /api/uploadthing (createRouteHandler)
  (search/paginate/upload/select/delete)    └ middleware: requireCampaignScope(campaignId)
        │                                       + folder ∈ org  → metadata{org,user,folder}
        │  files go DIRECT to UploadThing ───────────────────────────────────────▶ stored
        │                                   ◀── signed callback ── onUploadComplete({metadata,file})
        │                                       └ processUploadedFile():
        │                                         host-allowlist → fetch bytes (size cap)
        │                                         sniff type + dims; SVG→sanitize (replace file if altered)
        │                                         idempotent INSERT assets row (draft)
        │                                         on ANY failure → utapi.deleteFiles(key) (+orphan log)
        ◀── serverData: Asset ─────────────────┘
  useAssetsStore.addAsset(asset) → appears immediately
  onAssetSelect(asset) → control writes {type:"asset",data:{asset_id}} via onLayerUpdate
  → usePagesStore (2 s autosave) → savePageLayersAction → pages.layers (jsonb, IDs only)
Reload: bootstrap collects IDs → loadAssetsByIds (org-scoped) → store → getImageUrlFromVariable
Delete: deleteAssetAction(campaignId, assetId)
        scope → row (org-scoped) → findAssetUsages → [in use ⇒ refuse w/ usage list]
        → utapi.deleteFiles(key) (fail ⇒ error, DB untouched) → soft-delete row → store.removeAsset
```

**Identity model (explicit):**

| Value | Meaning | Where |
|---|---|---|
| Asset ID (`assets.id`, uuid) | stable logical identity | persisted in page/component/CMS JSON |
| Storage key (`assets.storage_path`) | UploadThing file key; the *only* thing ever sent to `deleteFiles`, always read from an authorized row | DB only; never in page JSON |
| Public URL (`assets.public_url`) | `file.ufsUrl` (`https://<app>.ufs.sh/f/<key>`) | DB; resolved at render. (Background control additionally caches `url(...)` in `design.backgrounds.bgImageVars` — existing behaviour; included in usage scan) |
| Inline markup (`assets.content`) | sanitized SVG for icon recolouring | DB only |
| Built-in/bundled icons | `StaticTextVariable` (trusted, internal) | unchanged, never an `Asset` row |
| External video | `VideoVariable{provider,video_id}` | in layer JSON only; **no `assets` row** |

Reuse / extend / create / remove:
* **Reuse**: schema, read actions, bootstrap, store, controls, `ActionResult`/`toErrorResult`, `requireCampaignScope`, shadcn primitives, `getImageUrlFromVariable`.
* **Extend**: `useEditorStore` (+picker state), `useAssetsStore` (+`deleteAsset`), `LayerRenderer` (safe icon, provider video), `VideoSettings`, `types/funnel.ts` (provider union), `env.ts`.
* **Create**: router, sanitizer, policy, upload processing, usage scan, delete lifecycle, dialog, video-embed, tests, migration.
* **Remove**: nothing is deleted. The dead `/ycode/api/asset-folders` folder calls are left untouched (folder CRUD is out of scope; noted in §12).

## 7. Database and UploadThing Integration

**Migration** (`drizzle-kit generate`, folder convention `src/drizzle/migrations/<ts>_<name>/`): one change —
`CREATE UNIQUE INDEX assets_storage_path_draft_unique_idx ON assets (storage_path) WHERE storage_path IS NOT NULL AND is_published = false;`
Purpose: UploadThing may retry the completion callback; the insert is `ON CONFLICT DO NOTHING` + re-select, making processing idempotent. No columns added: `storage_path`=file key, `public_url`=`ufsUrl`, `content_hash`=SHA-256 of verified bytes, `content`=sanitized SVG, `source`=`"library"`.
Not run against any database in this task (no DB available) — see §11.

**Router** (`uploadthing@7.7.4`, APIs verified from installed typings: `createUploadthing`/`createRouteHandler` from `uploadthing/next`; `UploadThingError`, `UTApi` from `uploadthing/server`; `file.ufsUrl`, `file.key`, `file.fileHash`; `UTApi.deleteFiles(keys) → {success, deletedCount}`; `UTApi.uploadFiles(File)`):
* Route config lists **explicit MIME keys** (`image/jpeg|png|webp|gif|avif|svg+xml`), `maxFileCount: 10`, per-type size limits (raster 8 MB, SVG 512 KB). `image`/`video`/`blob` wildcards are *not* used, so video/audio/PDF are rejected by UploadThing before bytes are stored.
* `.input(zod {campaignId, folderId?})` → middleware runs `requireCampaignScope` (auth *first*), verifies `folderId` is a live draft folder of that org, re-checks `files` against the policy, returns `{organizationId, userId, folderId}`. Metadata returns via the signed callback, so the browser cannot forge it.
* `onUploadComplete` → `processUploadedFile`; returns the `Asset` (JSON) to the client (`awaitServerData` default true).

**Environment**: `UPLOADTHING_TOKEN` (required, server only). `UPLOADTHING_SECRET`/`UPLOADTHING_APP_ID` are v6-era; v7 reads only the token, so `env.ts` makes them optional. Nothing is `NEXT_PUBLIC_`.
**Dependency note**: `uploadthing@7.7.4` pins `effect@3.17.7`, which collides with drizzle-orm's *optional* `effect>=4` peer under npm's resolver. Resolution: explicit `effect@3.17.7` dependency + `overrides.drizzle-orm.effect = "$effect"`. Verified: lockfile change is additive-only and plain `npm ci` succeeds. (`--legacy-peer-deps` was tried and rejected: it dropped 22 auto-installed peers and still broke `npm ci`.)

## 8. Editor and Rendering Data Flow

* `useEditorStore.openFileManager(onSelect, currentAssetId?, categoryFilter?)` stores a request `{onSelect, assetId, category}`; `closeFileManager()` clears it. `FileManagerDialog` (mounted once in `builderMain.tsx`) renders from that state. Return value `false` from `onSelect` keeps the dialog open (existing contract used by callers to reject wrong types); anything else closes it.
* Category filtering is client-side over the library page and mirrors existing `matchesCategoryFilter`. Requests for `videos`/`audio`/`documents` show an explicit "not supported" state — scope excludes those uploads.
* **Assignment** stays in each control (`createAssetVariable(asset.id)` → `onLayerUpdate(layer.id, {variables:{...layer.variables, …}})`), so undo/redo and nested-property merging continue to use the existing history path. No control other than `VideoSettings` is modified.
* **Replace**: select a different asset → ID overwritten; old asset stays in library. **Remove**: existing controls reset to empty `createAssetVariable("")`/`none`.
* **SVG/icon rendering**: `IconSettings` assets render via `assets.content`. Every non-trusted branch in `LayerRenderer` (asset content, dynamic text, CMS field fallback) passes through `sanitizeSvgForInline()` (same sanitizer, runs in the browser, idempotent); rejected/empty → bundled default icon. `StaticTextVariable` (bundled/template icons) is unchanged.
* **Image rendering**: `<img src=public_url>` (SVG in `<img>` is script-inert). Missing/deleted → `getAsset` returns null → existing placeholder behaviour; no exception.
* **Video**: `buildVideoEmbedUrl(variable, opts)` returns a URL only for allow-listed origins (`www.youtube.com`, `www.youtube-nocookie.com`, `www.loom.com`) with provider-regex-validated IDs; otherwise the canvas renders the normal empty-video placeholder instead of an iframe.

## 9. Implementation Plan and Dependencies

1. Deps + env + migration (no dependencies).
2. `lib/assets/upload-policy.ts`, `svg-sanitizer.ts` (pure; foundation for 3, 5, 6).
3. `uploadthing-server.ts`, `process-upload.ts`, `api/uploadthing/{core,route}.ts` (needs 1, 2).
4. `asset-usage.ts`, `delete-asset.ts`, `asset-actions.ts` (needs 1).
5. `useEditorStore` picker state, `useAssetsStore.deleteAsset`, `FileManagerDialog`, mount + header button (needs 3, 4).
6. Renderer hardening + `video-embed.ts` + `VideoSettings` (needs 2).
7. Tests, tsc diff vs baseline, lint, patch + `git apply --check`.

## 10. Security and Failure Handling

* **AuthN/Z**: upload middleware and delete action both call `requireCampaignScope` first (session → org edit permission). Tenant is derived from the campaign, never from the client. `storage key` for deletion is read from the org-scoped row.
* **Cross-tenant**: all queries carry `organizationId`; foreign asset/folder IDs match nothing → `NotFoundError` (indistinguishable from missing).
* **Content verification**: MIME declared by the client is *advisory*. Server fetches the stored object (host must end in `.ufs.sh`/`utfs.io`, hard byte cap), sniffs real type with `image-size`, requires it to agree with the allow-list, extracts dimensions. Non-SVG files claiming `image/svg+xml` (or vice-versa) are rejected and deleted.
* **SVG**: parse with `htmlparser2` (XML mode) → allow-list of elements/attributes; reject (not repair) `script`, `foreignObject`, `style`, animation elements, `iframe/object/embed`, DOCTYPE/entities, event handlers, non-fragment `href`/`xlink:href`, `url()` to anything but `#id`, `javascript:`/`data:` schemes; `style` attribute limited to a property allow-list. Output is re-parsed and must equal itself (idempotence check). If sanitising altered the bytes, the sanitized file is uploaded to UploadThing and the original deleted, so the hosted object never contains active content. **No claim of complete protection**: this is allow-list + defence-in-depth (sanitised at write, re-sanitised at render, `<img>` used wherever recolouring isn't needed). SVGs relying on `<style>` blocks are rejected with an actionable message rather than silently mis-rendered.
* **Partial failures**: storage ok + DB fail → `deleteFiles(key)`; if *that* fails, log `asset.orphan` with the key (reconciliation job deferred). Delete: storage failure ⇒ error returned, DB untouched, retry safe; DB failure after storage removal ⇒ error returned, retry re-runs idempotent storage delete (UploadThing returning `deletedCount: 0` for an already-removed key is **assumed**, not live-verified).
* **Deletion policy (decision)**: *block, don't rewrite.* Server-side rewriting of `pages.layers` is unsafe here because the open editor holds the authoritative working copy (`pagesByPageId`) and autosaves whole trees last-write-wins; the next autosave would silently resurrect the dangling reference. Therefore `deleteAssetAction` returns `IN_USE` with a usage list (kind + page/component name) and the user removes the references first. Scan covers `pages.layers/settings`, `component.{layers,variants,variables}`, `layer_style.design`, `collection_item_values.value`, and **current** `funnel_version.compiledSchema` (so a live published funnel is never broken). Older versions are not scanned (they'd make assets undeletable forever). Detection is a UUID text match on the jsonb text — a superset of every structured shape, and it also catches rich-text HTML and the cached `bgImageVars` URL path.
* **Known residual risks**: TOCTOU between usage scan and a concurrent autosave (renderer degrades gracefully to placeholder); unsaved edits < 2 s old are invisible to the scan.

## 11. Test and Validation Strategy

Vitest (repo convention, `tests/**/*.test.ts`, node env; run with `npx vitest run --config tests/vitest.config.ts`; vitest is installed ad hoc — `--no-save` — because the repo does not declare it).
* `upload-policy`: accepted/rejected MIME & sizes, video/audio/pdf rejected.
* `svg-sanitizer`: allowed icon passes unchanged-in-meaning; corpus of ~20 attack vectors (script, onload quoted/unquoted, `javascript:` href, `xlink:href`, `<use href=http…>`, `foreignObject`, `<style>@import`, `<animate attributeName=href>`, entities/DOCTYPE, mixed-case/whitespace obfuscation, nested svg, CSS `url(javascript:)`); idempotence; dimension extraction.
* `process-upload` (dependencies injected): success; wrong magic bytes; oversize; foreign host; DB failure → storage cleanup called; cleanup failure → orphan logged; duplicate callback idempotent; SVG replace path.
* `delete-asset` (injected): authorized delete; not found / cross-tenant; in-use refused; storage failure leaves DB untouched; DB failure after storage retry-safe; inline SVG without key.
* `video-embed`: YouTube (watch/short/embed/youtu.be/bare id), Loom (share/embed), rejects other hosts, `javascript:`, bad IDs; embed URL origin allow-list.
* `asset-store`: add/remove/cache consistency; `openFileManager` contract (`false` keeps open).
* Static checks: `tsc` (compare to baseline), `eslint` on touched files. `next build` attempted but expected to be blocked by *pre-existing* type errors — reported as such.
* **Not verifiable here**: live UploadThing round trip (no credentials), DB migration execution (no Postgres), browser UI interaction (no browser), live `deleteFiles` semantics for missing keys.

Acceptance criteria map 1:1 to the 12 objective items; each is marked verified / partially verified / unverified in the final report.

## 12. Deferred Scope and Unresolved Questions

* Folder create/rename/move/delete UI and server actions (library lists folders and can upload into one, no CRUD). Dead `/ycode/api/asset-folders` calls remain.
* Public/preview renderer, `/a/` proxy, image resizing/`srcset`, publish-time asset sync: no such pipeline exists in this repo. Published snapshots hold IDs only; a published renderer must resolve IDs the same way (using `loadAssetsByIds`) — noted as the required follow-up.
* Orphan reconciliation job for failed compensating deletes (keys are logged).
* Audio/video/document uploads, fonts: explicitly excluded.
* Replacement of file bytes in place (not in Ycode either).
* Vimeo and other providers: table-driven; one entry each.
* Open question: should the Background control keep caching `url(...)` in `bgImageVars`, or resolve from the ID at render like images? Left unchanged; flagged because it's the only place a URL (not just an ID) is persisted.

---

## 13. Implementation Status & Validation Results (appended after implementation)

Base: `fedc6cde9914bf0ec7d87c60c312a3589a58caff` (verified up to date with `origin/main` immediately before the patch was cut). Nothing was committed or pushed.

### 13.1 What was built (and where)

| Concern | Files |
|---|---|
| Migration + schema | `src/drizzle/schemas/assets-schema.ts` (+ partial unique index), `src/drizzle/migrations/20261021193700_asset_storage_key_unique/` |
| Upload policy (single source of truth) | `src/lib/assets/upload-policy.ts` |
| Byte-level verification | `src/lib/assets/inspect-image.ts` (`image-size` magic-byte sniff, dimension cap, SVG via sanitizer) |
| SVG sanitizer (upload **and** render) | `src/lib/assets/svg-sanitizer.ts` (`htmlparser2` XML parse → allow-list → rebuilt string, fixed-point + tripwire) |
| Upload pipeline | `src/app/api/uploadthing/{core,route}.ts`, `src/lib/assets/{process-upload,process-upload-deps,uploadthing-server,asset-repository}.ts` |
| Delete lifecycle | `src/lib/assets/{delete-asset,delete-asset-deps,asset-usage}.ts`, `src/actions/editor/asset-actions.ts` |
| Editor client | `src/lib/assets/uploadthing-client.ts`, `src/lib/editor/editor-asset-write-api.ts`, `useEditorStore` (picker state), `useAssetsStore.deleteAsset`, `FileManagerDialog.tsx`, mounted in `EditorLayoutClient.tsx`, wired to the header's existing "File manager" item |
| Rendering hardening | `LayerRenderer.tsx` (icon sanitize; provider-aware, origin-allow-listed video iframe), `IconSettings.tsx` (preview sanitize) |
| External video | `src/lib/video-embed.ts`, `VideoSettings.tsx` (YouTube/Loom, paste-a-URL, no video-file upload), `types/funnel.ts` |
| Config | `src/lib/env.ts` (legacy UploadThing vars optional), `package.json`/lockfile |
| Tests | `tests/assets/*`, `tests/stubs/server-only.ts`, `tests/vitest.config.ts` (alias) |

### 13.2 Deviations from the plan above (and why)

1. **SVG vs. image category.** ThawKit's existing contract (inherited from Ycode) classifies SVG as category `icons`; the `images` filter is raster-only. The picker honours that, so an uploaded SVG is selectable from the **Icon** control (and any `icons`/`all` request), not from the raster Image control. Not changed (out of scope), but worth knowing.
2. **Deleting is "block", not "clean up"** — as planned — but note the effect: to delete an asset the user must first remove it where used. The refusal lists the pages/components/CMS items/published funnel that use it.
3. **No new DB columns** were needed (only the index). `storage_path` = UploadThing key, `public_url` = `ufsUrl`.
4. `uploadthing-server.ts` also exports `uploadReplacementObject` (used only when a dirty SVG is replaced by its sanitized form).
5. `VideoSettings` keeps the legacy "File manager" source entry **only** for a layer that already points at an asset; the default source for an empty video layer is now YouTube.

### 13.3 Environment & operations checklist

* **Required**: `UPLOADTHING_TOKEN` (server-only; from the UploadThing dashboard). `UPLOADTHING_SECRET` / `UPLOADTHING_APP_ID` are no longer required (v7 ignores them).
* **Run the migration** before deploying: `npx drizzle-kit migrate` (adds one unique index on `assets.storage_path` for draft rows; it would fail only if duplicate non-null `storage_path` values already existed; nothing in the application wrote that column before this change, but check with `SELECT storage_path, count(*) FROM assets WHERE storage_path IS NOT NULL AND is_published = false GROUP BY 1 HAVING count(*) > 1` on any database that was populated by hand).
* **Install**: `npm ci` (lockfile includes `uploadthing`, `@uploadthing/react`, `htmlparser2`, `image-size`, and `effect@3.17.7` with an `overrides` entry for drizzle-orm's optional `effect` peer — see §7).
* UploadThing must be able to call `POST /api/uploadthing` on your deployed URL (the proxy already lets `/api/*` through). For **local development**, check UploadThing's current docs on callback delivery / tunnels — **not verified here**.
* Orphan reconciliation: failed compensating deletes are logged as `asset.orphan` with the storage key. Alert on that message.

### 13.4 Validation actually performed

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **175 → 156** errors vs. clean worktree of the base. Compared per (file, error-code): **0 increases**, 19 fixed (all `openFileManager` / implicit-any fallout). Remaining 156 are pre-existing and untouched. |
| ESLint | All new files: **0 errors, 0 warnings**. Modified legacy files: not worse than base (caught and fixed one real stale-closure `useCallback` dependency bug in `VideoSettings`). |
| Vitest, no DB | **301 passed / 19 skipped** |
| Vitest with `TEST_DATABASE_URL` (real PostgreSQL 16, the project's **full migration chain applied**, incl. the new one) | **320 / 320 passed** (15 files) |
| `next build` | Turbopack **"✓ Compiled successfully"** (with Google Fonts stubbed — sandbox has no outbound access; layout restored afterwards). Build then stops at TypeScript on the 156 **pre-existing** errors, none in files touched by this work. A plain `next build` therefore fails on this repo regardless of this change. |
| Running Next dev server, HTTP-level | `GET /api/uploadthing` returns exactly the six allowed image MIME types and nothing else; unauthenticated upload → **403**; malformed input → **400**; no internal details in bodies. |

Test coverage by area: sanitizer (48, incl. ~30 attack vectors, fixed-point), upload policy (17), byte inspection (12), upload pipeline incl. every compensating-delete path (14), router middleware/auth/tenancy/error mapping (17), delete lifecycle (10), video parsing/embed allow-list (55), store/picker contract (9), reference round-trip (9), **real-DB SQL** (10: idempotent insert, tenant scoping, soft delete, reference scan over pages/components/layer styles/CMS/current published version, ignoring old versions and other tenants), **real-DB end-to-end delete action** through the real authorization guard (9: anonymous, non-member, banned, cross-tenant incl. ID smuggling via the caller's own campaign, in-use, storage failure + retry), and the **real dialog component in jsdom** (15: list, select→callback, double-click, `false` keeps open, icons filter, unsupported categories, empty/error/retry, upload appears without reload, client pre-validation, server rejection, delete success / in-use / failure).

### 13.5 NOT verified (needs credentials, a browser, or a deployed environment)

1. **A live UploadThing round trip**: presign → direct upload → signed callback → `onUploadComplete`, `UTApi.deleteFiles` / `uploadFiles` against the real service. All of it is exercised only with mocks/fakes (the SDK API shapes were verified against the installed typings). In particular, the assumption that `deleteFiles` on an already-removed key returns `success: true` (which makes delete retries safe) is **unverified**.
2. **Real browser behaviour**: drag-and-drop, visual layout, and actual canvas-iframe rendering of an uploaded SVG icon / Loom or YouTube embed. The renderer changes are type-checked and compile; the dialog's behaviour is tested in jsdom, not a browser.
3. **Autosave → reload through a live session** as one continuous run. Each link is verified separately (control write contract, JSON round-trip, bootstrap ID collection, ID→URL resolution, missing-asset behaviour), and the persistence/bootstrap code is pre-existing and unchanged.
4. **Public / preview rendering** — no such renderer exists in this repository (see §3). Published snapshots hold IDs only; whoever builds that renderer must resolve IDs the same way.
5. **Concurrency races** between the reference scan and an in-flight autosave (documented residual risk, §10).
6. UploadThing dev-mode callback delivery on `localhost` (see 13.3).

### 13.6 How to re-run the checks

```bash
npm ci
npm install --no-save vitest@3 jsdom@26 @testing-library/react@16 @testing-library/dom@10 @testing-library/user-event@14   # test tooling is not declared in package.json (pre-existing convention)
npx vitest run --config tests/vitest.config.ts                          # unit + jsdom (DB tests skip)
# with a scratch Postgres that has the project's migrations applied:
DATABASE_URL=postgres://… npx drizzle-kit migrate
TEST_DATABASE_URL=postgres://… npx vitest run --config tests/vitest.config.ts
```

### 13.7 Manual QA script (to close the gaps in 13.5)

1. Set `UPLOADTHING_TOKEN`, run migration, start the app, open a campaign editor.
2. Header menu → **File manager** → upload a PNG, an SVG icon, and try an MP4 (must be refused). New files appear instantly.
3. Select an image layer → Image control → choose the PNG → reload the page → image persists.
4. Select an icon layer → Icon control → choose the SVG → colour it via text colour → reload.
5. Try deleting the PNG while used → refused with the page name. Remove it from the layer, wait for autosave (~2 s), delete → success; confirm the file is gone from the UploadThing dashboard.
6. Video layer → paste a YouTube watch URL, then a Loom share URL → both normalize to an id and embed; paste an arbitrary URL → nothing embeds.
