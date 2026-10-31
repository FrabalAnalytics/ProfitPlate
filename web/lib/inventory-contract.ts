import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { DecimalString } from "./database-contract";

export type ItemCategory = "raw_material" | "semi_finished" | "general";
export type ManagerRole = "operations_manager";
export type StockLine = {
  item_id: string;
  quantity: DecimalString;
  unit_cost?: DecimalString;
};
export type SalesLine = {
  net_sales?: DecimalString;
  external_id: string;
  menu_code: string;
  location_id: string;
  quantity: DecimalString;
};
export type InventoryCommands = {
  prepare_areas: Record<string, never>;
  configure_areas: { main_store: string; kitchen: string; bar: string };
  appoint_manager: { user_id: string; manager_role: ManagerRole };
  remove_manager: { user_id: string; reason: string };
  create_period: { starts_on: string; ends_on: string };
  close_period: { id: string; reason: string };
  reopen_period: { id: string; reason: string };
  create_item: {
    sku: string;
    name: string;
    base_uom_code: "g" | "kg" | "ml" | "l" | "each" | "dozen";
    category: ItemCategory;
  };
  create_recipe: {
    code: string;
    name: string;
    kind: "final" | "sub_recipe";
    output_item_id?: string;
    standard_output: DecimalString;
    lines: StockLine[];
  };
  revise_recipe: {
    id: string;
    standard_output: DecimalString;
    lines: StockLine[];
  };
  create_document: {
    kind:
      | "opening"
      | "receipt"
      | "transfer"
      | "waste"
      | "usage"
      | "production"
      | "sales";
    event_date: string;
    reason: string;
    source_location_id?: string;
    destination_location_id?: string;
    recipe_version_id?: string;
    planned_output?: DecimalString;
    actual_output?: DecimalString;
    source_system?: string;
    lines?: StockLine[] | SalesLine[];
  };
  submit_document: { id: string };
  approve_document: { id: string };
  reject_document: { id: string; reason: string };
  receive_transfer: { id: string; reason: string; lines: StockLine[] };
  reject_transfer: { id: string; reason: string; lines: StockLine[] };
  return_transfer: { id: string; reason: string; lines: StockLine[] };
};

export async function runInventoryCommand<K extends keyof InventoryCommands>(
  client: SupabaseClient<Database>,
  organizationId: string,
  command: K,
  payload: InventoryCommands[K],
  requestId: string,
) {
  const { data, error } = await client.rpc("inventory_command", {
    p_command: command,
    p_request_id: requestId,
    p_organization_id: organizationId,
    p_payload: payload,
  });
  if (error) throw error;
  const result: unknown = data;
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !("id" in result) ||
    typeof result.id !== "string" ||
    !("organization_id" in result) ||
    result.organization_id !== organizationId
  )
    throw new Error("Unexpected inventory command result");
  return result as { id: string; organization_id: string; version_id?: string };
}
