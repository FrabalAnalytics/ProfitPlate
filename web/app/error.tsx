"use client";
import Link from "next/link";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="status-page">
      <p className="eyebrow">LET’S GET BACK ON TRACK</p>
      <h1>We couldn’t load this page.</h1>
      <p>Please try again. Your saved business information is preserved.</p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
      <Link href="/sign-in" className="text-link">
        Return to sign in
      </Link>
    </main>
  );
}
