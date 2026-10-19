import { allIntakes } from "@/lib/intakes";
import { planById } from "@/lib/plans";
import { activeProfile, listTasks, latestProfile } from "@/lib/storage/repo";
import { formatCents } from "@/lib/time";

/** Operations wiki as markdown, for import into the team's PromptQL shared workspace. */
export function GET() {
  const parts = ["# Front desk operations wiki", "", `Generated ${new Date().toISOString()} from the live database.`, ""];
  for (const i of allIntakes()) {
    const p = activeProfile(i.contractorId) ?? latestProfile(i.contractorId);
    parts.push(`## ${i.businessName}`, "");
    if (!p) {
      parts.push("_Not onboarded yet._", "");
      continue;
    }
    parts.push(`- Status: **${p.status}** (v${p.version})`, `- Plan: ${planById(p.planId)?.name ?? "none"}`, `- Service ZIPs: ${p.serviceZips.join(", ")}`, `- Escalation: ${p.escalationContact}`, "");
    for (const s of p.services) {
      parts.push(`### ${s.name} (${s.mode === "fixed" ? "fixed price" : "assessment first"})`, "", s.scope, "");
      if (s.basePriceCents !== null) parts.push(`- Base: ${formatCents(s.basePriceCents)} (${s.basePriceSource})`);
      for (const a of s.addOns) parts.push(`- Add-on ${a.name}: ${formatCents(a.priceCents)} — ${a.enabled ? "quotable" : "disabled, awaiting owner"}`);
      if (s.inspectionFeeCents !== null) parts.push(`- Assessment fee: ${formatCents(s.inspectionFeeCents)}`);
      parts.push(`- Not included: ${s.exclusions.join(", ")}`, s.urgentConditions.length ? `- Escalate immediately: ${s.urgentConditions.join(", ")}` : "", "");
    }
    if (p.openQuestions.length) parts.push("**Open questions**", ...p.openQuestions.map((q) => `- ${q.question}`), "");
    const decisions = listTasks(i.contractorId, 50).filter((t) => t.decision_summary).reverse();
    if (decisions.length) parts.push("**Decision log**", ...decisions.map((t) => `- ${t.recipient.toUpperCase()} · ${t.task_type}: ${t.decision_summary}`), "");
  }
  return new Response(parts.join("\n"), { headers: { "content-type": "text/markdown; charset=utf-8" } });
}
