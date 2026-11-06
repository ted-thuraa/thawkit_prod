import { describe, expect, it } from "vitest";
import { describeRemixExport, fetchRemixIcons } from "@/lib/assets/remix-icons";
import { sanitizeSvg } from "@/lib/assets/svg-sanitizer";

describe("describeRemixExport", () => {
  it.each([
    ["RiHome2Line", "home-2-line", "line"],
    ["RiArrowLeftSFill", "arrow-left-s-fill", "fill"],
    ["Ri24HoursFill", "24-hours-fill", "fill"],
    ["Ri4kLine", "4k-line", "line"],
    ["RiAB", "a-b", null],
    ["RiAiGenerate2", "ai-generate-2", null],
  ])("%s → %s (%s)", (exportName, name, style) => {
    expect(describeRemixExport(exportName)).toEqual({ name, style });
  });
});

describe("fetchRemixIcons (local Remix catalog from react-icons)", () => {
  it("returns the real library, paginated, with usable markup", async () => {
    const page = await fetchRemixIcons({ limit: 50, offset: 0 });
    expect(page.totalIcons).toBeGreaterThan(3000);
    expect(page.total).toBe(page.totalIcons);
    expect(page.icons).toHaveLength(50);
    expect(page.categories).toEqual([]); // honest: no category metadata
    const icon = page.icons[0];
    expect(icon).toMatchObject({ source: "remix" });
    expect(icon.svg.startsWith("<svg")).toBe(true);
  });

  it("paginates without overlap", async () => {
    const a = await fetchRemixIcons({ limit: 20, offset: 0 });
    const b = await fetchRemixIcons({ limit: 20, offset: 20 });
    const names = new Set([...a.icons, ...b.icons].map((i) => i.name));
    expect(names.size).toBe(40);
  });

  it("searches ignoring case, spaces and dashes", async () => {
    const r1 = await fetchRemixIcons({ search: "Home 2" });
    const r2 = await fetchRemixIcons({ search: "home-2" });
    expect(r1.total).toBeGreaterThan(0);
    expect(r1.total).toBe(r2.total);
    expect(r1.icons.every((i) => i.name.replace(/-/g, "").includes("home2"))).toBe(true);
  });

  it("filters by style", async () => {
    const fill = await fetchRemixIcons({ style: "fill", limit: 500 });
    const line = await fetchRemixIcons({ style: "line", limit: 500 });
    expect(fill.icons.every((i) => i.style === "fill")).toBe(true);
    expect(line.icons.every((i) => i.style === "line")).toBe(true);
    expect(fill.total + line.total).toBeLessThan(fill.totalIcons);
  });

  it("returns an empty, consistent result for no matches", async () => {
    const r = await fetchRemixIcons({ search: "zzzz-no-such-icon" });
    expect(r).toMatchObject({ icons: [], total: 0 });
  });

  it("clamps absurd limits/offsets", async () => {
    const r = await fetchRemixIcons({ limit: 99999, offset: -5 });
    expect(r.limit).toBe(500);
    expect(r.offset).toBe(0);
  });

  it("every generated icon passes the SVG sanitizer (so it can be stored as an asset)", async () => {
    const sample = [
      ...(await fetchRemixIcons({ search: "home", limit: 40 })).icons,
      ...(await fetchRemixIcons({ style: "fill", limit: 40, offset: 500 })).icons,
      ...(await fetchRemixIcons({ search: "ai", limit: 40 })).icons,
    ];
    expect(sample.length).toBeGreaterThan(80);
    for (const icon of sample) {
      const result = sanitizeSvg(icon.svg);
      expect(result.ok, icon.name).toBe(true);
      if (result.ok) {
        expect(result.width).toBe(24);
        expect(result.height).toBe(24);
        expect(result.svg).toContain('fill="currentColor"'); // recolourable by the icon control
      }
    }
  });
});
