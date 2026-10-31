import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/auth/session";

// Verify authentication and current membership before rendering this segment.
export const instant = false;
export const metadata = { title: "Sign in" };
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string }>;
}) {
  const user = await currentUser();
  if (user?.email_confirmed_at) redirect("/workspace");
  const params = await searchParams;
  return (
    <AuthShell>
      <h1>Welcome back.</h1>
      <p className="form-intro">Sign in to your restaurant’s workspace.</p>
      {params.password === "updated" && (
        <p className="notice notice-success" role="status">
          Your password has been updated. Sign in with your new password.
        </p>
      )}
      <AuthForm mode="sign-in" />
      <div className="auth-secondary">
        <span>Waiting for a confirmation email?</span>
        <Link href="/check-email">Request a new link</Link>
      </div>
    </AuthShell>
  );
}
