import { auth } from "@/lib/auth/auth";
import { toNextJsHandler } from "better-auth/next-js";

import { de } from "zod/v4/locales";
import { env } from "@/lib/env";

const authHandlers = toNextJsHandler(auth);
export const { GET, POST } = authHandlers;
