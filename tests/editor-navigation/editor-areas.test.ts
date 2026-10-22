// Regression tests for editor-area navigation (Design / CMS / Forms / Settings).
// Pure module — no mocks needed.
//
// Run:  npm i -D vitest && npx vitest run --config tests/vitest.config.ts

import { describe, expect, it } from "vitest";
import {
  EDITOR_AREAS,
  areaForRouteType,
  buildAreaUrl,
  buildEditorBaseUrl,
  isDesignUrlForCampaign,
  parseEditorRoute,
} from "@/lib/editor/editor-areas";

const C = "camp_1";
const area = (path: string) => areaForRouteType(parseEditorRoute(path).type);

describe("parseEditorRoute / areaForRouteType", () => {
  it("classifies Design routes, including page and component editors", () => {
    expect(parseEditorRoute(`/campaign/${C}/edit`)).toEqual({
      type: null,
      resourceId: null,
    });
    expect(parseEditorRoute(`/campaign/${C}/edit/pages/p1`)).toEqual({
      type: "page",
      resourceId: "p1",
    });
    expect(parseEditorRoute(`/campaign/${C}/edit/components/c1`)).toEqual({
      type: "component",
      resourceId: "c1",
    });
    for (const p of [
      `/campaign/${C}/edit`,
      `/campaign/${C}/edit/pages/p1`,
      `/campaign/${C}/edit/components/c1`,
    ]) {
      expect(area(p)).toBe("design");
    }
  });

  it("treats an over-nested or malformed Design path as Design (not an unknown area)", () => {
    expect(area(`/campaign/${C}/edit/pages/p1/extra`)).toBe("design");
    expect(area(`/campaign/${C}/edit/pages`)).toBe("design");
    expect(
      parseEditorRoute(`/campaign/${C}/edit/pages/p1/extra`).type,
    ).toBeNull();
  });

  it("classifies CMS, Forms and Settings, including nested routes", () => {
    expect(area(`/campaign/${C}/edit/cms`)).toBe("cms");
    expect(area(`/campaign/${C}/edit/cms/col_1`)).toBe("cms");
    expect(area(`/campaign/${C}/edit/forms`)).toBe("forms");
    expect(area(`/campaign/${C}/edit/forms/f1`)).toBe("forms");
    expect(area(`/campaign/${C}/edit/settings`)).toBe("settings");
    expect(area(`/campaign/${C}/edit/settings/general`)).toBe("settings");
    expect(area(`/campaign/${C}/edit/settings/a/b/c`)).toBe("settings");
    expect(parseEditorRoute(`/campaign/${C}/edit/forms/f1`).resourceId).toBe(
      "f1",
    );
    expect(parseEditorRoute(`/campaign/${C}/edit/forms`).resourceId).toBeNull();
  });

  it("matches whole segments only (no prefix / substring collisions)", () => {
    expect(parseEditorRoute(`/campaign/${C}/edit/formsX`).type).toBeNull();
    expect(parseEditorRoute(`/campaign/${C}/edit/cms-old`).type).toBeNull();
    expect(
      parseEditorRoute(`/campaign/${C}/edit/settingsfoo/x`).type,
    ).toBeNull();
    expect(
      parseEditorRoute(`/campaign/${C}/edit/pages-old/p1`).type,
    ).toBeNull();
  });

  it("ignores paths outside the campaign editor and tolerates query/trailing slash", () => {
    expect(parseEditorRoute("/workspace").type).toBeNull();
    expect(parseEditorRoute(`/campaign/${C}`).type).toBeNull();
    expect(parseEditorRoute(`/campaign/${C}/forms`).type).toBeNull();
    expect(parseEditorRoute(null).type).toBeNull();
    expect(parseEditorRoute(undefined).type).toBeNull();
    expect(area(`/campaign/${C}/edit/cms/?x=1`)).toBe("cms");
  });

  it("every area is reachable: each standalone area round-trips through buildAreaUrl", () => {
    expect(EDITOR_AREAS).toEqual(["design", "cms", "forms", "settings"]);
    for (const a of ["cms", "forms", "settings"] as const) {
      expect(area(buildAreaUrl(C, a))).toBe(a);
    }
  });
});

describe("URL builders", () => {
  it("preserve the campaign id", () => {
    expect(buildEditorBaseUrl("abc")).toBe("/campaign/abc/edit");
    expect(buildAreaUrl("abc", "cms")).toBe("/campaign/abc/edit/cms");
    expect(buildAreaUrl("abc", "forms")).toBe("/campaign/abc/edit/forms");
    expect(buildAreaUrl("abc", "settings")).toBe("/campaign/abc/edit/settings");
  });
});

describe("isDesignUrlForCampaign (remembered return URL)", () => {
  it("accepts a page/component URL of the same campaign, with query", () => {
    expect(
      isDesignUrlForCampaign(
        `/campaign/${C}/edit/pages/p1?view=mobile&layer=x`,
        C,
      ),
    ).toBe(true);
    expect(isDesignUrlForCampaign(`/campaign/${C}/edit/components/c1`, C)).toBe(
      true,
    );
  });

  it("rejects other campaigns, non-design routes, and empty values", () => {
    expect(isDesignUrlForCampaign(`/campaign/other/edit/pages/p1`, C)).toBe(
      false,
    );
    expect(isDesignUrlForCampaign(`/campaign/${C}/edit/cms`, C)).toBe(false);
    expect(isDesignUrlForCampaign(`/campaign/${C}/edit`, C)).toBe(false);
    expect(isDesignUrlForCampaign(null, C)).toBe(false);
    expect(isDesignUrlForCampaign("", C)).toBe(false);
  });
});
