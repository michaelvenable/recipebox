// HTTP contract shared by the server and the client (docs/architecture.md, "Decisions").
import { z } from "zod";

export const HealthResponse = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
