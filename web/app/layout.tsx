import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingScreen } from "@/components/loading-screen";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ProfitPlate", template: "%s | ProfitPlate" },
  description:
    "A dependable workspace for restaurant inventory and margin intelligence.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Suspense fallback={<LoadingScreen />}>{children}</Suspense>
      </body>
    </html>
  );
}
