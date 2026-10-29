// path: src/lib/assets/svg-sanitizer.ts

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Allow-list SVG sanitizer. Pure and isomorphic (no DOM, no Node APIs): the
 * same function runs on the server when an SVG is uploaded and in the
 * browser immediately before any markup is handed to `dangerouslySetInnerHTML`.
 *
 * WHY NOT REGEX (Ycode's `cleanSvgContent`): stripping `<script>` and quoted
 * `on*=` handlers with regular expressions leaves `javascript:` hrefs,
 * `<foreignObject>`, external `<use>`, `<animate attributeName="href">`,
 * unquoted handlers and entity tricks intact. This module instead PARSES the
 * document (htmlparser2, XML mode) and re-EMITS only what is on an allow-list,
 * building the output string itself so nothing from the input is echoed
 * verbatim.
 *
 * POLICY
 *   - Dangerous constructs (script, foreignObject, <style>, animation,
 *     <image>, <a>, DOCTYPE internal subset / entities, …) → the whole file is
 *     REJECTED. We never "repair" it into something that merely looks safe.
 *   - Merely unknown things (editor metadata, namespaced elements, unlisted
 *     attributes) → dropped, and `modified` is set so the caller can replace
 *     the stored file with the cleaned version.
 *   - Attribute values are checked after entity decoding; `url()` may only
 *     point at a same-document `#fragment`; `href` likewise.
 *   - Output is re-sanitized and must be a fixed point; a final tripwire scan
 *     rejects anything that still looks active.
 *
 * LIMITS OF THE GUARANTEE: this is an allow-list plus defence in depth, not a
 * proof. Callers also keep SVG inert wherever recolouring is not required
 * (`<img>` / data URLs never execute script), and re-sanitize at render time.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { parseDocument } from "htmlparser2";

export const SVG_MAX_INPUT_CHARS = 512 * 1024;
const MAX_DEPTH = 48;
const MAX_NODES = 6000;
const MAX_ATTR_VALUE = 4000;

export type SvgSanitizeResult =
  | {
      ok: true;
      svg: string;
      width: number | null;
      height: number | null;
      viewBox: string | null;
      /** True when something was dropped (beyond comments / XML declaration). */
      modified: boolean;
    }
  | { ok: false; reason: string };

// ─── Allow-lists ────────────────────────────────────────────────────────────

const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "symbol", "use", "path", "circle", "ellipse", "line",
  "polyline", "polygon", "rect", "text", "tspan", "title", "desc",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern",
  "marker",
  // Filter primitives that cannot fetch anything (no feImage / feTile href).
  "filter", "feGaussianBlur", "feOffset", "feColorMatrix", "feBlend",
  "feComposite", "feFlood", "feMerge", "feMergeNode", "feDropShadow",
]);

/** Present ⇒ reject the whole file (active content / external fetch / injection). */
const REJECTED_ELEMENTS = new Set([
  "script", "foreignObject", "style", "iframe", "object", "embed", "link",
  "meta", "html", "body", "head", "audio", "video", "canvas", "image", "a",
  "feImage", "animate", "animateMotion", "animateTransform", "animateColor",
  "set", "handler", "listener", "discard", "switch", "view", "cursor",
  "font-face-uri", "textPath", "tref",
]);

const REJECTED_ELEMENTS_LOWER = new Set(
  [...REJECTED_ELEMENTS].map((n) => n.toLowerCase()),
);

const TEXT_ELEMENTS = new Set(["text", "tspan", "title", "desc"]);
const HREF_ELEMENTS = new Set(["use", "linearGradient", "radialGradient", "pattern"]);

const ALLOWED_ATTRIBUTES = new Set([
  "id", "d", "points", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r",
  "rx", "ry", "fx", "fy", "width", "height", "viewBox", "preserveAspectRatio",
  "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
  "stroke-dashoffset", "stroke-opacity", "opacity", "clip-path", "clip-rule",
  "mask", "filter", "offset", "stop-color", "stop-opacity", "gradientUnits",
  "gradientTransform", "spreadMethod", "patternUnits", "patternTransform",
  "patternContentUnits", "clipPathUnits", "maskUnits", "maskContentUnits",
  "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient",
  "font-family", "font-size", "font-weight", "font-style", "text-anchor",
  "dominant-baseline", "dx", "dy", "letter-spacing", "display", "visibility",
  "color", "vector-effect", "shape-rendering", "mix-blend-mode", "version",
  "in", "in2", "result", "stdDeviation", "mode", "type", "values", "operator",
  "flood-color", "flood-opacity", "k1", "k2", "k3", "k4", "role",
  "aria-hidden", "aria-label", "aria-labelledby", "focusable",
]);

const ALLOWED_STYLE_PROPERTIES = new Set([
  "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity",
  "stop-color", "stop-opacity", "display", "visibility", "fill-rule",
  "clip-rule", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "color", "mix-blend-mode",
  "font-family", "font-size", "font-weight", "text-anchor", "letter-spacing",
  "flood-color", "flood-opacity",
]);

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const FRAGMENT_RE = /^#[A-Za-z0-9_.:-]{1,200}$/;

