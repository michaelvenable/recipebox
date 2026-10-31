// GET /me, the Account page (X-11). See recipes.ts for the optional-field convention.
import { z } from "zod";

export const Me = z.strictObject({
  signedIn: z.boolean(),
  provider: z.enum(["aad", "google"]).optional(),
  accountId: z.string().optional(),
  isEditor: z.boolean(),
});
export type Me = z.infer<typeof Me>;
