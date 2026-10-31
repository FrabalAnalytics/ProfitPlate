import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { canManageLocations } from "@/lib/locations";
import { LocationForm } from "@/components/location-form";

export const instant = false;
export const metadata = { title: "Add location" };
export default async function NewLocationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  const { membership } = await requireMembership(organizationId);
  if (!canManageLocations(membership.role))
    redirect(`/workspace/${organizationId}/locations`);
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
          <p className="eyebrow">BUILD YOUR OPERATING FOUNDATION</p>
          <h1>Add a location</h1>
          <p>Give your team a clear place to work with stock.</p>
        </div>
      </div>
      <section className="panel location-form-panel" aria-label="New location">
        <LocationForm
          organizationId={organizationId}
          requestId={randomUUID()}
        />
      </section>
    </>
  );
}
