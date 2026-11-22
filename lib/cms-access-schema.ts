import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const cmsConnectionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["direct", "supervisor"]),
  // Legacy field name: direct accounts may identify themselves with a username/UID.
  // Supervisor grants still require a verified contact email from CMS.
  email: z.string().min(1).max(500),
  uid: z.string().min(1),
  projects: z.array(z.string()).max(5000),
  sealed: z.string(),
  environment: z.string(),
  expiresAt: z.number(),
  grantId: z.uuid().optional(),
});
export const cmsBrowserSchema = z.object({
  hash,
  expiresAt: z.number(),
  connection: cmsConnectionSchema.optional(),
  challenge: z
    .object({
      sealed: z.string(),
      method: z.enum(["totp", "otp"]),
      projectId: z.string(),
      approvalId: z.uuid().optional(),
      expiresAt: z.number(),
      id: z.uuid(),
    })
    .optional(),
  approvalAuth: z
    .object({
      requestId: z.uuid(),
      connection: cmsConnectionSchema,
    })
    .optional(),
});
export const cmsApprovalSchema = z.object({
  id: z.uuid(),
  ownerHash: hash,
  tokenHash: hash,
  projectId: z.string(),
  email: z.email(),
  requester: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: z.enum([
    "sending",
    "pending",
    "approved",
    "denied",
    "failed",
    "revoked",
    "cancelled",
  ]),
  grantExpiresAt: z.number().optional(),
  supervisorUid: z.string().optional(),
});
export const cmsAccessStateSchema = z.object({
  browsers: z.array(cmsBrowserSchema).max(1000),
  approvals: z.array(cmsApprovalSchema).max(500),
  limits: z
    .array(
      z.object({ key: z.string(), count: z.number(), resetAt: z.number() }),
    )
    .max(2000),
  audit: z
    .array(
      z.object({
        at: z.number(),
        event: z.enum([
          "login",
          "logout",
          "requested",
          "approved",
          "denied",
          "revoked",
          "cancelled",
        ]),
        sessionHash: hash,
        projectId: z.string().optional(),
        requestId: z.uuid().optional(),
        actor: z.string().optional(),
      }),
    )
    .max(500),
});
export type CmsBrowser = z.infer<typeof cmsBrowserSchema>;
export type CmsConnection = z.infer<typeof cmsConnectionSchema>;
export type CmsApproval = z.infer<typeof cmsApprovalSchema>;
export type CmsAccessState = z.infer<typeof cmsAccessStateSchema>;
