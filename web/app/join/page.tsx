import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth/session";
import { AuthShell } from "@/components/auth-shell";
import { JoinBusinessForm } from "@/components/join-business-form";
export const instant = false;
export const metadata = { title: "Join a business" };
export default async function JoinBusiness() {
  const user = await requireUser();
  return (
    <AuthShell>
      <h1>Join your team.</h1>
      <p className="form-intro">
        Signed in as {user.email}. Use the access code provided for this email
        account.
      </p>
      <JoinBusinessForm requestId={randomUUID()} />
      <p className="auth-bottom-link">
        <Link href="/workspace">Return to your workspace</Link>
      </p>
    </AuthShell>
  );
}
