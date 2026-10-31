import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Confirm your email" };
export default function CheckEmailPage() {
  return (
    <AuthShell step="ONE MORE STEP">
      <div className="mail-symbol" aria-hidden="true">
        ↗
      </div>
      <h1>Check your inbox.</h1>
      <p className="form-intro">
        Open the confirmation link in the same browser you used to sign up.
        Check your spam folder too.
      </p>
      <div className="subtle-divider" />
      <p className="resend-label">Need a fresh link?</p>
      <AuthForm mode="resend" />
    </AuthShell>
  );
}
