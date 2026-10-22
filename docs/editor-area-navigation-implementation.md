# Editor-area navigation (Design / CMS / Forms / Settings)

**ThawKit base commit:** `d982d835f10083fe118166c33afb4527d974e3f0` (`origin/main`, 2026-10-22)
**Benchmark:** `ycode/ycode` @ `7de3724bd3e72c98577d14a74f26717ce624bf8a`
(public clone; the supplied `C:\Users\morga\...` path is not reachable from this environment).

Evidence labels: **CONFIRMED** (read in source), **PARTIAL**, **INFERRED**, **MISSING**, **UNRESOLVED**.

## 1. Verified Ycode behaviour

Source: `app/(builder)/ycode/components/HeaderBar.tsx`, `hooks/use-editor-url.ts`.

- **CONFIRMED** Ycode's HeaderBar has **no** `isChangeActiveNavOpen` popover. Areas are a row of
  `Button`s (`HeaderBar.tsx:~520-615`): Design, CMS, Forms. Settings is **not** a nav button; it is
  reached from the user dropdown (`router.push('/ycode/settings/general')`, `:447`).
- **CONFIRMED** Every area is a real route: `/ycode/layers|pages|components/*` (Design),
  `/ycode/collections[/id]` (CMS), `/ycode/forms`, `/ycode/settings[/x]`.
- **CONFIRMED** Active area is derived from the *route type* parsed from the pathname with anchored
  regexes (`use-editor-url.ts:77-84,187`): `collection|collections-base -> cms`, `forms -> forms`,
  `layers|page|component|null -> design` (`HeaderBar.tsx:147-153`).
- **CONFIRMED** An `optimisticNav` overlay is set on click and cleared once the URL catches up
  (`HeaderBar.tsx:117-134`).
- **CONFIRMED** Leaving Design stores `lastDesignUrl` (path + query) in `useEditorStore`; clicking
  Design restores it, else navigates to the current/home page (`:524-553`).
- **CONFIRMED** Context (project) is implicit in Ycode (single tenant). ThawKit carries
  `campaignId` explicitly.

## 2. ThawKit current architecture

- **CONFIRMED** Persistent client shell: `edit/layout.tsx` -> `EditorLayoutClient.tsx` ->
  `EditorHeader` + `CampaignEditorMain`. Route `page.tsx` files return `null`; the URL is the
  source of truth (`src/hooks/use-editor-url.ts`).
- **CONFIRMED** Only these route files exist under `edit/`: `page.tsx` and `pages/[pageId]/page.tsx`.
  **There are no CMS, Forms or Settings routes in ThawKit** (`components/[id]` is parsed by the
  hook but has no route file either).
- **CONFIRMED** `editorHeader.tsx` (`isChangeActiveNavOpen`, ~L138/L461) was a half-ported
  copy of the *page* switcher: its trigger showed `activeNavButton`, but the popover body listed
  **pages** (`switchablePages`), `aria-expanded` read the wrong state (`isChangePageOpen`), and it
  kept a duplicate `optimisticNav` state.
- **CONFIRMED** `use-editor-url.ts` had been partly edited toward Ycode's route set and no longer
  compiled: `formsMatch` undefined (`formMatch` declared), `"forms"` missing from `EditorRouteType`,
  settings matched `/edit/form/<id>` (copy of forms), and several returned objects lacked required
  `CampaignEditorUrlState` fields.
- **CONFIRMED** `builderMain` sets `currentPageId = null` whenever the URL is not a page route, and
  renders a blank `div` for every non-page type.

## 3. Gap matrix

| Capability | Ycode | ThawKit (before) | Gap | Correction |
|---|---|---|---|---|
| Open/close | Buttons, no popover (CONFIRMED) | Popover bound to `isChangeActiveNavOpen`, wrong `aria-expanded` (CONFIRMED) | Wrong state wired to ARIA | Bind to own state; Radix handles Esc/outside click |
| Active-area identification | Route type from pathname (CONFIRMED) | Same idea + duplicate `optimisticNav` (CONFIRMED) | Duplicate state can diverge | Single derivation `areaForRouteType(urlState.type)`; no stored copy |
| Destination mapping | Real routes (CONFIRMED) | Routes for CMS/Forms/Settings **MISSING** | Selecting would 404 | Canonical `buildAreaUrl` + route files |
| Context preservation | n/a (single tenant) | `campaignId` explicit | none | All URLs built from `campaignId` |
| Nested routes | One-level regexes (CONFIRMED) | Anchored regexes, mixed with WIP | Broken/uncompilable | Segment-based parser; any depth under an area classifies to that area |
| Navigation transition | `router.push` (CONFIRMED) | `router.push` via hook | none | `startTransition` + `router.push`; close popover on select |
| Return to Design | `lastDesignUrl` in store (CONFIRMED) | MISSING | Returning lost page/viewport/layer | Header-owned ref, validated against the campaign |
| Selected-area indication | `secondary` variant | n/a | none | Check mark + `aria-current` |
| TypeScript | n/a | 11 errors on this path | see section 4 | Fix at the source |

## 4. Baseline TypeScript (this path only)

Baseline `tsc --noEmit` at the base commit reports 185 errors repo-wide; 11 are on this path:
`editorHeader.tsx` (2, TS2367 `"forms"`/`"collection"` comparisons) and `use-editor-url.ts` (9:
TS2739/TS2740 missing state fields, TS2552 `formsMatch`, TS2322 `"forms"`). All trace to the
half-applied route-type change above.

## 5. Design

- `src/lib/editor/editor-areas.ts` (pure, no React/stores): `EditorArea`, `EditorRouteType`,
  `parseEditorRoute(pathname)`, `areaForRouteType`, `buildAreaUrl`.
- Route contract (new, because none existed): `/campaign/{campaignId}/edit/{cms|forms|settings}`.
  Parsing is segment-based (no substring/prefix checks).
- `use-editor-url.ts`: use `parseEditorRoute`; `CampaignEditorUrlState` built from one defaults
  object; add `navigateToArea`. Ycode-only pagination fields with no ThawKit consumer
  (`itemId`, `tab`, `page`, `pageSize`, `search`, `sidebarTab`) are removed.
- `editorHeader.tsx`: area popover lists the four areas; active area derived from the URL.
- `builderMain.tsx`: neutral placeholder for CMS/Forms/Settings (their features do not exist yet).
- New `page.tsx` (returns `null`) for `cms`, `forms`, `settings`, following the existing pattern.

## 6. Acceptance criteria

1. `tsc` reports none of the 11 path errors and no new errors anywhere.
2. `/edit`, `/edit/pages/x`, `/edit/components/x` and unknown paths -> Design; `/edit/cms[...]`,
   `/edit/forms[...]`, `/edit/settings[...]` -> their areas; `/edit/formsX` is not Forms.
3. Selecting an area pushes exactly one URL containing the current `campaignId`.
4. Active area has no stored copy and survives refresh (derived from the pathname).

## 7. Known limitations

- CMS/Forms/Settings render a placeholder; their real UIs are out of scope.
- Browser-level behaviour was not exercised (no running app/database in the sandbox).
- Leaving Design does not exit preview mode (the existing commented-out logic was left as is).
