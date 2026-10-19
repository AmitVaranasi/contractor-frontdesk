import { z } from "zod";
import { bookInquiry } from "@/lib/agents/bookingFlow";
import { contractorBySlug } from "@/lib/storage/repo";
import { handle, HttpError, parseBody } from "@/lib/http";

export function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(
      req,
      z.object({ slug: z.string(), inquiryId: z.string(), slotStart: z.string().datetime(), idempotencyKey: z.string().min(8).max(100), confirmAssessment: z.boolean().optional() }),
    );
    const c = contractorBySlug(body.slug);
    if (!c) throw new HttpError(404, "Unknown front desk");
    return bookInquiry({ contractorId: c.id, inquiryId: body.inquiryId, slotStart: body.slotStart, idempotencyKey: body.idempotencyKey, confirmAssessment: Boolean(body.confirmAssessment) });
  });
}
