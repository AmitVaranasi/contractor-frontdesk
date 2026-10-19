import { listFollowUps, markFollowUpDelivery } from "../booking";
import { recordUsage } from "../storage/repo";

export function n8nConfigured(): boolean {
  return Boolean(process.env.N8N_WEBHOOK_URL);
}

/**
 * Hand a drafted follow-up to the n8n workflow (n8n/followup-workflow.json).
 * The follow-up row already exists in our database; delivery state is tracked
 * separately so a failed webhook can be retried without duplicating anything.
 */
export async function deliverFollowUp(followUpId: string): Promise<string> {
  const fu = listFollowUps().find((f) => f.id === followUpId);
  if (!fu) return "missing";
  if (fu.delivery.startsWith("n8n:sent")) return fu.delivery;
  if (!n8nConfigured()) {
    markFollowUpDelivery(followUpId, "internal-queue");
    return "internal-queue";
  }
  try {
    const res = await fetch(process.env.N8N_WEBHOOK_URL!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.N8N_WEBHOOK_SECRET ? { "x-frontdesk-secret": process.env.N8N_WEBHOOK_SECRET } : {}),
        "idempotency-key": fu.id,
      },
      body: JSON.stringify({ followUpId: fu.id, contractorId: fu.contractor_id, triggerEventId: fu.trigger_event_id, ...fu.content }),
      signal: AbortSignal.timeout(10_000),
    });
    const delivery = res.ok ? `n8n:sent:${res.status}` : `n8n:failed:${res.status}`;
    markFollowUpDelivery(followUpId, delivery);
    recordUsage({
      contractorId: fu.contractor_id,
      agent: "sam",
      provider: "n8n",
      kind: "workflow_execution",
      quantity: 1,
      unit: "executions",
      costUsd: 0,
      costBasis: "estimated",
      live: true,
    });
    return delivery;
  } catch (err) {
    const delivery = `n8n:failed:${(err as Error).message.slice(0, 60)}`;
    markFollowUpDelivery(followUpId, delivery);
    return delivery;
  }
}
