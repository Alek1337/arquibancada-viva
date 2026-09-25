import { z } from "zod";

const opaqueIdentitySchema = z.string().trim().min(1).max(200);

export const sessionIdentitySchema = z
  .strictObject({
    sessionId: opaqueIdentitySchema,
    userId: opaqueIdentitySchema,
  })
  .readonly();

export type SessionIdentity = z.infer<typeof sessionIdentitySchema>;
