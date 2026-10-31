"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { isUuid } from "@/lib/auth/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  runInventoryCommand,
  type InventoryCommands,
  type ItemCategory,
  type ManagerRole,
} from "@/lib/inventory-contract";
import { parseSalesCsv } from "@/lib/sales-csv";
import {
  runBusinessCommand,
  type BusinessCommands,
} from "@/lib/business-contract";
import { runDatabaseCommand, type NonOwnerRole } from "@/lib/database-contract";

export type OperationState = {
  error?: string;
  invitationCode?: string;
  expiresAt?: string;
};
export type OperationIntent =
  | "create_action"
  | "update_action"
  | "assign_duty"
  | "remove_duty"
  | "create_count"
  | "submit_count"
  | "approve_count"
  | "reject_count"
  | "reconcile"
  | "approve_reconciliation"
  | "reject_reconciliation"
  | "publish"
  | keyof InventoryCommands
  | keyof BusinessCommands
  | "import_sales"
  | "invite_member"
  | "replace_invitation"
  | "revoke_invitation"
  | "change_member_role"
  | "suspend_member"
  | "reactivate_member"
  | "supersede_conversion"
  | "retire_conversion";
export async function operate(
  organizationId: string,
  intent: OperationIntent,
  _state: OperationState,
  form: FormData,
): Promise<OperationState> {
  await requireMembership(organizationId);
  const requestId = form.get("request_id");
  if (!isUuid(requestId)) return { error: "Reload this form and try again." };
  const value = (key: string) =>
    typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  const itemIds = form.getAll("line_item_id");
  const quantities = form.getAll("line_quantity");
  const costs = form.getAll("line_unit_cost");
  const lines = itemIds.map((id, i) => ({
    item_id: String(id),
    quantity: String(quantities[i] ?? ""),
    ...(costs.length ? { unit_cost: String(costs[i] ?? "") } : {}),
  }));
  const supabase = await createSupabaseServerClient();
  let destination: string | undefined;
  let inventoryNotice: string = intent;
  try {
    switch (intent) {
      case "create_action":
      case "update_action": {
        const payload =
          intent === "create_action"
            ? {
                title: value("title"),
                assigned_to: value("assigned_to"),
                priority: value("priority"),
                due_on: value("due_on"),
                evidence_reference: value("evidence_reference"),
              }
            : {
                id: value("id"),
                status: value("status"),
                reason: value("reason"),
              };
        const { error } = await supabase.rpc("action_command", {
          p_command: intent,
          p_organization_id: organizationId,
          p_request_id: requestId,
          p_payload: payload,
        });
        if (error) throw error;
        destination = `reports?section=actions&start=${encodeURIComponent(value("starts_on"))}&end=${encodeURIComponent(value("ends_on"))}`;
        break;
      }
      case "assign_duty":
      case "remove_duty":
      case "create_count":
      case "submit_count":
      case "approve_count":
      case "reject_count": {
        const payload =
          intent === "create_count"
            ? {
                location_id: value("location_id"),
                reason: value("reason"),
                lines: lines.map(({ item_id, quantity }) => ({
                  item_id,
                  quantity,
                })),
              }
            : ["assign_duty", "remove_duty"].includes(intent)
              ? {
                  user_id: value("user_id"),
                  role: value("role"),
                  reason: value("reason"),
                }
              : {
                  id: value("id"),
                  ...(intent === "reject_count"
                    ? { reason: value("reason") }
                    : {}),
                };
        const { error } = await supabase.rpc("control_command", {
          p_command: intent,
          p_request_id: requestId,
          p_organization_id: organizationId,
          p_payload: payload,
        });
        if (error) throw error;
        destination = ["assign_duty", "remove_duty"].includes(intent)
          ? "team"
          : "counts";
        break;
      }
      case "reconcile":
      case "approve_reconciliation":
      case "reject_reconciliation":
      case "publish": {
        const payload =
          intent === "reconcile"
            ? {
                starts_on: value("starts_on"),
                ends_on: value("ends_on"),
                expected_sales_lines: value("expected_sales_lines"),
                net_sales: value("net_sales"),
                actual_cogs: value("actual_cogs"),
                ...(value("actual_food_cost")
                  ? { actual_food_cost: value("actual_food_cost") }
                  : {}),
                evidence_reference: value("evidence_reference"),
                reason: value("reason"),
              }
            : intent === "publish"
              ? {
                  starts_on: value("starts_on"),
                  ends_on: value("ends_on"),
                  ...(value("location_id")
                    ? { location_id: value("location_id") }
                    : {}),
                  reason: value("reason"),
                }
              : {
                  id: value("id"),
                  ...(intent === "reject_reconciliation"
                    ? { reason: value("reason") }
                    : {}),
                };
        const { error } = await supabase.rpc("reporting_command", {
          p_command: intent,
          p_request_id: requestId,
          p_organization_id: organizationId,
          p_payload: payload,
        });
        if (error) throw error;
        const reportSection =
          intent === "publish"
            ? "published"
            : intent === "reconcile" || intent === "reject_reconciliation"
              ? "finance"
              : "overview";
        destination = `reports?section=${reportSection}&start=${encodeURIComponent(value("starts_on"))}&end=${encodeURIComponent(value("ends_on"))}`;
        break;
      }
      case "invite_member":
      case "replace_invitation": {
        const invitation =
          intent === "invite_member"
            ? await runDatabaseCommand(
                supabase,
                "invite",
                organizationId,
                {
                  email: value("email").toLowerCase(),
                  role: value("role") as NonOwnerRole,
                },
                requestId,
              )
            : await runDatabaseCommand(
                supabase,
                "resend_invitation",
                organizationId,
                { id: value("id") },
                requestId,
              );
        const id = invitation.id;
        const { data, error } = await supabase.rpc("issue_manual_invitation", {
          p_organization_id: organizationId,
          p_invitation_id: id,
        });
        if (error) throw error;
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          typeof data.code !== "string"
        )
          throw new Error("Invalid invitation response");
        revalidatePath(`/workspace/${organizationId}/team`);
        return {
          invitationCode: data.code,
          expiresAt:
            typeof data.expires_at === "string" ? data.expires_at : undefined,
        };
      }
      case "revoke_invitation":
        await runDatabaseCommand(
          supabase,
          intent,
          organizationId,
          { id: value("id"), reason: value("reason") },
          requestId,
        );
        destination = "team";
        break;
      case "change_member_role":
        await runDatabaseCommand(
          supabase,
          intent,
          organizationId,
          {
            user_id: value("user_id"),
            role: value("role") as NonOwnerRole,
            reason: value("reason"),
          },
          requestId,
        );
        destination = "team";
        break;
      case "suspend_member":
      case "reactivate_member":
        await runDatabaseCommand(
          supabase,
          intent,
          organizationId,
          { user_id: value("user_id"), reason: value("reason") },
          requestId,
        );
        destination = "team";
        break;
      case "save_vendor":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          {
            ...(value("id") ? { id: value("id") } : {}),
            code: value("code"),
            name: value("name"),
            contact_name: value("contact_name"),
            email: value("email"),
            phone: value("phone"),
            address: value("address"),
            is_active: value("is_active") !== "false",
          },
          requestId,
        );
        destination = "masters?view=vendors";
        break;
      case "save_vendor_item":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          {
            ...(value("id") ? { id: value("id") } : {}),
            vendor_id: value("vendor_id"),
            item_id: value("item_id"),
            vendor_sku: value("vendor_sku"),
            purchase_unit: value("purchase_unit"),
            base_quantity: value("base_quantity"),
            ...(value("quoted_price")
              ? { quoted_price: value("quoted_price") }
              : {}),
            conversion_note: value("conversion_note"),
            is_active: value("is_active") !== "false",
          },
          requestId,
        );
        destination = "masters?view=vendor_items";
        break;
      case "save_menu_item":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          {
            ...(value("id") ? { id: value("id") } : {}),
            code: value("code"),
            name: value("name"),
            recipe_id: value("recipe_id"),
            default_area: value("default_area") as "kitchen" | "bar",
            ...(value("revenue_class")
              ? {
                  revenue_class: value("revenue_class") as
                    "food" | "beverage" | "other",
                }
              : {}),
            is_active: value("is_active") !== "false",
          },
          requestId,
        );
        destination = "masters?view=menu";
        break;
      case "create_purchase_order":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          {
            vendor_id: value("vendor_id"),
            reason: value("reason"),
            ...(value("expected_date")
              ? { expected_date: value("expected_date") }
              : {}),
            lines,
          },
          requestId,
        );
        destination = "purchasing";
        break;
      case "submit_purchase_order":
      case "approve_purchase_order":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          { id: value("id") },
          requestId,
        );
        destination = "purchasing";
        break;
      case "reject_purchase_order":
      case "cancel_purchase_order":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          { id: value("id"), reason: value("reason") },
          requestId,
        );
        destination = "purchasing";
        break;
      case "create_purchase_receipt": {
        const rejected = form.getAll("line_rejected_quantity");
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          {
            id: value("id"),
            event_date: value("event_date"),
            location_id: value("location_id"),
            reason: value("reason"),
            lines: lines.map((l, i) => ({
              item_id: l.item_id,
              quantity: l.quantity,
              rejected_quantity: String(rejected[i] ?? "0"),
            })),
          },
          requestId,
        );
        destination = "purchasing?received=1";
        break;
      }
      case "accept_purchase_receipt": {
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          { id: value("id") },
          requestId,
        );
        destination = "purchasing?received=1";
        break;
      }
      case "create_requisition":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          {
            destination_location_id: value("destination_location_id"),
            reason: value("reason"),
            lines: lines.map(({ item_id, quantity }) => ({
              item_id,
              quantity,
            })),
          },
          requestId,
        );
        destination = "requests";
        break;
      case "submit_requisition":
      case "approve_requisition":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          { id: value("id") },
          requestId,
        );
        destination = "requests";
        break;
      case "reject_requisition":
      case "close_requisition":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          { id: value("id"), reason: value("reason") },
          requestId,
        );
        destination = "requests";
        break;
      case "fulfil_requisition":
        await runBusinessCommand(
          supabase,
          organizationId,
          intent,
          {
            id: value("id"),
            event_date: value("event_date"),
            reason: value("reason"),
            lines: lines.map(({ item_id, quantity }) => ({
              item_id,
              quantity,
            })),
          },
          requestId,
        );
        destination = "requests";
        break;
      case "create_sales_draft":
        return { error: "Use the validated sales import screen." };
      case "supersede_conversion":
        await runDatabaseCommand(
          supabase,
          intent,
          organizationId,
          {
            item_id: value("item_id"),
            source_uom_code: value(
              "source_uom_code",
            ) as InventoryCommands["create_item"]["base_uom_code"],
            factor: value("factor"),
            ...(value("supporting_note")
              ? { supporting_note: value("supporting_note") }
              : {}),
          },
          requestId,
        );
        destination = "masters?view=units";
        break;
      case "retire_conversion":
        await runDatabaseCommand(
          supabase,
          intent,
          organizationId,
          { id: value("id"), reason: value("reason") },
          requestId,
        );
        destination = "masters?view=units";
        break;
      case "import_sales": {
        let rows;
        try {
          rows = parseSalesCsv(value("csv"));
        } catch (e) {
          return {
            error: e instanceof Error ? e.message : "Invalid CSV file.",
          };
        }
        const { data: locations, error } = await supabase
          .from("locations")
          .select("id,name,code")
          .eq("organization_id", organizationId)
          .eq("is_active", true);
        if (error) throw error;
        const lines = [];
        for (const row of rows) {
          const matches = locations.filter(
            (l) =>
              l.id === row.location ||
              l.code === row.location.toUpperCase() ||
              l.name.toLowerCase() === row.location.toLowerCase(),
          );
          if (matches.length !== 1)
            return {
              error: `Location “${row.location}” is missing or ambiguous. Use its exact location code.`,
            };
          lines.push({
            external_id: row.external_id,
            menu_code: row.menu_code,
            quantity: row.quantity,
            location_id: matches[0].id,
            ...(row.net_sales !== undefined
              ? { net_sales: row.net_sales }
              : {}),
          });
        }
        const sale = await runBusinessCommand(
          supabase,
          organizationId,
          "create_sales_draft",
          {
            event_date: value("event_date"),
            reason: value("reason"),
            source_system: value("source_system"),
            lines,
          },
          requestId,
        );
        destination = `sales/${sale.id}`;
        break;
      }
      case "prepare_areas":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          {},
          requestId,
        );
        break;
      case "configure_areas":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          {
            main_store: value("main_store"),
            kitchen: value("kitchen"),
            bar: value("bar"),
          },
          requestId,
        );
        break;
      case "create_item":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          {
            name: value("name"),
            sku: value("sku"),
            base_uom_code: value(
              "base_uom_code",
            ) as InventoryCommands["create_item"]["base_uom_code"],
            category: value("category") as ItemCategory,
          },
          requestId,
        );
        break;
      case "appoint_manager":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          {
            user_id: value("user_id"),
            manager_role: value("manager_role") as ManagerRole,
          },
          requestId,
        );
        break;
      case "remove_manager":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          { user_id: value("user_id"), reason: value("reason") },
          requestId,
        );
        break;
      case "create_period":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          { starts_on: value("starts_on"), ends_on: value("ends_on") },
          requestId,
        );
        break;
      case "close_period":
      case "reopen_period":
      case "reject_document":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          { id: value("id"), reason: value("reason") },
          requestId,
        );
        break;
      case "submit_document":
      case "approve_document":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          { id: value("id") },
          requestId,
        );
        if (intent === "approve_document") {
          const { data } = await supabase
            .from("inventory_documents")
            .select("kind")
            .eq("organization_id", organizationId)
            .eq("id", value("id"))
            .single();
          inventoryNotice =
            data?.kind === "sales"
              ? "sales_posted"
              : data?.kind === "transfer"
                ? "transfer_dispatched"
                : "document_posted";
        }
        break;
      case "receive_transfer":
      case "reject_transfer":
      case "return_transfer":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          { id: value("id"), reason: value("reason"), lines },
          requestId,
        );
        break;
      case "create_recipe":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          {
            code: value("code"),
            name: value("name"),
            kind: value("kind") as "final" | "sub_recipe",
            ...(value("output_item_id")
              ? { output_item_id: value("output_item_id") }
              : {}),
            standard_output: value("standard_output"),
            lines: lines.map(({ item_id, quantity }) => ({
              item_id,
              quantity,
            })),
          },
          requestId,
        );
        break;
      case "revise_recipe":
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          {
            id: value("id"),
            standard_output: value("standard_output"),
            lines: lines.map(({ item_id, quantity }) => ({
              item_id,
              quantity,
            })),
          },
          requestId,
        );
        break;
      case "create_document": {
        const kind = value(
          "kind",
        ) as InventoryCommands["create_document"]["kind"];
        if (kind === "sales")
          return {
            error:
              "Sales imports require the validated import preview. This form cannot post imported sales.",
          };
        await runInventoryCommand(
          supabase,
          organizationId,
          intent,
          {
            kind,
            event_date: value("event_date"),
            reason: value("reason"),
            ...(value("source_location_id")
              ? { source_location_id: value("source_location_id") }
              : {}),
            ...(value("destination_location_id")
              ? { destination_location_id: value("destination_location_id") }
              : {}),
            ...(kind === "production"
              ? {
                  recipe_version_id: value("recipe_version_id"),
                  planned_output: value("planned_output"),
                  actual_output: value("actual_output"),
                }
              : { lines }),
          },
          requestId,
        );
        break;
      }
      default:
        return { error: "This operation is not available." };
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    const message =
      error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
    if (message.startsWith("Complete pending deliveries"))
      return {
        error:
          "Complete this item's pending deliveries or confirm rejected returns to Store before recording or approving its source count. No adjustment was posted.",
      };
    if (message === "Insufficient unreserved source stock")
      return {
        error:
          "There is not enough available stock. Quantities already reserved for other deliveries cannot be dispatched again.",
      };
    if (
      message === "Quantity exceeds pending delivery" ||
      message === "Return exceeds rejected quantity"
    )
      return {
        error:
          "This quantity exceeds the remaining delivery or rejected return. Refresh the delivery and check quantities; no changes were saved.",
      };
    if (message.includes("code has already been issued"))
      return {
        error:
          "An access code was already generated. Use Replace access code to invalidate it and issue a new one.",
      };
    if (
      message ===
      "Stock moved after the count cutoff; recount before adjustment"
    )
      return {
        error:
          "Stock moved after this count was captured. Record a new physical count before adjusting; no adjustment was posted.",
      };
    if (
      message ===
      "Reconcile POS line count, net sales and pending documents before submission"
    )
      return {
        error:
          "The POS line count or net sales does not match the posted imports, or documents are still pending. Resolve the differences before submitting.",
      };
    if (message === "Report evidence changed; submit a fresh reconciliation")
      return {
        error:
          "Report evidence has changed since this reconciliation was prepared. Reject it and submit a fresh reconciliation.",
      };
    if (message === "Reconcile completed business dates only")
      return {
        error:
          "Choose a completed business date range before reconciling actual COGS.",
      };
    if (
      message.includes("exceeds outstanding") ||
      message.includes("exceeds approved")
    )
      return {
        error:
          "This quantity exceeds the outstanding approved amount. No stock changes were posted.",
      };
    if (
      message === "Active menu item mapping required" ||
      message === "Sales require active, validated menu mappings"
    )
      return {
        error:
          "Map every sales code to an active final recipe in the Menu master, then validate the import again.",
      };
    if (message === "Self approval is forbidden")
      return {
        error:
          "Another Operations Manager must approve this submission. You cannot approve your own.",
      };
    if (
      message === "Posting requires an open inventory period" ||
      message === "Current receipt period must be open" ||
      message === "Current receiving period must be open"
    )
      return {
        error:
          "This date is in a closed or unconfigured period. A manager must open the period before posting.",
      };
    if (message.includes("Insufficient stock"))
      return {
        error:
          "There is not enough stock at the selected location. No movements were posted.",
      };
    if (message === "Only an Operations Manager can reopen a period")
      return {
        error: "Only an Operations Manager can reopen a closed period.",
      };
    if (code === "42501")
      return {
        error:
          "Your current role cannot perform this action. Manager approval must come from a different person.",
      };
    if (code === "23505")
      return {
        error:
          "That code, item, source reference, or opening balance already exists. Repeated postings are blocked.",
      };
    if (["22023", "23514", "23503", "22P02", "22007", "22008"].includes(code))
      return {
        error:
          "Check the selected items, locations, quantities, recipe and dates. Use supported decimal quantities and distinct operating areas. No changes were saved.",
      };
    return {
      error:
        "We could not confirm the save. Retry with the same details and check the document list before starting another transaction.",
    };
  }
  revalidatePath(`/workspace/${organizationId}`, "layout");
  if (
    value("return_to") === "sales_review" &&
    isUuid(value("id")) &&
    ["submit_document", "approve_document", "reject_document"].includes(intent)
  )
    destination = `sales/${value("id")}`;
  if (
    ["receive_transfer", "reject_transfer", "return_transfer"].includes(
      intent,
    ) &&
    value("return_to") === "requests"
  )
    destination = "requests";
  if (destination === "requests") destination = `requests?completed=${intent}`;
  if (
    ["appoint_manager", "remove_manager"].includes(intent) &&
    value("return_to") === "team"
  )
    destination = "team";
  if (destination)
    redirect(
      `/workspace/${organizationId}/${destination}${destination.includes("?") ? "&" : "?"}saved=${destination.startsWith("sales/") ? inventoryNotice : "1"}`,
    );
  const view = ["create_item"].includes(intent)
    ? "items"
    : ["create_recipe", "revise_recipe"].includes(intent)
      ? "recipes"
      : [
            "prepare_areas",
            "configure_areas",
            "appoint_manager",
            "remove_manager",
            "create_period",
            "close_period",
            "reopen_period",
          ].includes(intent)
        ? "controls"
        : "documents";
  redirect(
    `/workspace/${organizationId}/inventory?view=${view}&saved=${inventoryNotice}`,
  );
}
