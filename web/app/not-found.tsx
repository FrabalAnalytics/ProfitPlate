import Link from "next/link";
export default function NotFoundPage() {
  return (
    <main id="main" className="status-page">
      <p className="eyebrow">PAGE UNAVAILABLE</p>
      <h1>Let’s find your workspace.</h1>
      <p>This page is unavailable or you don’t have access to it.</p>
      <Link href="/workspace" className="button button-primary">
        Go to your workspace
      </Link>
    </main>
  );
}
