// app/components/forms/new-project-form.tsx (or your preferred path)
"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import z from "zod";
import { LoadingSwap } from "@/components/ui/loading-swap";
import {
  createCampaignSchema,
  type CreateCampaignInput,
} from "@/lib/validation/campaign";
import { createCampaign } from "@/actions/workspace/create-campaign";

/**
 * A client-side form for creating or editing a project.
 * It validates input and calls a Server Action to persist changes.
 */
export function CreateCampaignForm({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CreateCampaignInput>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: { organizationId, name: "" },
  });

  const { isSubmitting } = form.formState;

  async function handleSubmit(data: CreateCampaignInput) {
    setServerError(null);

    let result: Awaited<ReturnType<typeof createCampaign>>;
    try {
      result = await createCampaign(data);
    } catch {
      // Transport-level failure (network drop mid-request) — distinct from
      // the action's own try/catch, which only covers requests that
      // actually reached the server.
      setServerError(
        "Couldn't reach the server — check your connection and try again.",
      );
      return;
    }

    if (!result.ok) {
      if (result.error.fieldErrors) {
        for (const [field, messages] of Object.entries(
          result.error.fieldErrors,
        )) {
          if (messages?.[0]) {
            form.setError(field as keyof CreateCampaignInput, {
              message: messages[0],
            });
          }
        }
      }

      if (result.error.code === "FORBIDDEN") {
        setServerError(
          "You don't have permission to create campaigns in this workspace.",
        );
      } else if (!result.error.fieldErrors) {
        setServerError(result.error.message);
      }
      return;
    }

    toast.success(`"${result.data.name}" created`);
    onCreated?.();
    router.push(`/campaign/${result.data.id}/`);
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Project Details</CardTitle>
        <CardDescription>
          Give your new project a name and description.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      required
                      placeholder="My New Project"
                      disabled={isSubmitting}
                      {...field}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* <FormField
              disabled={isPending}
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="A brief description of what this project is for."
                      {...field}
                      value={field.value || ""} // Ensure value is not null/undefined
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            /> */}

            <Button disabled={isSubmitting} type="submit">
              <LoadingSwap isLoading={isSubmitting}>
                Create campaign
              </LoadingSwap>
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
