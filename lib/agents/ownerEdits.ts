import { z } from "zod";
import type { ContractorProfile } from "../types";
import { getDb } from "../storage/db";
import { activeProfile, completeTask, createTask, logEvent, saveProfileVersion, setActiveVersion } from "../storage/repo";
import { ctoValidate } from "./cto";
import { syncAssistant, vapiConfigured } from "../phone/vapiApi";

const dollars = z.number().min(0).max(100000);

export const ownerEditSchema = z.object({
  businessName: z.string().min(1).max(80),
  escalationContact: z.string().min(3).max(120),
  timeZone: z.string().min(1),
  serviceZips: z.array(z.string().regex(/^\d{5}$/)).min(1).max(100),
  hours: z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }),
  leadTimeHours: z.number().min(0).max(168),
  service: z.object({
    name: z.string().min(1).max(80),
    scope: z.string().min(1).max(400),
    durationMin: z.number().int().min(15).max(720),
    bufferMin: z.number().int().min(0).max(240),
    basePriceDollars: dollars.nullable(),
    inspectionFeeDollars: dollars.nullable(),
    exclusions: z.array(z.string().min(1).max(60)).max(30),
    urgentConditions: z.array(z.string().min(1).max(60)).max(30),
    addOns: z.array(z.object({ id: z.string().min(1).max(24), name: z.string().min(1).max(60), priceDollars: dollars, enabled: z.boolean() })).max(20),
    negotiation: z.object({
      enabled: z.boolean(),
      maxDiscountPercent: z.number().min(0).max(50),
      floorDollars: dollars.nullable(),
      stepPercent: z.number().min(1).max(25),
      weekdayOnly: z.boolean(),
    }),
  }),
});
export type OwnerEdit = z.infer<typeof ownerEditSchema>;

const cents = (d: number | null) => (d === null ? null : Math.round(d * 100));

/** Apply owner edits as a new owner-sourced version; activate only if the CTO's checks pass. */
export async function applyOwnerEdits(contractorId: string, edit: OwnerEdit) {
  const current = activeProfile(contractorId);
  if (!current) throw new Error("Finish onboarding before editing the live profile");

  const next: ContractorProfile = structuredClone(current);
  next.businessName = edit.businessName;
  next.escalationContact = edit.escalationContact;
  next.timeZone = edit.timeZone;
  next.serviceZips = Array.from(new Set(edit.serviceZips));
  next.hours = { ...edit.hours, days: Array.from(new Set(edit.hours.days)).sort() };
  next.leadTimeHours = edit.leadTimeHours;
  const s = next.services[0];
  s.name = edit.service.name;
  s.scope = edit.service.scope;
  s.durationMin = edit.service.durationMin;
  s.bufferMin = edit.service.bufferMin;
  s.exclusions = edit.service.exclusions;
  s.urgentConditions = edit.service.urgentConditions;
  if (s.mode === "fixed") {
    s.basePriceCents = cents(edit.service.basePriceDollars);
    s.basePriceSource = "owner";
  }
  s.inspectionFeeCents = cents(edit.service.inspectionFeeDollars);
  // Anything the owner types into the portal is, by definition, owner-sourced.
  s.addOns = edit.service.addOns.map((a) => ({ id: a.id, name: a.name, priceCents: Math.round(a.priceDollars * 100), source: "owner" as const, enabled: a.enabled }));
  const n = edit.service.negotiation;
  s.negotiation = { enabled: n.enabled, maxDiscountPercent: n.maxDiscountPercent, floorCents: cents(n.floorDollars), stepPercent: n.stepPercent, weekdayOnly: n.weekdayOnly };
  next.permissions.concessionsAllowed = n.enabled;
  // Questions the owner has now answered by editing add-ons are closed.
  next.openQuestions = next.openQuestions.filter((q) => {
    const c = q.onConfirm;
    return !(c?.type === "enable_addon" && s.addOns.some((a) => a.id === c.addOnId));
  });

  const { version: _v, ...rest } = next;
  const saved = saveProfileVersion({ ...rest, status: "draft" }, "contractor", "Owner edited business details in the portal");
  logEvent({ contractorId, agent: "contractor", type: "profile.edited", summary: `Owner saved edits as v${saved.version}`, data: {} });

  const task = createTask({ contractorId, sender: "contractor", recipient: "arun", taskType: "validate_profile", profileVersion: saved.version, requestedAction: "Validate owner edits before they go live" });
  const v = await ctoValidate(saved);
  if (!v.ok) {
    completeTask(task, "failed", `Edits rejected: ${v.local.errors.map((e) => e.message).join("; ")}`, [v.evidenceId]);
    logEvent({ contractorId, agent: "arun", type: "profile.rejected", summary: `v${saved.version} not activated: ${v.local.errors.map((e) => e.message).join("; ")}`, data: { errors: v.local.errors, speech: `I couldn't put those changes live. ${v.local.errors[0]?.message}.` } });
    return { ok: false as const, version: saved.version, errors: v.local.errors, warnings: v.local.warnings };
  }
  const db = getDb();
  const live = { ...saved, status: "active" as const };
  db.prepare("UPDATE profiles SET json = ?, status = 'active' WHERE contractor_id = ? AND version = ?").run(JSON.stringify(live), contractorId, saved.version);
  setActiveVersion(contractorId, saved.version);
  completeTask(task, "done", `v${saved.version} validated and live`, [v.evidenceId]);
  logEvent({ contractorId, agent: "arun", type: "profile.activated", summary: `Owner edits live as v${saved.version}; the phone line uses them from the next call`, data: { speech: `Your changes are live. Sam will use them on the next call.` } });

  let phoneSync: string = "not configured";
  if (vapiConfigured()) {
    phoneSync = await syncAssistant(live).then(
      () => "synced",
      (e: Error) => `failed: ${e.message.slice(0, 80)}`,
    );
  }
  return { ok: true as const, version: saved.version, warnings: v.local.warnings, phoneSync };
}
