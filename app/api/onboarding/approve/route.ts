import { z } from "zod";
import { approveProfile } from "@/lib/agents/onboarding";
import { handle, parseBody } from "@/lib/http";

export function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, z.object({ contractorId: z.string(), confirmed: z.array(z.string()).max(50) }));
    return approveProfile(body.contractorId, body.confirmed);
  });
}
