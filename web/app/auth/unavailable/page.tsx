import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { startFreshSignIn } from "@/app/auth/actions";
export const instant = false;
export const metadata = { title: "Account service temporarily unavailable" };
export default async function AuthUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const reason = (await searchParams).reason;
  const limited = reason === "rate-limit";
  const clock = reason === "clock";
  return (
    <AuthShell>
      <h1>
        {clock
          ? "Check the computer’s clock."
          : limited
            ? "Let’s give it a moment."
            : "We couldn’t reach your account."}
      </h1>
      <p className="form-intro" role="status">
        {clock
          ? "The computer running ProfitPlate has an incorrect clock, which makes new sessions appear expired. Enable automatic date and time on that computer and synchronize it, then return to sign in."
          : limited
            ? "The account service is temporarily limiting requests. Wait a few minutes before trying again. Repeated attempts can delay recovery."
            : "The account service is temporarily unavailable. Please try again shortly."}{" "}
        Your saved business information is preserved.
      </p>
      <Link className="button button-primary" href="/sign-in" prefetch={false}>
        Return to sign in
      </Link>
      <form action={startFreshSignIn} style={{ marginTop: 18 }}>
        <button className="text-link" type="submit">
          Start a fresh sign-in
        </button>
        <p className="field-help">
          Clears this browser’s old session without changing your account or
          password.
        </p>
      </form>
    </AuthShell>
  );
}
