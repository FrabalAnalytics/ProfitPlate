import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth/session";

// Verify authentication and current membership before rendering this segment.
export const instant = false;
export const metadata = { title: "Create an account" };
export default async function SignUpPage() {
  if ((await currentUser())?.email_confirmed_at) redirect("/workspace");
  return (
    <AuthShell>
      <h1>A clearer view starts here.</h1>
      <p className="form-intro">
        Create your account. We’ll confirm your email before setting up your
        business.
      </p>
      <AuthForm mode="sign-up" />
    </AuthShell>
  );
}
