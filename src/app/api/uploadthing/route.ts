// path: src/app/api/uploadthing/route.ts

import { createRouteHandler } from "uploadthing/next";
import { env } from "@/lib/env";
import { ourFileRouter } from "./core";

// Serves the UploadThing protocol (presign, callback, polling). Authorization
// happens per request inside the router's middleware, not here.
export const { GET, POST } = createRouteHandler({
  router: ourFileRouter,
  config: { token: env.UPLOADTHING_TOKEN },
});
