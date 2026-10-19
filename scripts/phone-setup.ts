/**
 * Point your free Vapi number at this server and sync the saved assistants.
 *   npm run phone:setup
 * Needs VAPI_API_KEY, VAPI_SERVER_SECRET and PUBLIC_BASE_URL in .env.local.
 */
import { INTAKES } from "../lib/fixtures";
import { activeProfile } from "../lib/storage/repo";
import { listPhoneNumbers, routeNumberToServer, syncAssistant, vapiConfigured } from "../lib/phone/vapiApi";

async function main() {
  if (!vapiConfigured()) {
    console.error("Set VAPI_API_KEY, VAPI_SERVER_SECRET and PUBLIC_BASE_URL in .env.local first.");
    process.exit(1);
  }
  const health = await fetch(`${process.env.PUBLIC_BASE_URL}/api/phone/line`).catch(() => null);
  if (!health?.ok) console.warn(`⚠ ${process.env.PUBLIC_BASE_URL} is not reachable. Start the app and the tunnel first.`);

  const numbers = await listPhoneNumbers();
  if (numbers.length === 0) {
    console.error("No Vapi phone number yet. Dashboard → Phone Numbers → Create Phone Number → Free Vapi Number, then rerun.");
    process.exit(1);
  }
  const target = numbers.find((n) => n.id === process.env.VAPI_PHONE_NUMBER_ID) ?? numbers[0];
  await routeNumberToServer(target.id);
  console.log(`✓ ${target.number ?? target.id} now asks ${process.env.PUBLIC_BASE_URL}/api/vapi for its assistant on every call.`);

  for (const i of INTAKES) {
    const p = activeProfile(i.contractorId);
    if (!p) {
      console.log(`- ${i.businessName}: not active yet (approve it in Business setup), skipped`);
      continue;
    }
    console.log(`✓ ${i.businessName}: browser test assistant ${await syncAssistant(p)}`);
  }
  console.log(`\nAdd to .env.local so the portal shows it:\nVAPI_PHONE_NUMBER=${target.number ?? ""}\nVAPI_PHONE_NUMBER_ID=${target.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
