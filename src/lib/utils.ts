import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Processes inline styles to ensure they have higher specificity
 * by adding !important to each style property
 *
 * @param styles - The original style object
 * @returns - A new style object with !important added to each property
 */
export function prioritizeStyles(
  styles?: React.CSSProperties,
): React.CSSProperties {
  if (!styles) return {};

  return styles;
}

/**
 * Creates a class string that follows the theme hierarchy
 * - Base theme classes come first
 * - Custom classes are added after to override theme classes
 *
 * @param baseThemeClass - Base theme class to apply
 * @param customClasses - Custom classes that should override theme classes
 * @returns - A string of classes in the correct hierarchy
 */
export function hierarchicalClasses(
  baseThemeClass: string,
  customClasses?: string,
): string {
  return cn(
    // Base theme classes
    baseThemeClass,
    // Text content class is used in theme.ts for text styling
    // Custom classes override theme classes
    customClasses,
  );
}

/**
 * Escapes HTML special characters in user-controlled strings before they're
 * interpolated into email templates, preventing HTML/markup injection into
 * transactional emails (e.g. via a user's display name).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getRelativeTime(date: Date | string): string {
  const now = new Date();
  const past = new Date(date);
  const diffInSeconds = Math.floor((now.getTime() - past.getTime()) / 1000);

  // Convert to different time units
  const seconds = diffInSeconds;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30.44); // Average month length
  const years = Math.floor(days / 365.25); // Account for leap years

  // Return the most appropriate time format
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"} ago`;
  } else if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  } else if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  } else if (days < 7) {
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  } else if (weeks < 4) {
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  } else if (months < 12) {
    return `${months} ${months === 1 ? "month" : "months"} ago`;
  } else {
    return `${years} ${years === 1 ? "year" : "years"} ago`;
  }
}

/**
 * Extracts plain text from a string that may contain simple HTML tags.
 * Handles basic HTML tags (non-nested) and decodes HTML entities.
 *
 * @param text - The input text that may contain HTML tags
 * @returns The plain text without HTML tags and with decoded entities
 */
export const extractTextFromHtml = (text: string): string => {
  // If text is null, undefined, or not a string, return empty string
  if (!text || typeof text !== "string") {
    return "";
  }

  // First decode HTML entities
  const decodeEntities = (str: string): string => {
    const element = document.createElement("div");
    element.innerHTML = str;
    return element.textContent || element.innerText || "";
  };

  // Remove HTML tags and decode entities
  const plainText = text
    .replace(/<[^>]+>/g, "") // Remove HTML tags
    .trim(); // Remove leading/trailing whitespace

  return decodeEntities(plainText);
};

/**
 * Generate a unique ID with optional prefix
 * @param prefix - Optional 3 letter prefix to prepend (e.g., 'lyr' for 'layer')
 * @returns Unique ID string (e.g., "lyr-mip1xm2qt9vvh")
 */
export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 36 ** 6).toString(36);
  const id = `${timestamp}${random}`;
  return prefix ? `${prefix}-${id}` : id;
}

/**
 * Deep clone object
 * @param obj - The object to clone
 * @returns Deep cloned copy of the object
 */
export function cloneDeep<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (obj instanceof Date) return new Date(obj.getTime()) as T;
  if (obj instanceof Array) return obj.map((item) => cloneDeep(item)) as T;
  if (obj instanceof Object) {
    const clonedObj = {} as Record<string, unknown>;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        clonedObj[key] = cloneDeep((obj as Record<string, unknown>)[key]);
      }
    }
    return clonedObj as T;
  }
  throw new Error("Unable to clone object");
}

/**
 * Validate if a string is a valid UUID format
 *
 * @param str - The string to validate
 * @returns True if the string matches UUID format (e.g., "550e8400-e29b-41d4-a716-446655440000")
 *
 * @example
 * isValidUUID('550e8400-e29b-41d4-a716-446655440000') // true
 * isValidUUID('ghi') // false
 * isValidUUID('not-a-uuid') // false
 */
export function isValidUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Input Sanitization Utilities
 * Centralized helpers for cleaning user input values
 */

export type SanitizeOptions = {
  /** Remove all whitespace characters (default: true) */
  removeSpaces?: boolean;
  /** Remove leading/trailing whitespace only (default: false) */
  trim?: boolean;
  /** Convert to lowercase (default: false) */
  lowercase?: boolean;
  /** Remove specific characters via regex (default: null) */
  removePattern?: RegExp;
};

/**
 * Sanitize input value for design properties
 * Default: Removes all spaces to prevent invalid Tailwind classes
 *
 * @param value - The input value to sanitize
 * @param options - Optional sanitization configuration
 * @returns Sanitized value
 *
 * @example
 * sanitizeInput('10 rem') // '10rem'
 * sanitizeInput('  100px  ', { trim: true, removeSpaces: false }) // '100px'
 * sanitizeInput('#FF 00 00') // '#FF0000'
 */
export function sanitizeInput(
  value: string,
  options: SanitizeOptions = {},
): string {
  const {
    removeSpaces = true,
    trim = false,
    lowercase = false,
    removePattern = null,
  } = options;

  let sanitized = value;

  // Remove spaces (default behavior for Tailwind classes)
  if (removeSpaces) {
    sanitized = sanitized.replace(/\s+/g, "");
  }

  // Trim only (alternative to removing all spaces)
  if (trim && !removeSpaces) {
    sanitized = sanitized.trim();
  }

  // Convert to lowercase
  if (lowercase) {
    sanitized = sanitized.toLowerCase();
  }

  // Remove custom pattern
  if (removePattern) {
    sanitized = sanitized.replace(removePattern, "");
  }

  return sanitized;
}

/**
 * Quick helper: Remove all spaces from value
 * Common use case for Tailwind class values
 *
 * @param value - The input value
 * @returns Value without any spaces
 */
export function removeSpaces(value: string): string {
  return sanitizeInput(value, { removeSpaces: true });
}
