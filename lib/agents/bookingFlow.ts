import { acceptQuote, BookingError, createBooking, latestQuote } from "../booking";
import { deliverFollowUp } from "../adapters/n8n";
import { assertTool } from "./roles";
import { getInquiry, mergeFields } from "./frontdesk";
import { getDb, nowIso } from "../storage/db";
import { logEvent } from "../storage/repo";

/** Accept the quote (or confirm the assessment), reserve the slot once, and hand off the follow-up. */
export async function bookInquiry(args: {
  contractorId: string;
  inquiryId: string;
  slotStart: string;
  idempotencyKey: string;
  confirmAssessment: boolean;
  customer?: { name?: string; phone?: string };
}) {
  const found = getInquiry(args.contractorId, args.inquiryId);
  if (!found) throw new BookingError("NOT_FOUND", "Inquiry not found");

  if (args.customer) {
    const merged = mergeFields(found.inquiry.collected, { customer_name: args.customer.name, customer_phone: args.customer.phone });
    getDb().prepare("UPDATE inquiries SET collected_json = ?, updated_at = ? WHERE id = ? AND contractor_id = ?").run(JSON.stringify(merged), nowIso(), args.inquiryId, args.contractorId);
  }

  if (found.inquiry.status === "quoted") {
    const q = latestQuote(args.contractorId, args.inquiryId);
    if (!q) throw new BookingError("QUOTE_NOT_ACCEPTED", "No quote to accept");
    if (q.status === "issued") {
      acceptQuote(args.contractorId, args.inquiryId, q.id);
      logEvent({ contractorId: args.contractorId, agent: "customer", type: "quote.accepted", summary: `Customer accepted quote ${q.id}`, data: { quoteId: q.id } });
    }
  } else if (found.inquiry.status === "assessment_required" && !args.confirmAssessment) {
    throw new BookingError("NOT_ELIGIBLE", "Customer must explicitly confirm the assessment booking");
  }

  assertTool("sam", "create_booking");
  const outcome = createBooking({ contractorId: args.contractorId, inquiryId: args.inquiryId, slotStart: args.slotStart, idempotencyKey: args.idempotencyKey });
  let delivery: string | null = null;
  if (outcome.followUpId) {
    assertTool("sam", "create_follow_up");
    delivery = await deliverFollowUp(outcome.followUpId);
  }
  return { ...outcome, delivery };
}
