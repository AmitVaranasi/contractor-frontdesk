import { activeProfile } from "@/lib/storage/repo";
import { syncAssistant, vapiConfigured } from "@/lib/phone/vapiApi";
import { handle, HttpError } from "@/lib/http";

/** Returns only the saved assistant id for a browser test call; the config (and webhook secret) stay server-side. */
export function GET(req: Request) {
  return handle(async () => {
    const id = new URL(req.url).searchParams.get("c") ?? "";
    const p = activeProfile(id);
    if (!p) throw new HttpError(404, "Business not active");
    if (!vapiConfigured()) throw new HttpError(409, "Set VAPI_API_KEY, VAPI_SERVER_SECRET and PUBLIC_BASE_URL first");
    return { assistantId: await syncAssistant(p) };
  });
}
