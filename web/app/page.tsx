import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
// Verify authentication and current membership before rendering this segment.
export const instant = false;
export default async function Home() {
  redirect(
    (await currentUser())?.email_confirmed_at ? "/workspace" : "/sign-in",
  );
}
