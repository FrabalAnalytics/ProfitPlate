"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function LiveInventoryRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p className="field-help">
      Updates automatically every 15 seconds while this page is open.
    </p>
  );
}
