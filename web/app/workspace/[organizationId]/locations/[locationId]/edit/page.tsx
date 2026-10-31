import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { isUuid } from "@/lib/auth/validation";
import { canManageLocations } from "@/lib/locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LocationForm } from "@/components/location-form";

export const instant = false;
export const metadata = { title: "Edit location" };
export default async function EditLocationPage({
  params,
}: {
  params: Promise<{ organizationId: string; locationId: string }>;
}) {
  const { organizationId, locationId } = await params;
  const { membership } = await requireMembership(organizationId);
  if (!canManageLocations(membership.role))
    redirect(`/workspace/${organizationId}/locations`);
  if (!isUuid(locationId)) notFound();
  const supabase = await createSupabaseServerClient();
  const { data: location, error } = await supabase
    .from("locations")
    .select("id, code, name, is_active")
    .eq("organization_id", organizationId)
    .eq("id", locationId)
    .maybeSingle();
  if (error)
    throw new Error("We could not load this location. Please try again.");
  if (!location) notFound();
  return (
    <>
      <Link
        className="text-link location-back"
        href={`/workspace/${organizationId}/locations`}
      >
        ← All locations
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">KEEP YOUR BUSINESS DETAILS CURRENT</p>
          <h1>Edit location</h1>
          <p>Update the name, code, or availability of this location.</p>
        </div>
      </div>
      <section
        className="panel location-form-panel"
        aria-label="Edit location details"
      >
        <LocationForm
          organizationId={organizationId}
          requestId={randomUUID()}
          location={location}
        />
      </section>
    </>
  );
}
