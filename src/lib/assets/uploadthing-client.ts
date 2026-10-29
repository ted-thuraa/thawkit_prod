// path: src/lib/assets/uploadthing-client.ts
"use client";

import { generateReactHelpers } from "@uploadthing/react";
// Type-only import: erased at build, so none of the router's server code
// (DB, auth, secrets) is bundled into the browser.
import type { OurFileRouter } from "@/app/api/uploadthing/core";

export const { useUploadThing } = generateReactHelpers<OurFileRouter>();
