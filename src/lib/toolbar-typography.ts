/**
 * Toolbar typography helpers
 *
 * Pure helpers behind the font-size stepper and colour swatch of the floating
 * text-selection toolbar: parsing what the user types, stepping the size, and
 * converting browser-computed colours to the formats the colour picker uses.
 * No DOM or React in here so it can be reasoned about (and tested) in
 * isolation.
 */

export const FONT_SIZE_MIN = 1;
export const FONT_SIZE_MAX = 999;

/** Quick-pick sizes shown in the size dropdown. */
export const FONT_SIZE_PRESETS = [
  12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 120, 144,
] as const;

/** Browser default root font size; used to convert rem/em input to px. */
const ROOT_FONT_SIZE_PX = 16;

export const clampFontSize = (px: number): number =>
  Math.min(Math.max(px, FONT_SIZE_MIN), FONT_SIZE_MAX);

/** Round to at most two decimals so values like 14.5 survive but float noise
 * (14.499999) doesn't leak into class names. */
const tidy = (n: number): number => Math.round(n * 100) / 100;

/**
 * Parse what the user typed into the size field.
 *
 * Accepts a plain number (px), or a number with `px`, `rem` or `em` (the
 * latter two converted at the 16px root size). Returns `null` for anything
 * else, including zero/negative values, so callers can ignore invalid input.
 */
export function parseFontSizeInput(raw: string): number | null {
  const match = raw
    .trim()
    .toLowerCase()
    .match(/^(\d*\.?\d+)\s*(px|rem|em)?$/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const px =
    match[2] === "rem" || match[2] === "em" ? value * ROOT_FONT_SIZE_PX : value;
  return clampFontSize(tidy(px));
}

/**
 * Step a font size up or down by `step` px.
 *
 * Fractional sizes snap to the next whole number in the direction of travel
 * (14.5 → 15 going up, 14 going down), so a click always visibly moves the
 * value and you can't get stuck between integers.
 */
export function stepFontSize(
  current: number,
  direction: 1 | -1,
  step = 1,
): number {
  const base = direction === 1 ? Math.floor(current) : Math.ceil(current);
  return clampFontSize(base + direction * step);
}

/** Display form for the size field: whole numbers plain, otherwise 1 decimal. */
export function formatFontSize(px: number | null | undefined): string {
  if (px === null || px === undefined || !Number.isFinite(px)) return "";
  return Number.isInteger(px) ? String(px) : String(Math.round(px * 10) / 10);
}

/** Value stored in the layer design (`typography.fontSize`). */
export const fontSizeToDesignValue = (px: number): string => `${tidy(px)}px`;

/**
 * Convert a computed CSS colour (`rgb(...)` / `rgba(...)`, comma or
 * space-separated) to the colour picker's format: `#rrggbb`, with a
 * `/<opacity %>` suffix when not fully opaque. Returns `null` if unparseable.
 */
export function rgbToHexColor(css: string): string | null {
  const match = css
    .trim()
    .match(
      /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i,
    );
  if (!match) return null;

  const channels = [match[1], match[2], match[3]].map((c) =>
    Math.min(255, parseInt(c, 10)),
  );
  const hex = `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

  if (match[4] === undefined) return hex;
  let alpha = parseFloat(match[4]);
  if (match[5] === "%") alpha /= 100;
  if (!Number.isFinite(alpha) || alpha >= 1) return hex;
  return `${hex}/${Math.round(Math.max(alpha, 0) * 100)}`;
}
