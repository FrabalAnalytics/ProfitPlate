import Link from "next/link";
import { requireMembership } from "@/lib/auth/session";
import { canManageLocations } from "@/lib/locations";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;
export const metadata = { title: "Locations" };

export default async function LocationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { organizationId } = await params;
  const { membership } = await requireMembership(organizationId);
  const canManage = canManageLocations(membership.role);
  const supabase = await createSupabaseServerClient();
  const { data: locations, error } = await supabase
    .from("locations")
    .select("id, code, name, is_active")
    .eq("organization_id", organizationId)
    .order("is_active", { ascending: false })
    .order("name")
    .order("id");
  if (error)
    throw new Error("We could not load your locations. Please try again.");
  const { saved } = await searchParams;
  const active = locations.filter((location) => location.is_active).length;
  return (
    <>
      <div className="page-heading locations-heading">
        <div>
          <p className="eyebrow">A PLACE FOR EVERY PART OF YOUR BUSINESS</p>
          <h1>Locations</h1>
          <p>Keep your branches, kitchens, bars, and storerooms connected.</p>
        </div>
        {canManage && (
          <Link
            className="button button-primary"
            href={`/workspace/${organizationId}/locations/new`}
          >
            Add location
          </Link>
        )}
      </div>
      {(saved === "created" || saved === "updated") && (
        <p role="status" className="notice notice-success location-notice">
          {saved === "created" ? "Location added." : "Location changes saved."}
        </p>
      )}
      <div className="location-stats" aria-label="Location totals">
        <div>
          <span>All locations</span>
          <strong>{locations.length}</strong>
        </div>
        <div>
          <span>Active</span>
          <strong>{active}</strong>
        </div>
        <div>
          <span>Inactive</span>
          <strong>{locations.length - active}</strong>
        </div>
      </div>
      {!canManage && (
        <p className="location-permissions">
          You can view locations. Ask a business owner or admin to make changes.
        </p>
      )}
      {locations.length === 0 ? (
        <section className="panel location-empty">
          <span className="location-mark" aria-hidden="true">
            ⌂
          </span>
          <h2>Your first location starts here.</h2>
          <p>
            Add a place where your team stores or works with stock, such as Main
            Kitchen or Central Store.
          </p>
          {canManage && (
            <Link
              className="button button-primary"
              href={`/workspace/${organizationId}/locations/new`}
            >
              Add your first location
            </Link>
          )}
        </section>
      ) : (
        <section className="location-grid" aria-label="Business locations">
          {locations.map((location) => (
            <article
              className="panel location-card"
              key={location.id}
              aria-label={location.name}
            >
              <div className="location-card-top">
                <span className="location-mark" aria-hidden="true">
                  ⌂
                </span>
                <span
                  className={`location-status ${location.is_active ? "active" : "inactive"}`}
                >
                  {location.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              <h2>{location.name}</h2>
              <p className="location-code">{location.code}</p>
              <div className="location-card-footer">
                <span>
                  {location.is_active
                    ? "In use by your business"
                    : "Saved for your records"}
                </span>
                {canManage && (
                  <Link
                    className="text-link"
                    href={`/workspace/${organizationId}/locations/${location.id}/edit`}
                    aria-label={`Edit ${location.name}`}
                  >
                    Edit location
                  </Link>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      <p className="panel-footnote">
        Use a separate location for each place you need to track stock
        independently.
      </p>
    </>
  );
}
