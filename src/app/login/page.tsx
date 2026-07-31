import { ensureSetupCompleteForLogin } from "@/lib/setup";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await ensureSetupCompleteForLogin();
  return <LoginForm />;
}
