import { z } from "zod";

const envSchema = z.object({
  // Better Auth
  // (Add your actual DB connection var(s) here too, e.g. DATABASE_URL —-+
  // omitted since the connection string name wasn't visible in the files
  // I have access to.)

  // OAuth
  //GITHUB_CLIENT_ID: z.string().min(1, "GITHUB_CLIENT_ID is required"),
  //GITHUB_CLIENT_SECRET: z.string().min(1, "GITHUB_CLIENT_SECRET is required"),
  //DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  //DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required"),

  // Arcjet
  //ARCJET_API_KEY: z.string().min(1, "ARCJET_API_KEY is required"),

  // Polar
  POLAR_ACCESS_TOKEN: z.string().min(1, "POLAR_ACCESS_TOKEN is required"),
  POLAR_WEBHOOK_SECRET: z.string().min(1, "POLAR_WEBHOOK_SECRET is required"),
  POLAR_SUCCESS_URL: z.url("POLAR_SUCCESS_URL must be a valid URL"),
  // "production" | "sandbox" — defaults to sandbox so an environment that
  // forgets to set this can never accidentally hit live billing.
  POLAR_SERVER: z.enum(["production", "sandbox"]).default("sandbox"),

  // Email
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  RESEND_FROM_EMAIL: z.email("RESEND_FROM_EMAIL must be a valid email"),

  // Polar
  UPLOADTHING_TOKEN: z.string().min(1, "UPLOADTHING_TOKEN is required"),
  UPLOADTHING_SECRET: z.string().min(1, "UPLOADTHING_SECRET is required"),
  UPLOADTHING_APP_ID: z.string().min(1, "UPLOADTHING_APP_ID is required"),

  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

/**
 * Parsed, typed, validated environment variables.
 *
 * Import this instead of reading `process.env.X!` directly. A missing or
 * malformed variable throws one readable error at import time, instead of
 * failing unpredictably deep inside a request handler later.
 */
function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `❌ Invalid or missing environment variables:\n${formatted}`,
    );
  }

  return parsed.data;
}

export const env = loadEnv();
