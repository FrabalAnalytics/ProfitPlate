import { AuthShell } from "@/components/auth-shell";
import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Reset your password" };
export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <h1>Let’s get you back in.</h1>
      <p className="form-intro">
        Enter the email you use for ProfitPlate and we’ll send a password reset
        link.
      </p>
      <AuthForm mode="forgot-password" />
    </AuthShell>
  );
}
