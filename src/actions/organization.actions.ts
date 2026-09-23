"use server";

import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";

type CreateOrganizationBody = {
  name: string;
  slug: string;
  logo?: string;
  metadata?: Record<string, any>;
  userId: string;
  keepCurrentActiveOrganization?: boolean;
};

/**
 * List all organizations for the current session user.
 */
export async function listOrganizations() {
  try {
    const res = await auth.api.listOrganizations({
      headers: await headers(),
    });
    return res; // Typed response from BetterAuth API
  } catch (error) {
    console.error("Error listing organizations:", error);
    throw new Error("Failed to list organizations.");
  }
}

/**
 * Set the active organization for the current session user.
 */
export async function setActiveOrganization(
  organizationId: string,
  organizationSlug?: string
) {
  try {
    const res = await auth.api.setActiveOrganization({
      body: {
        organizationId,
        organizationSlug,
      },
      headers: await headers(),
    });
    return res;
  } catch (error) {
    console.error("Error setting active organization:", error);
    throw new Error("Failed to set active organization.");
  }
}

/**
 * Create a new organization for the current user session.
 */
export async function createOrganization({
  name,
  slug,
  logo,
  metadata,
  userId,
  keepCurrentActiveOrganization = false,
}: CreateOrganizationBody) {
  try {
    const res = await auth.api.createOrganization({
      body: {
        name,
        slug,
        logo,
        metadata,
        userId,
        keepCurrentActiveOrganization,
      },
      headers: await headers(),
    });
    return res;
  } catch (error) {
    console.error("Error creating organization:", error);
    throw new Error("Failed to create organization.");
  }
}

/**
 * Update an existing organization.
 */
export async function updateOrganization(
  organizationId: string,
  data: Partial<{
    name: string;
    slug: string;
    logo: string;
    metadata: Record<string, any>;
  }>
) {
  try {
    const res = await auth.api.updateOrganization({
      body: {
        organizationId,
        data,
      },
      headers: await headers(),
    });
    return res;
  } catch (error) {
    console.error("Error updating organization:", error);
    throw new Error("Failed to update organization.");
  }
}

/**
 * Delete an organization by ID.
 */
export async function deleteOrganization(organizationId: string) {
  try {
    const res = await auth.api.deleteOrganization({
      body: { organizationId },
      headers: await headers(),
    });
    return res;
  } catch (error) {
    console.error("Error deleting organization:", error);
    throw new Error("Failed to delete organization.");
  }
}
