import { allIntakes } from "@/lib/intakes";
import { ledger } from "@/lib/finance";
import { listBookings, listFollowUps, reconcileFollowUps } from "@/lib/booking";
import { listInquiries } from "@/lib/agents/frontdesk";
import { integrationStatus } from "@/lib/integrations";
import { liveProviders } from "@/lib/llm";
import { activeProfile, latestProfile, listEvents, listEvidence, listTasks, profileHistory, upsertContractor, usageSummary } from "@/lib/storage/repo";
import { handle } from "@/lib/http";
import { warmRocketRide } from "@/lib/adapters/rocketride";
import { calendarConnection, listCalendarEvents } from "@/lib/calendar";
import { lineContractor, listCalls } from "@/lib/phone/calls";
import { savedAssistantId, vapiConfigured } from "@/lib/phone/vapiApi";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handle(async () => {
    warmRocketRide();
    const intakes = allIntakes();
    for (const i of intakes) upsertContractor({ id: i.contractorId, slug: i.slug, businessName: i.businessName, trade: i.trade });
    reconcileFollowUps();
    const url = new URL(req.url);
    const sinceId = Number(url.searchParams.get("since") ?? 0) || 0;
    return {
      contractors: intakes.map((i) => ({
        id: i.contractorId,
        slug: i.slug,
        businessName: i.businessName,
        trade: i.trade,
        websitePath: i.websitePath,
        requestedPlanId: i.requestedPlanId,
        expectedConversationsPerMonth: i.expectedConversationsPerMonth,
        latest: latestProfile(i.contractorId),
        active: activeProfile(i.contractorId),
        history: profileHistory(i.contractorId),
        bookings: listBookings(i.contractorId),
        inquiries: listInquiries(i.contractorId),
        ledger: ledger(i.contractorId),
        calls: listCalls(i.contractorId),
        calendar: {
          connection: calendarConnection(i.contractorId),
          events: listCalendarEvents(i.contractorId, new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 14 * 86_400_000).toISOString()),
        },
        vapiAssistantId: savedAssistantId(i.contractorId),
      })),
      phone: {
        lineContractorId: lineContractor(),
        number: process.env.VAPI_PHONE_NUMBER ?? null,
        configured: vapiConfigured(),
        publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null,
        webCallEnabled: Boolean(process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY && vapiConfigured()),
      },
      events: listEvents(null, sinceId, 200),
      tasks: listTasks(null, 100),
      followUps: listFollowUps(),
      evidence: listEvidence(40),
      usage: usageSummary(),
      ledger: ledger(),
      integrations: integrationStatus(),
      llmProviders: liveProviders(),
    };
  });
}
