import Link from "next/link";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
// Verify authentication and current membership before rendering this segment.
export const instant = false;
export const metadata = { title: "Choose a new password" };
export default async function UpdatePasswordPage() {
  const user = await requireUser();
  const recovery =
    (await cookies()).get("pp-password-recovery")?.value === user.id;
  return (
    <AuthShell>
      <h1>Make a fresh start.</h1>
      {recovery ? (
        <>
          <p className="form-intro">
            Choose a new password to secure your account.
          </p>
          <AuthForm mode="update-password" />
        </>
      ) : (
        <>
          <p className="form-intro">
            Request a password reset link to change your password.
          </p>
          <Link className="button button-primary" href="/forgot-password">
            Request a reset link
          </Link>
        </>
      )}
    </AuthShell>
  );
}
