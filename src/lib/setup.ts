import { redirect } from "next/navigation";
import { getOrganization } from "@/lib/attempts/service";

export async function ensureSetup() {
  const org = await getOrganization();
  if (!org?.setupComplete) {
    redirect("/setup");
  }
  return org;
}

export async function ensureSetupCompleteForLogin() {
  const org = await getOrganization();
  if (!org?.setupComplete) {
    redirect("/setup");
  }
}

export async function ensureSetupIncomplete() {
  const org = await getOrganization();
  if (org?.setupComplete) {
    redirect("/login");
  }
}
