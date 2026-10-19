import { z } from "zod";
import { connectCalendar, disconnectCalendar } from "@/lib/calendar";
import { activeProfile } from "@/lib/storage/repo";
import { handle, HttpError, parseBody } from "@/lib/http";

export function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, z.object({ contractorId: z.string(), action: z.enum(["connect", "disconnect"]), account: z.string().email().optional() }));
    if (body.action === "disconnect") {
      disconnectCalendar(body.contractorId);
      return { ok: true };
    }
    const profile = activeProfile(body.contractorId);
    if (!profile) throw new HttpError(409, "Approve the business before connecting a calendar");
    return { ok: true, ...connectCalendar(profile, body.account ?? profile.escalationContact) };
  });
}
