/**
 * An array of routes that are accessible to the public
 * These routes do not require authentication
 * @type {string[]}
 */
export const publicRoutes = [
  "/site",
  "/invite/accept",
  "/api/uploadthing",
  "/api/previewImageGen/**",
  "/auth/new-verification",
  "/api/webhook/**",
  "/api/track",
  "/api/tool/**",
];

/**
 * An array of routes that are used for authentication
 * These routes will redirect logged in users to the default post-login page
 * @type {string[]}
 */
export const authRoutes = [
  "/login",
  "/signup",
  "/auth/error",
  "/auth/reset",
  "/auth/new-password",
];

/**
 * The prefix for API authentication routes
 * Routes that start with this prefix are used for API authentication purposes
 * @type {string}
 */
export const apiAuthPrefix = "/api/auth";

/**
 * The route unauthenticated users are sent to when they hit a protected page
 * @type {string}
 */
export const LOGIN_ROUTE = "/login";

/**
 * The default redirect path after logging in
 * @type {string}
 */
export const DEFAULT_LOGIN_REDIRECT = "/workspace";
