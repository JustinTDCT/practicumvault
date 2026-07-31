import { redirect } from "next/navigation";
import { ensureSetup } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await ensureSetup();
  return children;
}
