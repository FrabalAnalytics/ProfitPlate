import Link from "next/link";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand${light ? " brand-light" : ""}`}
      aria-label="ProfitPlate home"
    >
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path
            d="M7 23V9h10a6 6 0 0 1 0 12h-5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m15 15 4-4 5 5"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>
        ProfitPlate<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Check() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m5 12 4 4L19 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
