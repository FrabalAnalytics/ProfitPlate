import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type MemberRole = 'owner' | 'admin' | 'inventory_manager' | 'procurement_officer' | 'kitchen_lead' | 'bar_lead' | 'accountant' | 'viewer';
export type NonOwnerRole = Exclude<MemberRole, 'owner'>;
// Always pass exact base-10 strings. The database rejects excess precision and rounding.
export type DecimalString = string;
export type CommandPayloads = {
  bootstrap: { name: string };
  update_organization: { name: string };
  create_location: { code: string; name: string };
  update_location: { id: string; code: string; name: string; is_active: boolean };
  create_item: { sku: string; name: string; base_uom_code: 'g' | 'kg' | 'ml' | 'l' | 'each' | 'dozen' };
  update_item: { id: string; sku: string; name: string; is_active: boolean };
  supersede_conversion: { item_id: string; source_uom_code: CommandPayloads['create_item']['base_uom_code']; factor: DecimalString; supporting_note?: string };
  retire_conversion: { id: string; reason: string };
  invite: { email: string; role: NonOwnerRole };
  resend_invitation: { id: string };
  revoke_invitation: { id: string; reason: string };
  accept_invitation: { id: string; token: string };
  change_member_role: { user_id: string; role: NonOwnerRole; reason: string };
  suspend_member: { user_id: string; reason: string };
  reactivate_member: { user_id: string; reason: string };
  transfer_ownership: { user_id: string; reason: string };
};
export type CommandName = keyof CommandPayloads;
export type CommandResult<K extends CommandName> = K extends 'bootstrap'
  ? { organization_id: string }
  : { id: string; organization_id: string };

/** Keep the same requestId and payload when retrying a command. Never log invitation tokens. */
export async function runDatabaseCommand<K extends CommandName>(
  client: SupabaseClient<Database>,
  command: K,
  organizationId: K extends 'bootstrap' ? null : string,
  payload: CommandPayloads[K],
  requestId: string,
): Promise<CommandResult<K>> {
  const { data, error } = await client.rpc('profitplate_command', {
    p_command: command,
    p_request_id: requestId,
    ...(organizationId === null ? {} : { p_organization_id: organizationId }),
    p_payload: payload,
  });
  if (error) throw error;
  // JSON-returning RPCs are validated at the boundary, independently of SDK inference.
  const result: unknown = data;
  if (result === null || typeof result !== 'object' || Array.isArray(result) || !('organization_id' in result) || typeof result.organization_id !== 'string') {
    throw new Error('Unexpected database command result');
  }
  if (command !== 'bootstrap' && (!('id' in result) || typeof result.id !== 'string')) throw new Error('Database command returned no record ID');
  return result as CommandResult<K>;
}
