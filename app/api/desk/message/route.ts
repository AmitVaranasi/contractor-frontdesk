import { z } from "zod";
import { handleCustomerMessage } from "@/lib/agents/frontdesk";
import { contractorBySlug } from "@/lib/storage/repo";
import { handle, HttpError, parseBody } from "@/lib/http";

export function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, z.object({ slug: z.string(), inquiryId: z.string().nullable().optional(), message: z.string().min(1).max(2000) }));
    // The desk slug, not the client, decides the tenant.
    const c = contractorBySlug(body.slug);
    if (!c) throw new HttpError(404, "Unknown front desk");
    return handleCustomerMessage({ contractorId: c.id, inquiryId: body.inquiryId, message: body.message });
  });
}