// ─── Value checks ───────────────────────────────────────────────────────────

/** Strips whitespace/control/zero-width characters used to split keywords. */
function squash(value: string): string {
  return value
    .replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]+/g, "")
    .toLowerCase();
}

const FORBIDDEN_SUBSTRINGS = [
  "javascript:", "vbscript:", "data:", "expression(", "@import", "behavior:",
  "-moz-binding", "<", "&#", "\\",
];

/** True when a (decoded) attribute value is safe to emit. */
export function isSafeAttributeValue(value: string): boolean {
  if (value.length > MAX_ATTR_VALUE) return false;
  const squashed = squash(value);
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (squashed.includes(needle)) return false;
  }
  // Any `url(` must be a same-document fragment reference.
  if (squashed.includes("url(")) {
    const all = value.match(/url\(/gi)?.length ?? 0;
    const ok = [...value.matchAll(/url\(\s*(['"]?)\s*(#[A-Za-z0-9_.:-]{1,200})\s*\1\s*\)/gi)]
      .length;
    if (all !== ok) return false;
  }
  return true;
}

function sanitizeStyleAttribute(value: string): string | null {
  const kept: string[] = [];
  for (const declaration of value.split(";")) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) return null;
    const property = trimmed.slice(0, colon).trim().toLowerCase();
    const propertyValue = trimmed.slice(colon + 1).trim();
    if (!ALLOWED_STYLE_PROPERTIES.has(property)) continue;
    if (!/^[#A-Za-z0-9 .,%()+\-_'"/]*$/.test(propertyValue)) return null;
    if (!isSafeAttributeValue(propertyValue)) return null;
    kept.push(`${property}:${propertyValue}`);
  }
  return kept.length > 0 ? kept.join(";") : null;
}

// ─── Serialization (we build the string; nothing is echoed verbatim) ────────

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Core ───────────────────────────────────────────────────────────────────

interface XNode {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: XNode[];
  data?: string;
}

class Reject extends Error {}

interface Walk {
  nodes: number;
  removed: number;
}

function emitElement(node: XNode, depth: number, walk: Walk, isRoot: boolean): string {
  if (++walk.nodes > MAX_NODES) throw new Reject("SVG is too complex.");
  if (depth > MAX_DEPTH) throw new Reject("SVG is nested too deeply.");

  const name = node.name ?? "";
  // Case-insensitive: `<SCRIPT>` is not an SVG script element, but nothing
  // that merely *looks* like one is worth accepting.
  if (REJECTED_ELEMENTS_LOWER.has(name.toLowerCase())) {
    throw new Reject(`<${name}> elements are not allowed in uploaded SVGs.`);
  }
  if (!ALLOWED_ELEMENTS.has(name)) {
    walk.removed++;
    return "";
  }
  if (isRoot && name !== "svg") throw new Reject("The root element must be <svg>.");

  const attrs: string[] = [];
  let sawXmlns = false;

  for (const [rawName, rawValue] of Object.entries(node.attribs ?? {})) {
    const value = rawValue ?? "";

    if (rawName === "xmlns") {
      if (value !== SVG_NS) throw new Reject("Unexpected XML namespace.");
      sawXmlns = true;
      continue; // re-emitted canonically on the root below
    }
    if (rawName === "xmlns:xlink") {
      if (value !== XLINK_NS) throw new Reject("Unexpected XML namespace.");
      continue; // not needed: we only emit plain `href`
    }
    if (/^on/i.test(rawName)) {
      throw new Reject("Event-handler attributes are not allowed.");
    }

    if (rawName === "href" || rawName === "xlink:href") {
      if (!HREF_ELEMENTS.has(name)) {
        throw new Reject("External references are not allowed in uploaded SVGs.");
      }
      const target = value.trim();
      if (!FRAGMENT_RE.test(target)) {
        throw new Reject("Only same-document (#id) references are allowed.");
      }
      attrs.push(`href="${escapeAttribute(target)}"`);
      continue;
    }

    if (rawName === "style") {
      if (!isSafeAttributeValue(value)) {
        throw new Reject('Unsafe value in "style" attribute.');
      }
      const cleaned = sanitizeStyleAttribute(value);
      if (cleaned === null) {
        if (value.trim()) walk.removed++;
        continue;
      }
      attrs.push(`style="${escapeAttribute(cleaned)}"`);
      continue;
    }

    if (rawName === "xml:space") {
      if (value === "preserve" || value === "default") {
        attrs.push(`xml:space="${value}"`);
      }
      continue;
    }

    if (!ALLOWED_ATTRIBUTES.has(rawName)) {
      walk.removed++;
      continue;
    }
    if (!isSafeAttributeValue(value)) {
      throw new Reject(`Unsafe value in "${rawName}" attribute.`);
    }
    attrs.push(`${rawName}="${escapeAttribute(value)}"`);
  }

  if (isRoot) {
    // Canonical namespace (required for the file to render as an <img>).
    void sawXmlns;
    attrs.unshift(`xmlns="${SVG_NS}"`);
  }

  let inner = "";
  for (const child of node.children ?? []) {
    if (child.type === "tag" || child.type === "script" || child.type === "style") {
      inner += emitElement(child, depth + 1, walk, false);
    } else if (child.type === "text" || child.type === "cdata") {
      const text = child.type === "cdata" ? collectText(child) : (child.data ?? "");
      if (TEXT_ELEMENTS.has(name)) {
        inner += escapeText(text);
      } else if (text.trim()) {
        walk.removed++; // stray text outside text elements
      }
    }
    // comments / directives / processing instructions are simply not emitted
  }

  const open = attrs.length > 0 ? `<${name} ${attrs.join(" ")}` : `<${name}`;
  return inner ? `${open}>${inner}</${name}>` : `${open}/>`;
}

function collectText(node: XNode): string {
  if (node.type === "text") return node.data ?? "";
  return (node.children ?? []).map(collectText).join("");
}

function parseLength(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(value);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function sanitizeOnce(input: string): SvgSanitizeResult {
  if (typeof input !== "string") return { ok: false, reason: "SVG content must be text." };
  if (input.length > SVG_MAX_INPUT_CHARS) return { ok: false, reason: "SVG is too large." };

  const source = input.replace(/^\ufeff/, "");
  if (source.includes("\u0000")) return { ok: false, reason: "SVG contains invalid characters." };
  // Entity declarations enable expansion attacks and hidden payloads.
  if (/<!ENTITY/i.test(source) || /<!DOCTYPE[^>]*\[/i.test(source)) {
    return { ok: false, reason: "DOCTYPE internal subsets and entities are not allowed." };
  }

  let removedDoctype = 0;
  if (/<!DOCTYPE/i.test(source)) removedDoctype = 1;

  let documentNodes: XNode[];
  try {
    const parsed = parseDocument(source, {
      xmlMode: true,
      decodeEntities: true,
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
      recognizeCDATA: true,
      recognizeSelfClosing: true,
    });
    documentNodes = parsed.children as unknown as XNode[];
  } catch {
    return { ok: false, reason: "SVG could not be parsed." };
  }

  const elements = documentNodes.filter(
    (n) => n.type === "tag" || n.type === "script" || n.type === "style",
  );
  const strayText = documentNodes.some(
    (n) => n.type === "text" && (n.data ?? "").trim() !== "",
  );
  if (elements.length !== 1 || strayText) {
    return { ok: false, reason: "File must contain exactly one <svg> element." };
  }
  const root = elements[0];
  if (root.name !== "svg") return { ok: false, reason: "The root element must be <svg>." };

  const walk: Walk = { nodes: 0, removed: removedDoctype };
  let svg: string;
  try {
    svg = emitElement(root, 0, walk, true);
  } catch (error) {
    if (error instanceof Reject) return { ok: false, reason: error.message };
    return { ok: false, reason: "SVG could not be processed." };
  }

  const attribs = root.attribs ?? {};
  const viewBox = attribs.viewBox && isSafeAttributeValue(attribs.viewBox)
    ? attribs.viewBox.trim()
    : null;
  let width = parseLength(attribs.width);
  let height = parseLength(attribs.height);
  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      width = width ?? Math.round(parts[2]);
      height = height ?? Math.round(parts[3]);
    }
  }

  return { ok: true, svg, width, height, viewBox, modified: walk.removed > 0 };
}

/**
 * Last-resort scan over the OUTPUT's *markup*. Only tag names are checked:
 * attribute values and text are escaped by `emitElement`, so substrings such
 * as `onload=` inside a quoted value are inert, and attribute NAMES are
 * guaranteed by the allow-list (re-verified by the fixed-point pass below).
 */
const TRIPWIRE =
  /<\s*\/?\s*(script|foreignObject|style|iframe|object|embed|image|animate|set|a)\b/i;

export function sanitizeSvg(input: string): SvgSanitizeResult {
  const first = sanitizeOnce(input);
  if (!first.ok) return first;

  if (TRIPWIRE.test(first.svg)) {
    return { ok: false, reason: "SVG failed the final safety check." };
  }
  // Fixed-point check: sanitizing our own output must change nothing.
  const second = sanitizeOnce(first.svg);
  if (!second.ok || second.svg !== first.svg || second.modified) {
    return { ok: false, reason: "SVG could not be normalized safely." };
  }
  return first;
}

// ─── Render-time helper ─────────────────────────────────────────────────────

const inlineCache = new Map<string, string>();
const INLINE_CACHE_MAX = 300;

/**
 * Sanitized markup for `dangerouslySetInnerHTML`, or "" when the input is
 * empty/rejected (callers then fall back to the bundled default icon).
 * Memoized: the canvas calls this on every render of an icon layer.
 */
export function sanitizeSvgForInline(input: string | null | undefined): string {
  if (!input || !input.trim()) return "";
  const cached = inlineCache.get(input);
  if (cached !== undefined) return cached;

  const result = sanitizeSvg(input);
  const out = result.ok ? result.svg : "";
  if (inlineCache.size >= INLINE_CACHE_MAX) {
    const oldest = inlineCache.keys().next().value;
    if (oldest !== undefined) inlineCache.delete(oldest);
  }
  inlineCache.set(input, out);
  return out;
}
