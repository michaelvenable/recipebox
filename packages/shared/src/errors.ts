// Error body for every 4xx (docs/api.md, "Conventions"). Items have the shape of the domain's DomainError; this package
// doesn't import the domain (client -> shared), so the shape is repeated here.
import { z } from "zod";

export const ErrorItem = z.strictObject({
  code: z.string(),
  field: z.string().optional(),
  message: z.string(),
});
export type ErrorItem = z.infer<typeof ErrorItem>;

export const ErrorResponse = z.strictObject({
  errors: z.array(ErrorItem),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
