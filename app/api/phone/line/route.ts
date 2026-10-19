import { z } from "zod";
import { activeProfile } from "@/lib/storage/repo";
import { lineContractor, setLineContractor } from "@/lib/phone/calls";
import { handle, HttpError, parseBody } from "@/lib/http";

export function GET() {
  return handle(async () => ({
    contractorId: lineContractor(),
    number: process.env.VAPI_PHONE_NUMBER ?? null,
    configured: Boolean(process.env.VAPI_API_KEY && process.env.VAPI_SERVER_SECRET && process.env.PUBLIC_BASE_URL),
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null,
  }));
}

export function POST(req: Request) {
  return handle(async () => {
    const { contractorId } = await parseBody(req, z.object({ contractorId: z.string() }));
    if (!activeProfile(contractorId)) throw new HttpError(409, "Approve this business before putting it on the phone line");
    setLineContractor(contractorId);
    return { ok: true, contractorId };
  });
}
