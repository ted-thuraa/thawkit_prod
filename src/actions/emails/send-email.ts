import { Resend } from "resend";
import { env } from "@/lib/env";

const resendClient = new Resend(env.RESEND_API_KEY);

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  try {
    const result = await resendClient.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to,
      subject,
      html,
      // TextBody: text,
    });

    if (result.error) {
      console.error("Failed to send email:", result.error);
    }

    return result;
  } catch (error) {
    // Never let a transactional email failure take down the auth flow —
    // e.g. sign-up succeeding in the DB but this throwing would leave an
    // orphaned, unverified account with an email that's now blocked from
    // re-signing-up.
    console.error("Unexpected error sending email:", error);
    return { data: null, error };
  }
}
