import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCampaignEditPermission = vi.fn();
const folderBelongsToOrganization = vi.fn();
const processUploadedFile = vi.fn();

vi.mock("@/lib/auth/require-campaign-permission", () => ({
  requireCampaignEditPermission: (...a: unknown[]) => requireCampaignEditPermission(...a),
}));
vi.mock("@/lib/assets/asset-repository", () => ({
  folderBelongsToOrganization: (...a: unknown[]) => folderBelongsToOrganization(...a),
}));
vi.mock("@/lib/assets/process-upload-deps", () => ({ processUploadDeps: { marker: "deps" } }));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/assets/process-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assets/process-upload")>();
  return { ...actual, processUploadedFile: (...a: unknown[]) => processUploadedFile(...a) };
});

import { AppError, ForbiddenError, UnauthenticatedError } from "@/lib/errors";
import { UploadRejectedError } from "@/lib/assets/process-upload";
import { ourFileRouter } from "@/app/api/uploadthing/core";

// UploadThing v7 exposes the route's config/handlers directly on the route object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const def = ourFileRouter.assetLibrary as any;

const FOLDER = "22222222-2222-4222-8222-222222222222";
const okFile = { name: "a.png", type: "image/png", size: 1000 };
const run = (input: object, files: object[] = [okFile]) =>
  def.middleware({ input, files, req: {}, event: {} });

beforeEach(() => {
  requireCampaignEditPermission.mockReset().mockResolvedValue({
    organizationId: "org_1",
    userId: "user_1",
  });
  folderBelongsToOrganization.mockReset().mockResolvedValue(true);
  processUploadedFile.mockReset();
});

describe("upload router configuration", () => {
  it("only declares explicit image MIME types (no video/audio/pdf/blob)", () => {
    const keys = Object.keys(def.routerConfig);
    expect(keys.sort()).toEqual(
      ["image/avif", "image/gif", "image/jpeg", "image/png", "image/svg+xml", "image/webp"].sort(),
    );
  });

  it("validates input with zod (campaignId required, folderId must be a uuid)", () => {
    const parse = (v: unknown) => def.inputParser.safeParse(v).success;
    expect(parse({ campaignId: "c" })).toBe(true);
    expect(parse({ campaignId: "c", folderId: FOLDER })).toBe(true);
    expect(parse({ campaignId: "c", folderId: null })).toBe(true);
    expect(parse({})).toBe(false);
    expect(parse({ campaignId: "c", folderId: "not-a-uuid" })).toBe(false);
    expect(parse({ campaignId: "" })).toBe(false);
  });
});

describe("middleware", () => {
  it("derives organization/user from the AUTHORIZED campaign, not from input", async () => {
    const meta = await run({ campaignId: "camp_1", folderId: null, organizationId: "org_EVIL" });
    expect(requireCampaignEditPermission).toHaveBeenCalledWith("camp_1");
    expect(meta).toEqual({ organizationId: "org_1", userId: "user_1", folderId: null });
  });

  it("authorizes BEFORE doing anything else", async () => {
    requireCampaignEditPermission.mockRejectedValue(new UnauthenticatedError());
    await expect(run({ campaignId: "c", folderId: FOLDER })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(folderBelongsToOrganization).not.toHaveBeenCalled();
  });

  it("a user without edit permission is rejected", async () => {
    requireCampaignEditPermission.mockRejectedValue(new ForbiddenError());
    await expect(run({ campaignId: "c" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("unexpected auth failures are generic (no internals leaked)", async () => {
    requireCampaignEditPermission.mockRejectedValue(new Error("pg: password for user x"));
    const err = await run({ campaignId: "c" }).catch((e: Error) => e);
    expect(String(err.message)).not.toMatch(/pg|password/);
    expect(err).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("rejects a folder from another organization", async () => {
    folderBelongsToOrganization.mockResolvedValue(false);
    await expect(run({ campaignId: "c", folderId: FOLDER })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(folderBelongsToOrganization).toHaveBeenCalledWith("org_1", FOLDER);
  });

  it("accepts a folder of the organization and passes it through", async () => {
    const meta = await run({ campaignId: "c", folderId: FOLDER });
    expect(meta.folderId).toBe(FOLDER);
  });

  it.each([
    ["video", { name: "v.mp4", type: "video/mp4", size: 1000 }],
    ["pdf", { name: "d.pdf", type: "application/pdf", size: 1000 }],
    ["html", { name: "x.html", type: "text/html", size: 1000 }],
    ["oversize", { name: "big.png", type: "image/png", size: 9 * 1024 * 1024 }],
    ["empty", { name: "e.png", type: "image/png", size: 0 }],
  ])("rejects %s uploads before they start", async (_n, file) => {
    await expect(run({ campaignId: "c" }, [file])).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("limits files per upload", async () => {
    await expect(run({ campaignId: "c" }, Array.from({ length: 11 }, () => okFile))).rejects.toMatchObject({
      code: "TOO_MANY_FILES",
    });
  });
});

describe("onUploadComplete", () => {
  const meta = { organizationId: "org_1", userId: "user_1", folderId: null };
  const file = { key: "k", name: "a.png", size: 10, type: "image/png", ufsUrl: "https://a.ufs.sh/f/k", extra: "x" };
  const asset = { id: "a1", filename: "a.png" };

  it("persists via processUploadedFile with server-derived metadata and returns the asset", async () => {
    processUploadedFile.mockResolvedValue(asset);
    const out = await def.onUploadComplete({ metadata: meta, file });
    expect(processUploadedFile).toHaveBeenCalledWith(
      { key: "k", name: "a.png", size: 10, type: "image/png", ufsUrl: "https://a.ufs.sh/f/k" },
      meta,
      { marker: "deps" },
    );
    expect(out).toEqual({ asset });
  });

  it("surfaces user-safe rejection messages", async () => {
    processUploadedFile.mockRejectedValue(new UploadRejectedError("File is not a valid image."));
    await expect(def.onUploadComplete({ metadata: meta, file })).rejects.toMatchObject({
      message: "File is not a valid image.",
    });
  });

  it("hides unexpected errors behind a generic message", async () => {
    processUploadedFile.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.5:5432"));
    const err = await def.onUploadComplete({ metadata: meta, file }).catch((e: Error) => e);
    expect(err.message).not.toMatch(/ECONNREFUSED|10\.0/);
    expect(err.message).toMatch(/could not be saved/i);
  });
});

void AppError;
