import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureSetup } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await ensureSetup();

  const session = await getSession();
  if (!session.isLoggedIn) {
    redirect("/login");
  }

  if (session.role === "ADMIN") {
    redirect("/admin");
  }

  redirect("/candidate");
}
