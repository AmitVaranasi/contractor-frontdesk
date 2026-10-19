import { z } from "zod";
import { applyOwnerEdits, ownerEditSchema } from "@/lib/agents/ownerEdits";
import { handle, parseBody } from "@/lib/http";

export const maxDuration = 120;

export function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, z.object({ contractorId: z.string(), edit: ownerEditSchema }));
    return applyOwnerEdits(body.contractorId, body.edit);
  });
}
