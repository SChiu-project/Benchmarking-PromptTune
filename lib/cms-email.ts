import { CmsError } from "./cms-client";
import type { CmsApproval } from "./cms-access-schema";

export function cmsEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.CMS_EMAIL_FROM);
}
export async function sendApprovalEmail(approval: CmsApproval, link: string) {
  if (!cmsEmailConfigured())
    throw new CmsError(
      "Supervisor email is not enabled in this workspace. Ask the administrator to enable email delivery, or use direct CMS login.",
      503,
      "CMS_EMAIL_NOT_CONFIGURED",
    );
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `cms-approval-${approval.id}`,
      },
      body: JSON.stringify({
        from: process.env.CMS_EMAIL_FROM,
        to: [approval.email],
        subject: "Approve CMS prompt-read access",
        text: [
          "A benchmark user is requesting CMS prompt-read access.",
          `Requester (self-reported): ${approval.requester}`,
          `Project: ${approval.projectId}`,
          "Access: read stored prompts through the benchmark app for one hour. No CMS publishing or write access.",
          "Sign in with your CMS account and explicitly approve or deny this request:",
          link,
          "The request expires in 30 minutes. Signing in alone does not approve access.",
          "Only approve if you recognize the requester and are authorized to share this project's prompts. All benchmark workspace users can view loaded prompts and saved run history.",
          "You can use this link to revoke access while the grant is active. If you did not expect this request, ignore it or deny it.",
        ].join("\n\n"),
      }),
    });
    if (!response.ok) throw new Error("delivery failed");
    // Consume without logging provider responses or approval links.
    await response.body?.cancel();
  } catch {
    throw new CmsError(
      "The approval email could not be confirmed as sent. Wait a minute before retrying; an email may already have arrived.",
      502,
      "CMS_EMAIL_FAILED",
    );
  }
}
