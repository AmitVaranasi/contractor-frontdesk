import { getInquiry, slotsForInquiry } from "@/lib/agents/frontdesk";
import { contractorBySlug } from "@/lib/storage/repo";
import { handle, HttpError } from "@/lib/http";

export function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const c = contractorBySlug(url.searchParams.get("slug") ?? "");
    if (!c) throw new HttpError(404, "Unknown front desk");
    const found = getInquiry(c.id, url.searchParams.get("id") ?? "");
    if (!found) throw new HttpError(404, "Inquiry not found");
    const open = found.inquiry.status === "quoted" || found.inquiry.status === "assessment_required";
    return { ...found, slots: open ? slotsForInquiry(c.id, found.inquiry.id) : [] };
  });
}
