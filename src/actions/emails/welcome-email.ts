import { escapeHtml } from "@/lib/utils";
import { sendEmail } from "./send-email";

export async function sendWelcomeEmail(user: { name: string; email: string }) {
  const safeName = escapeHtml(user.name);

  await sendEmail({
    to: user.email,
    subject: "Welcome to Our App!",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Our App!</h2>
        <p>Hello ${safeName},</p>
        <p>Thank you for signing up for our app! We're excited to have you on board.</p>
        <p>Best regards,
        <br>
        Your App Team</p>
      </div>
    `,
    text: `Hello ${user.name},\n\nThank you for signing up for our app! We're excited to have you on board.\n\nBest regards,\nYour App Team`,
  });
}
