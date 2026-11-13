// CMS URL contract: /edit/cms/{collectionId}?page&limit&search&edit=<id>|new
// Pure modules — no mocks.
import { describe, expect, it } from "vitest";
import {
  CMS_DEFAULT_PAGE_SIZE,
  buildCmsUrl,
  parseCmsUrlState,
} from "@/lib/editor/cms-url";
import { parseEditorRoute } from "@/lib/editor/editor-areas";

const C = "camp_1";
const COL = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const sp = (q: string) => new URLSearchParams(q);

describe("route classification for CMS deep links", () => {
  it("a collection URL is a CMS route carrying the collection id", () => {
    expect(parseEditorRoute(`/campaign/${C}/edit/cms/${COL}`)).toEqual({
      type: "cms",
      resourceId: COL,
    });
    expect(parseEditorRoute(`/campaign/${C}/edit/cms`)).toEqual({
      type: "cms",
      resourceId: null,
    });
  });
});

describe("parseCmsUrlState", () => {
  it("defaults when there is no query", () => {
    expect(parseCmsUrlState(COL, sp(""))).toEqual({
      collectionId: COL,
      itemId: null,
      isCreatingItem: false,
      page: 1,
      pageSize: CMS_DEFAULT_PAGE_SIZE,
      search: "",
    });
  });

  it("reads page, limit and search", () => {
    const s = parseCmsUrlState(COL, sp("page=3&limit=50&search=%20hello%20"));
    expect(s).toMatchObject({ page: 3, pageSize: 50, search: "hello" });
  });

  it("falls back to defaults for malformed / out-of-range values", () => {
    for (const q of ["page=0", "page=-2", "page=abc", "page=1.5", "page=99999999999"]) {
      expect(parseCmsUrlState(COL, sp(q)).page).toBe(1);
    }
    for (const q of ["limit=0", "limit=101", "limit=x", "limit=-5"]) {
      expect(parseCmsUrlState(COL, sp(q)).pageSize).toBe(CMS_DEFAULT_PAGE_SIZE);
    }
  });

  it("distinguishes editing an item from creating one", () => {
    expect(parseCmsUrlState(COL, sp(`edit=${ITEM}`))).toMatchObject({
      itemId: ITEM,
      isCreatingItem: false,
    });
    expect(parseCmsUrlState(COL, sp("new"))).toMatchObject({
      itemId: null,
      isCreatingItem: true,
    });
    // `?edit=new` is an accepted alias; `new` wins over a stale id.
    expect(parseCmsUrlState(COL, sp("edit=new"))).toMatchObject({
      itemId: null,
      isCreatingItem: true,
    });
    expect(parseCmsUrlState(COL, sp(`edit=${ITEM}&new`))).toMatchObject({
      itemId: null,
      isCreatingItem: true,
    });
  });

  it("never reports an open item without a collection", () => {
    expect(parseCmsUrlState(null, sp(`edit=${ITEM}`))).toMatchObject({
      collectionId: null,
      itemId: null,
      isCreatingItem: false,
    });
    expect(parseCmsUrlState(null, sp("new")).isCreatingItem).toBe(false);
  });

  it("caps the search length", () => {
    const long = "a".repeat(500);
    expect(parseCmsUrlState(COL, sp(`search=${long}`)).search).toHaveLength(200);
  });

  it("tolerates missing search params", () => {
    expect(parseCmsUrlState(COL, null).page).toBe(1);
    expect(parseCmsUrlState(COL, undefined).search).toBe("");
  });
});

describe("buildCmsUrl", () => {
  it("builds the bare area URL without a collection", () => {
    expect(buildCmsUrl(C, null)).toBe(`/campaign/${C}/edit/cms`);
  });

  it("omits default values", () => {
    expect(buildCmsUrl(C, COL)).toBe(`/campaign/${C}/edit/cms/${COL}`);
    expect(
      buildCmsUrl(C, COL, { page: 1, pageSize: CMS_DEFAULT_PAGE_SIZE, search: "  " }),
    ).toBe(`/campaign/${C}/edit/cms/${COL}`);
  });

  it("includes page, limit, search and item state", () => {
    expect(buildCmsUrl(C, COL, { page: 2, pageSize: 50, search: "x y" })).toBe(
      `/campaign/${C}/edit/cms/${COL}?page=2&limit=50&search=x+y`,
    );
    expect(buildCmsUrl(C, COL, { item: ITEM })).toBe(
      `/campaign/${C}/edit/cms/${COL}?edit=${ITEM}`,
    );
    expect(buildCmsUrl(C, COL, { item: "new" })).toBe(
      `/campaign/${C}/edit/cms/${COL}?new`,
    );
    expect(buildCmsUrl(C, COL, { page: 3, item: "new" })).toBe(
      `/campaign/${C}/edit/cms/${COL}?page=3&new`,
    );
  });

  it("round-trips through parseCmsUrlState", () => {
    const url = buildCmsUrl(C, COL, { page: 4, pageSize: 10, search: "a&b=c", item: ITEM });
    const [path, query] = url.split("?");
    const collectionId = parseEditorRoute(path).resourceId;
    expect(collectionId).toBe(COL);
    expect(parseCmsUrlState(collectionId, sp(query))).toEqual({
      collectionId: COL,
      itemId: ITEM,
      isCreatingItem: false,
      page: 4,
      pageSize: 10,
      search: "a&b=c",
    });
  });
});
