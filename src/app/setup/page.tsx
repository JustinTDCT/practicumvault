import { ensureSetupIncomplete } from "@/lib/setup";
import SetupForm from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  await ensureSetupIncomplete();
  return <SetupForm />;
}
