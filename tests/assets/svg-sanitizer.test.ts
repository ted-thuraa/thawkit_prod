import { describe, expect, it } from "vitest";
import {
  sanitizeSvg,
  sanitizeSvgForInline,
} from "@/lib/assets/svg-sanitizer";

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><circle cx="12" cy="12" r="3"/></svg>';

const wrap = (inner: string, attrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attrs}>${inner}</svg>`;

describe("sanitizeSvg — accepts legitimate icons", () => {
  it("keeps a typical stroke icon and reports its size", () => {
    const r = sanitizeSvg(ICON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.width).toBe(24);
    expect(r.height).toBe(24);
    expect(r.viewBox).toBe("0 0 24 24");
    expect(r.modified).toBe(false);
    expect(r.svg).toContain('stroke="currentColor"');
    expect(r.svg).toContain('<path d="M5 12h14"/>');
  });

  it("derives size from viewBox when width/height are absent", () => {
    const r = sanitizeSvg(wrap('<rect width="4" height="4"/>').replace("0 0 10 10", "0 0 48 32"));
    expect(r.ok && [r.width, r.height]).toEqual([48, 32]);
  });

  it("strips XML declaration, comments and a plain DOCTYPE", () => {
    const r = sanitizeSvg(
      `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><!-- hi -->${ICON}`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.svg.startsWith("<svg")).toBe(true);
      expect(r.svg).not.toContain("DOCTYPE");
      expect(r.svg).not.toContain("hi");
      expect(r.modified).toBe(true); // DOCTYPE was dropped
    }
  });

  it("allows same-document references and gradients", () => {
    const r = sanitizeSvg(
      wrap(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect fill="url(#g)" width="5" height="5"/><use href="#g"/>',
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.svg).toContain('fill="url(#g)"');
  });

  it("keeps harmless inline style declarations only", () => {
    const r = sanitizeSvg(wrap('<path style="fill:#333;stroke-width:2;position:fixed" d="M0 0"/>'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.svg).toContain('style="fill:#333;stroke-width:2"');
      expect(r.svg).not.toContain("position");
    }
  });

  it("drops editor metadata and unknown attributes but flags it", () => {
    const r = sanitizeSvg(
      wrap('<sodipodi:namedview id="x"/><path data-name="a" class="c" d="M0 0"/>'),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.svg).not.toContain("sodipodi");
      expect(r.svg).not.toContain("data-name");
      expect(r.modified).toBe(true);
    }
  });

  it("escapes text content", () => {
    const r = sanitizeSvg(wrap("<text>a &lt; b &amp; c</text>"));
    expect(r.ok && r.svg).toContain("<text>a &lt; b &amp; c</text>");
  });
});

const ATTACKS: Array<[string, string]> = [
  ["script element", wrap("<script>alert(1)</script>")],
  ["script in CDATA", wrap("<script><![CDATA[alert(1)]]></script>")],
  ["uppercase-obfuscated script", wrap("<SCRIPT>alert(1)</SCRIPT>")],
  ["quoted onload", wrap("", ' onload="alert(1)"')],
  ["single-quoted handler", wrap('<rect onclick=\'alert(1)\' width="1" height="1"/>')],
  ["unquoted handler", wrap("<rect onmouseover=alert(1) width=1 height=1 />")],
  ["handler with odd case", wrap('<rect OnClick="alert(1)"/>')],
  ["javascript: href on <a>", wrap('<a href="javascript:alert(1)"><rect/></a>')],
  ["javascript: xlink:href on <a>", wrap('<a xlink:href="javascript:alert(1)"><rect/></a>')],
  ["entity-encoded javascript: on use", wrap('<use href="&#106;avascript:alert(1)"/>')],
  ["whitespace-split javascript:", wrap('<use href="java\tscript:alert(1)"/>')],
  ["external <use>", wrap('<use href="https://evil.example/x.svg#a"/>')],
  ["external <use> via xlink", wrap('<use xlink:href="//evil.example/x.svg#a"/>')],
  ["data: <use>", wrap('<use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>')],
  ["foreignObject", wrap('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)></div></foreignObject>')],
  ["<style> block", wrap("<style>@import url(https://evil.example/x.css);</style>")],
  ["animate href", wrap('<a><animate attributeName="href" values="javascript:alert(1)"/></a>')],
  ["<set> href", wrap('<a><set attributeName="href" to="javascript:alert(1)"/></a>')],
  ["<image> external", wrap('<image href="https://evil.example/t.png"/>')],
  ["feImage external", wrap('<filter id="f"><feImage href="https://evil.example/t.png"/></filter>')],
  ["css url() external in attribute", wrap('<rect fill="url(https://evil.example/p)"/>')],
  ["css url() javascript in style", wrap('<rect style="fill:url(javascript:alert(1))"/>')],
  ["style expression()", wrap('<rect style="width:expression(alert(1))"/>')],
  ["internal DOCTYPE entity", '<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>'],
  ["billion-laughs style entity", '<!DOCTYPE svg [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg">&b;</svg>'],
  ["wrong namespace", '<svg xmlns="http://evil.example/ns"><rect/></svg>'],
  ["non-svg root", "<html><body><script>alert(1)</script></body></html>"],
  ["two roots", `${ICON}${ICON}`],
  ["text before root", `hello${ICON}`],
  ["embedded iframe", wrap('<iframe src="https://evil.example"/>')],
  ["not xml at all", "this is not an svg"],
  ["empty", ""],
  ["NUL byte", wrap("\u0000")],
];

describe("sanitizeSvg — rejects attack corpus", () => {
  it.each(ATTACKS)("%s", (_name, input) => {
    const r = sanitizeSvg(input);
    expect(r.ok).toBe(false);
  });

  it("rejects pathologically deep nesting", () => {
    const deep = "<g>".repeat(80) + "</g>".repeat(80);
    expect(sanitizeSvg(wrap(deep)).ok).toBe(false);
  });

  it("rejects excessive node counts", () => {
    expect(sanitizeSvg(wrap("<rect/>".repeat(7000))).ok).toBe(false);
  });

  it("rejects oversized input", () => {
    expect(sanitizeSvg(wrap("<!--" + "a".repeat(600 * 1024) + "-->")).ok).toBe(false);
  });
});

describe("sanitizeSvg — output properties", () => {
  it("is a fixed point (sanitizing output changes nothing)", () => {
    for (const input of [ICON, wrap('<path d="M0 0" class="x" style="fill:red"/>')]) {
      const first = sanitizeSvg(input);
      expect(first.ok).toBe(true);
      if (!first.ok) continue;
      const second = sanitizeSvg(first.svg);
      expect(second.ok && second.svg).toBe(first.svg);
      expect(second.ok && second.modified).toBe(false);
    }
  });

  it("never emits active content for any accepted input", () => {
    const tricky = wrap(
      '<text>&lt;script&gt;alert(1)&lt;/script&gt;</text><path d="M0 0" aria-label="&quot; onload=&quot;alert(1)"/>',
    );
    const r = sanitizeSvg(tricky);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.svg).not.toMatch(/<script/i);
      // the attribute value stays INSIDE its quotes
      expect(r.svg).toContain('aria-label="&quot; onload=&quot;alert(1)"');
    }
  });
});

describe("sanitizeSvgForInline", () => {
  it("returns sanitized markup", () => {
    expect(sanitizeSvgForInline(ICON)).toContain("<svg");
  });
  it("returns empty string for rejected / empty / nullish input", () => {
    expect(sanitizeSvgForInline(wrap("<script>1</script>"))).toBe("");
    expect(sanitizeSvgForInline("")).toBe("");
    expect(sanitizeSvgForInline(null)).toBe("");
    expect(sanitizeSvgForInline(undefined)).toBe("");
  });
  it("is stable across repeated calls (cache)", () => {
    expect(sanitizeSvgForInline(ICON)).toBe(sanitizeSvgForInline(ICON));
  });
});
