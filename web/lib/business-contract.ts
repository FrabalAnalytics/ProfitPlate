import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { StockLine, SalesLine } from "./inventory-contract";
export type BusinessCommands = {
  save_vendor: {
    id?: string;
    code: string;
    name: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    address?: string;
    is_active: boolean;
  };
  save_vendor_item: {
    id?: string;
    vendor_id: string;
    item_id: string;
    vendor_sku?: string;
    purchase_unit: string;
    base_quantity: string;
    quoted_price?: string;
    conversion_note: string;
    is_active: boolean;
  };
  save_menu_item: {
    id?: string;
    code: string;
    name: string;
    recipe_id: string;
    default_area: "kitchen" | "bar";
    revenue_class?: "food" | "beverage" | "other";
    is_active: boolean;
  };
  create_purchase_order: {
    vendor_id: string;
    reason: string;
    expected_date?: string;
    lines: StockLine[];
  };
  submit_purchase_order: { id: string };
  approve_purchase_order: { id: string };
  reject_purchase_order: { id: string; reason: string };
  cancel_purchase_order: { id: string; reason: string };
  create_purchase_receipt: {
    id: string;
    event_date: string;
    location_id: string;
    reason: string;
    lines: { item_id: string; quantity: string; rejected_quantity?: string }[];
  };
  accept_purchase_receipt: { id: string };
  create_requisition: {
    destination_location_id: string;
    reason: string;
    lines: StockLine[];
  };
  submit_requisition: { id: string };
  approve_requisition: { id: string };
  reject_requisition: { id: string; reason: string };
  close_requisition: { id: string; reason: string };
  fulfil_requisition: {
    id: string;
    event_date: string;
    reason: string;
    lines: StockLine[];
  };
  create_sales_draft: {
    source_system: string;
    event_date: string;
    reason: string;
    lines: SalesLine[];
  };
};
export async function runBusinessCommand<K extends keyof BusinessCommands>(
  client: SupabaseClient<Database>,
  organizationId: string,
  command: K,
  payload: BusinessCommands[K],
  requestId: string,
) {
  const { data, error } = await client.rpc("business_command", {
    p_command: command,
    p_request_id: requestId,
    p_organization_id: organizationId,
    p_payload: payload,
  });
  if (error) throw error;
  const value: unknown = data;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("organization_id" in value) ||
    value.organization_id !== organizationId
  )
    throw new Error("Unexpected business command result");
  return value as { id: string; organization_id: string };
}
