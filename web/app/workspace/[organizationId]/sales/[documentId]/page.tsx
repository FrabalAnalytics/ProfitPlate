import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceRole } from "@/lib/workspace-role";
import { isUuid } from "@/lib/auth/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SalesDocumentReview } from "@/components/sales-document-review";
import {
  BusinessForm,
  hiddenField,
  reasonField,
} from "@/components/business-form";
import { salesRecord as record } from "@/components/sales-review-format";
import { LiveInventoryRefresh } from "@/components/live-inventory-refresh";
import { operationNotice } from "@/lib/operation-notice";
import styles from "@/components/sales-review.module.css";

export const instant = false;
export const metadata = { title: "Sales batch review" };
export default async function SalesBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string; documentId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { organizationId, documentId } = await params;
  if (!isUuid(documentId)) notFound();
  const access = await workspaceRole(organizationId);
  const { saved } = await searchParams;
  const db = await createSupabaseServerClient();
  const { data: doc, error } = await db
    .from("inventory_documents")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", documentId)
    .eq("kind", "sales")
    .maybeSingle();
  if (error) throw new Error("Could not load this sales batch.");
  if (!doc) notFound();
  const [preview, people] = await Promise.all([
    db.rpc("inventory_document_preview", {
      p_organization_id: organizationId,
      p_document_id: documentId,
    }),
    db.rpc("operating_people", { p_organization_id: organizationId }),
  ]);
  if (preview.error || people.error)
    throw new Error("Could not load the sales review.");
  const sales = record(record(preview.data)?.sales);
  const person = (id: string | null) =>
    people.data.find((p) => p.user_id === id)?.display_name ??
    "Former team member";
  const fields = [
    hiddenField("id", doc.id),
    hiddenField("return_to", "sales_review"),
  ];
  return (
    <>
      <nav className={styles.reviewNav} aria-label="Sales navigation">
        <Link
          className="text-link"
          href={`/workspace/${organizationId}/inventory?view=batches`}
        >
          Back to sales batches
        </Link>
        {access.isManager && (
          <Link
            className="text-link"
            href={`/workspace/${organizationId}/approvals`}
          >
            Approval queue
          </Link>
        )}
      </nav>
      {saved && operationNotice[saved] && (
        <p className="notice notice-success" role="status">
          {operationNotice[saved]}
        </p>
      )}
      <article
        className={`panel ${styles.focused}`}
        aria-label={`sales ${doc.reason}`}
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sales batch</p>
            <h1>{doc.reason}</h1>
          </div>
          <span className="role-pill">{doc.status}</span>
        </div>
        {doc.status === "posted" && (
          <p className={styles.basis}>Posted — costs captured at posting.</p>
        )}
        {doc.status !== "posted" && (
          <p className={styles.basis}>
            Recipe costs are estimates until approval. Finance-reconciled actual
            COGS is reported separately.
          </p>
        )}
        {doc.rejection_reason && (
          <p className="notice">Rejection reason: {doc.rejection_reason}</p>
        )}
        <SalesDocumentReview preview={preview.data} />
        <details className={`inventory-details ${styles.audit}`}>
          <summary>Audit information</summary>
          <dl className={styles.meta}>
            <div>
              <dt>Document reference</dt>
              <dd>{doc.id}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{doc.created_at}</dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd>{person(doc.created_by)}</dd>
            </div>
            {doc.approved_by && (
              <div>
                <dt>Reviewed by</dt>
                <dd>{person(doc.approved_by)}</dd>
              </div>
            )}
            {doc.posted_at && (
              <div>
                <dt>Posted</dt>
                <dd>{doc.posted_at}</dd>
              </div>
            )}
          </dl>
        </details>
        {doc.status === "draft" && doc.created_by === access.userId && (
          <section className={styles.actions} aria-label="Sales batch actions">
            <BusinessForm
              organizationId={organizationId}
              intent="submit_document"
              fields={fields}
              button="Submit for approval"
            />
          </section>
        )}
        {doc.status === "submitted" && doc.created_by === access.userId && (
          <p className="notice">
            Waiting for another manager. Self-approval is blocked.
          </p>
        )}
        {doc.status === "submitted" &&
          access.isManager &&
          doc.created_by !== access.userId && (
            <section
              className={styles.actions}
              aria-label="Sales batch actions"
            >
              <p>
                Applies to all {String(sales?.line_count ?? "")} sales{" "}
                {sales?.line_count === 1 ? "line" : "lines"} in this batch.
              </p>
              <BusinessForm
                organizationId={organizationId}
                intent="approve_document"
                fields={fields}
                button="Approve sales and post"
              />
              <details>
                <summary>Reject submission</summary>
                <BusinessForm
                  organizationId={organizationId}
                  intent="reject_document"
                  fields={[...fields, reasonField]}
                  button="Reject sales batch"
                />
              </details>
            </section>
          )}
      </article>
      {doc.status === "submitted" && <LiveInventoryRefresh />}
    </>
  );
}
