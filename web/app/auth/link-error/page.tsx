import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
export const metadata = { title: "Link unavailable" };
export default function LinkErrorPage() {
  return (
    <AuthShell>
      <h1>Let’s try a fresh link.</h1>
      <p className="form-intro">
        This link has expired, has already been used, or was opened in a
        different browser. Request another link and open it in the browser where
        you requested it.
      </p>
      <div className="stack-form">
        <Link href="/check-email" className="button button-primary">
          Resend confirmation
        </Link>
        <Link href="/forgot-password" className="button button-secondary">
          Reset password
        </Link>
        <Link href="/sign-in" className="text-link">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}
