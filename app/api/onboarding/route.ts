import { z } from "zod";
import { runOnboarding } from "@/lib/agents/onboarding";
import { handle, parseBody } from "@/lib/http";

export const maxDuration = 300;

export function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, z.object({ contractorId: z.string(), websiteUrl: z.string().max(500).optional() }));
    return runOnboarding(body.contractorId, { websiteUrl: body.websiteUrl });
  });
}
