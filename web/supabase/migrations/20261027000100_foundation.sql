-- ProfitPlate V0.1. New baseline; not the previously referenced missing SQL.
-- Execute as the migration owner. All application writes use the command RPC.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;

create function private.clean_text(p_value text) returns text
language sql immutable strict set search_path = '' as $$
  select regexp_replace(p_value, '^[[:space:]]+|[[:space:]]+$', '', 'g');
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = private.clean_text(name) and length(name) between 1 and 160),
  currency_code text not null default 'NGN' check (currency_code = 'NGN'),
  timezone text not null default 'Africa/Lagos' check (timezone = 'Africa/Lagos'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner','admin','inventory_manager','kitchen_lead','bar_lead','accountant','viewer')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  check (role <> 'owner' or status = 'active')
);
create unique index one_owner_per_org on public.organization_memberships(organization_id) where role = 'owner';
create unique index one_owned_org_per_user on public.organization_memberships(user_id) where role = 'owner';
create index memberships_user on public.organization_memberships(user_id, organization_id);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check (code = upper(private.clean_text(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'),
  name text not null check (name = private.clean_text(name) and length(name) between 1 and 160),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code), unique (organization_id, id)
);
create table public.units_of_measure (
  code text primary key,
  dimension text not null check (dimension in ('mass','volume','count')),
  reference_factor numeric(24,12) not null check (reference_factor > 0 and reference_factor <= 1000000000)
);
insert into public.units_of_measure values
  ('g','mass',1),('kg','mass',1000),('ml','volume',1),('l','volume',1000),('each','count',1),('dozen','count',12);
create table public.items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  sku text not null check (sku = private.clean_text(sku) and length(sku) between 1 and 64),
  name text not null check (name = private.clean_text(name) and length(name) between 1 and 160),
  base_uom_code text not null references public.units_of_measure(code) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index items_sku on public.items(organization_id, lower(sku));
create unique index items_name on public.items(organization_id, lower(name));
create index items_listing on public.items(organization_id, is_active, id);

create table public.item_conversion_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  item_id uuid not null,
  source_uom_code text not null references public.units_of_measure(code),
  target_uom_code text not null references public.units_of_measure(code),
  factor numeric(24,12) not null check (factor > 0 and factor <= 1000000000),
  revision integer not null check (revision > 0),
  supporting_note text check (length(supporting_note) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  foreign key (organization_id, item_id) references public.items(organization_id, id) on delete restrict,
  unique (organization_id, id), unique (item_id, source_uom_code, revision),
  check (source_uom_code <> target_uom_code),
  check (retired_at is null or retired_at >= created_at)
);
create unique index conversion_active on public.item_conversion_revisions(item_id, source_uom_code) where retired_at is null;
create index conversion_history on public.item_conversion_revisions(organization_id, item_id, created_at, id);
create index conversion_actor on public.item_conversion_revisions(created_by);
-- PostgREST normally serializes numeric as a JSON number. Use this view for decimal-safe reads.
create view public.item_conversion_history with (security_invoker=true) as
  select id,organization_id,item_id,source_uom_code,target_uom_code,factor::text as factor,
    revision,supporting_note,created_by,created_at,retired_at from public.item_conversion_revisions;

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  recipient_email text not null check (recipient_email = lower(private.clean_text(recipient_email)) and length(recipient_email) between 3 and 254 and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  proposed_role text not null check (proposed_role in ('admin','inventory_manager','kitchen_lead','bar_lead','accountant','viewer')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  unique (organization_id, id),
  check (expires_at > created_at),
  check ((status = 'accepted' and accepted_by is not null and accepted_at is not null) or (status <> 'accepted' and accepted_by is null and accepted_at is null)),
  check ((status = 'revoked' and revoked_by is not null and revoked_at is not null) or (status <> 'revoked' and revoked_by is null and revoked_at is null))
);
create unique index invitation_pending on public.organization_invitations(organization_id, recipient_email) where status = 'pending';
create index invitations_inviter on public.organization_invitations(invited_by);
create index invitations_acceptor on public.organization_invitations(accepted_by) where accepted_by is not null;
create index invitations_revoker on public.organization_invitations(revoked_by) where revoked_by is not null;
create table private.invitation_secrets (
  invitation_id uuid primary key references public.organization_invitations(id) on delete restrict,
  token_hash bytea check (octet_length(token_hash) = 32)
);
create table private.invitation_deliveries (
  invitation_id uuid primary key references public.organization_invitations(id) on delete restrict,
  state text not null default 'queued' check (state in ('queued','sending','sent','failed','cancelled')),
  attempts integer not null default 0,
  lease_id uuid,
  lease_until timestamptz,
  last_error_code text,
  updated_at timestamptz not null default now()
);
create table private.command_requests (
  actor_id uuid not null references auth.users(id) on delete restrict,
  scope_id uuid not null,
  command text not null,
  request_id uuid not null,
  payload_hash bytea not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (actor_id, scope_id, command, request_id)
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  request_id uuid not null,
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_timeline on public.audit_events(organization_id, created_at desc, id desc);
create index audit_actor on public.audit_events(organization_id, actor_id, created_at desc, id desc);
create index audit_actor_reference on public.audit_events(actor_id);
create index audit_action on public.audit_events(organization_id, action, created_at desc, id desc);
create index audit_entity on public.audit_events(organization_id, entity_type, entity_id, created_at desc, id desc);

create function private.has_role(p_org uuid, p_roles text[] default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_memberships m
    where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
    and (p_roles is null or m.role = any(p_roles)));
$$;
create function private.require_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from auth.users where id = v_actor and email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'Verified authentication required';
  end if;
  return v_actor;
end; $$;
create function private.require_text(p_data jsonb, p_key text, p_max integer) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := private.clean_text(p_data ->> p_key);
begin
  if jsonb_typeof(p_data -> p_key) is distinct from 'string' or v is null or length(v) not between 1 and p_max then
    raise exception using errcode = '22023', message = 'Invalid field: ' || p_key;
  end if;
  return v;
end; $$;

-- Invariants also protect trusted SQL paths; application grants are not the only guard.
create function private.check_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if tg_table_name = 'organizations' then v_org := new.id;
  elsif tg_op = 'DELETE' then v_org := old.organization_id;
  else v_org := new.organization_id;
  end if;
  if exists (select 1 from public.organizations where id = v_org) and
     (select count(*) from public.organization_memberships where organization_id = v_org and role = 'owner' and status = 'active') <> 1 then
    raise exception using errcode = '23514', message = 'Organization requires exactly one active owner';
  end if;
  return null;
end; $$;
create constraint trigger organization_owner_required after insert on public.organizations
  deferrable initially deferred for each row execute function private.check_owner();
create constraint trigger membership_owner_required after insert or update or delete on public.organization_memberships
  deferrable initially deferred for each row execute function private.check_owner();

create function private.protect_record() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode = '42501', message = 'Historical records cannot be deleted'; end if;
  if tg_table_name = 'audit_events' or tg_table_name = 'units_of_measure' then
    raise exception using errcode = '42501', message = 'Record is immutable';
  end if;
  if new.id <> old.id or new.organization_id <> old.organization_id then
    raise exception using errcode = '23514', message = 'Record identity is immutable';
  end if;
  if tg_table_name = 'items' then
    if new.base_uom_code <> old.base_uom_code then
      raise exception using errcode = '23514', message = 'Base unit is immutable';
    end if;
  end if;
  if tg_table_name = 'organization_memberships' then
    if new.user_id <> old.user_id then
      raise exception using errcode = '23514', message = 'Membership identity is immutable';
    end if;
  end if;
  if tg_table_name = 'item_conversion_revisions' then
    if (to_jsonb(new) - 'retired_at') is distinct from (to_jsonb(old) - 'retired_at') or old.retired_at is not null or new.retired_at is null then
      raise exception using errcode = '23514', message = 'Conversion revisions are immutable except one-way retirement';
    end if;
  end if;
  return new;
end; $$;
create trigger items_protect before update or delete on public.items for each row execute function private.protect_record();
create trigger locations_protect before update or delete on public.locations for each row execute function private.protect_record();
create trigger memberships_protect before update or delete on public.organization_memberships for each row execute function private.protect_record();
create trigger conversions_protect before update or delete on public.item_conversion_revisions for each row execute function private.protect_record();
create trigger audit_protect before update or delete on public.audit_events for each row execute function private.protect_record();
create trigger units_protect before update or delete on public.units_of_measure for each row execute function private.protect_record();

create function private.validate_conversion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_base text; v_source_dim text; v_target_dim text;
begin
  select base_uom_code into v_base from public.items where id = new.item_id and organization_id = new.organization_id;
  select dimension into v_source_dim from public.units_of_measure where code = new.source_uom_code;
  select dimension into v_target_dim from public.units_of_measure where code = new.target_uom_code;
  if v_base is null or new.target_uom_code <> v_base or v_source_dim = v_target_dim then
    raise exception using errcode = '23514', message = 'Conversion must cross dimensions and target the item base unit';
  end if;
  if v_source_dim in ('mass','volume') and v_target_dim in ('mass','volume') and new.supporting_note is null then
    raise exception using errcode = '23514', message = 'Mass/volume conversion requires item-specific evidence';
  end if;
  return new;
end; $$;
create trigger conversion_validate before insert on public.item_conversion_revisions for each row execute function private.validate_conversion();

-- One transactional entry point; no client-provided actor or arbitrary table mutation.
create function public.profitplate_command(
  p_command text, p_request_id uuid, p_organization_id uuid default null, p_payload jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_actor();
  v_scope uuid := coalesce(p_organization_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_hash bytea; v_saved private.command_requests%rowtype;
  v_role text; v_id uuid; v_result jsonb; v_details jsonb := '{}'; v_entity text;
  v_allowed text[]; v_target public.organization_memberships%rowtype;
  v_inv public.organization_invitations%rowtype; v_item public.items%rowtype;
  v_text text; v_email text; v_token text; v_revision integer; v_factor numeric; v_recipient uuid;
  v_before jsonb; v_after jsonb;
begin
  if p_request_id is null or p_command is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 16384 then
    raise exception using errcode = '22023', message = 'Invalid command envelope';
  end if;
  v_allowed := case p_command
    when 'bootstrap' then array['name']
    when 'update_organization' then array['name']
    when 'create_location' then array['code','name']
    when 'update_location' then array['id','code','name','is_active']
    when 'create_item' then array['sku','name','base_uom_code']
    when 'update_item' then array['id','sku','name','is_active']
    when 'supersede_conversion' then array['item_id','source_uom_code','factor','supporting_note']
    when 'retire_conversion' then array['id','reason']
    when 'invite' then array['email','role']
    when 'resend_invitation' then array['id']
    when 'revoke_invitation' then array['id','reason']
    when 'accept_invitation' then array['id','token']
    when 'change_member_role' then array['user_id','role','reason']
    when 'suspend_member' then array['user_id','reason']
    when 'reactivate_member' then array['user_id','reason']
    when 'transfer_ownership' then array['user_id','reason']
    else null end;
  if v_allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not (k = any(v_allowed))) then
    raise exception using errcode = '22023', message = 'Unknown command or payload field';
  end if;
  if p_command = 'bootstrap' then
    if p_organization_id is not null then raise exception using errcode = '22023', message = 'Bootstrap has no organization context'; end if;
    perform pg_advisory_xact_lock(2701001);
  else
    -- Lock before checking authority: suspension/role changes serialize with commands.
    perform 1 from public.organizations where id = p_organization_id for update;
    if not found then raise exception using errcode = '42501', message = 'Organization access denied'; end if;
    if p_command <> 'accept_invitation' then
      select role into v_role from public.organization_memberships where organization_id = p_organization_id and user_id = v_actor and status = 'active';
      if v_role is null then raise exception using errcode = '42501', message = 'Organization access denied'; end if;
      if p_command in ('create_item','update_item','supersede_conversion','retire_conversion') then
        if v_role not in ('owner','admin','inventory_manager') then raise exception using errcode = '42501', message = 'Master data editing denied'; end if;
      elsif v_role not in ('owner','admin') then
        raise exception using errcode = '42501', message = 'Administration denied';
      end if;
    end if;
  end if;
  v_hash := sha256(convert_to(p_payload::text, 'UTF8'));
  insert into private.command_requests(actor_id,scope_id,command,request_id,payload_hash)
    values(v_actor,v_scope,p_command,p_request_id,v_hash) on conflict do nothing;
  select * into v_saved from private.command_requests where actor_id=v_actor and scope_id=v_scope and command=p_command and request_id=p_request_id for update;
  if v_saved.payload_hash <> v_hash then raise exception using errcode = '22023', message = 'Request key reused with different payload'; end if;
  if v_saved.result is not null then return v_saved.result; end if;

  case
  when p_command='update_organization' then
    select to_jsonb(o)-'created_at'-'updated_at' into v_before from public.organizations o where id=p_organization_id;
  when p_command='update_location' then
    select to_jsonb(l)-'created_at'-'updated_at' into v_before from public.locations l where id=(p_payload->>'id')::uuid and organization_id=p_organization_id;
  when p_command='update_item' then
    select to_jsonb(i)-'created_at'-'updated_at' into v_before from public.items i where id=(p_payload->>'id')::uuid and organization_id=p_organization_id;
  when p_command in ('change_member_role','suspend_member','reactivate_member','transfer_ownership') then
    select to_jsonb(m)-'created_at'-'updated_at' into v_before from public.organization_memberships m where user_id=(p_payload->>'user_id')::uuid and organization_id=p_organization_id;
  when p_command in ('resend_invitation','revoke_invitation','accept_invitation') then
    select to_jsonb(i)-'recipient_email' into v_before from public.organization_invitations i where id=(p_payload->>'id')::uuid and organization_id=p_organization_id;
  else null;
  end case;

  case p_command
  when 'bootstrap' then
    if exists(select 1 from public.organization_memberships where user_id=v_actor and role='owner') then
      raise exception using errcode = '23514', message = 'A user may own only one organization';
    end if;
    insert into public.organizations(name) values(private.require_text(p_payload,'name',160)) returning id into v_id;
    p_organization_id := v_id;
    insert into public.organization_memberships(organization_id,user_id,role) values(v_id,v_actor,'owner');
    v_entity := 'organization'; v_result := jsonb_build_object('organization_id',v_id);
  when 'update_organization' then
    update public.organizations set name=private.require_text(p_payload,'name',160), updated_at=now() where id=p_organization_id;
    v_id:=p_organization_id; v_entity:='organization';
  when 'create_location' then
    insert into public.locations(organization_id,code,name) values(p_organization_id,upper(private.require_text(p_payload,'code',32)),private.require_text(p_payload,'name',160)) returning id into v_id;
    v_entity:='location';
  when 'update_location' then
    if jsonb_typeof(p_payload->'is_active') is distinct from 'boolean' then raise exception using errcode='22023',message='is_active must be boolean'; end if;
    update public.locations set code=upper(private.require_text(p_payload,'code',32)), name=private.require_text(p_payload,'name',160),is_active=(p_payload->>'is_active')::boolean,updated_at=now()
      where id=private.require_text(p_payload,'id',36)::uuid and organization_id=p_organization_id returning id into v_id;
    v_entity:='location';
  when 'create_item' then
    insert into public.items(organization_id,sku,name,base_uom_code) values(p_organization_id,private.require_text(p_payload,'sku',64),private.require_text(p_payload,'name',160),private.require_text(p_payload,'base_uom_code',8)) returning id into v_id;
    v_entity:='item';
  when 'update_item' then
    if jsonb_typeof(p_payload->'is_active') is distinct from 'boolean' then raise exception using errcode='22023',message='is_active must be boolean'; end if;
    update public.items set sku=private.require_text(p_payload,'sku',64),name=private.require_text(p_payload,'name',160),is_active=(p_payload->>'is_active')::boolean,updated_at=now()
      where id=private.require_text(p_payload,'id',36)::uuid and organization_id=p_organization_id returning id into v_id;
    v_entity:='item';
  when 'supersede_conversion' then
    select * into v_item from public.items where id=private.require_text(p_payload,'item_id',36)::uuid and organization_id=p_organization_id and is_active for update;
    if not found then raise exception using errcode='22023',message='Active item not found'; end if;
    -- Decimal strings avoid JavaScript float loss; reject excess scale instead of silently rounding.
    v_text:=private.require_text(p_payload,'factor',32);
    if v_text !~ '^[0-9]{1,10}(\.[0-9]{1,12})?$' then raise exception using errcode='22023',message='Factor must be an exact decimal string with at most 12 decimal places'; end if;
    v_factor:=v_text::numeric;
    v_text:=private.require_text(p_payload,'source_uom_code',8);
    select coalesce(max(revision),0)+1 into v_revision from public.item_conversion_revisions where item_id=v_item.id and source_uom_code=v_text;
    update public.item_conversion_revisions set retired_at=now() where item_id=v_item.id and source_uom_code=v_text and retired_at is null;
    insert into public.item_conversion_revisions(organization_id,item_id,source_uom_code,target_uom_code,factor,revision,created_by,supporting_note)
      values(p_organization_id,v_item.id,v_text,v_item.base_uom_code,v_factor,v_revision,v_actor,
        case when p_payload ? 'supporting_note' then private.require_text(p_payload,'supporting_note',1000) else null end) returning id into v_id;
    v_entity:='conversion'; v_details:=jsonb_build_object('item_id',v_item.id,'revision',v_revision);
  when 'retire_conversion' then
    v_details:=jsonb_build_object('reason',private.require_text(p_payload,'reason',500));
    update public.item_conversion_revisions set retired_at=now() where id=private.require_text(p_payload,'id',36)::uuid and organization_id=p_organization_id and retired_at is null returning id into v_id;
    v_entity:='conversion';
  when 'invite' then
    v_email:=lower(private.require_text(p_payload,'email',254));
    v_text:=private.require_text(p_payload,'role',32);
    if exists(select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id and lower(u.email)=v_email) then
      raise exception using errcode='22023',message='Existing membership must be managed through team administration';
    end if;
    update public.organization_invitations set status='expired' where organization_id=p_organization_id and recipient_email=v_email and status='pending' and expires_at<=now();
    insert into public.organization_invitations(organization_id,recipient_email,proposed_role,invited_by) values(p_organization_id,v_email,v_text,v_actor) returning id into v_id;
    insert into private.invitation_secrets(invitation_id) values(v_id);
    insert into private.invitation_deliveries(invitation_id) values(v_id);
    v_entity:='invitation'; v_details:=jsonb_build_object('role',v_text);
  when 'resend_invitation','revoke_invitation' then
    select * into v_inv from public.organization_invitations where id=private.require_text(p_payload,'id',36)::uuid and organization_id=p_organization_id for update;
    if not found or v_inv.status not in ('pending','expired') then raise exception using errcode='22023',message='Invitation cannot be changed'; end if;
    v_id:=v_inv.id; v_entity:='invitation';
    update private.invitation_secrets set token_hash=null where invitation_id=v_id;
    if p_command='resend_invitation' then
      update public.organization_invitations set status='pending',expires_at=now()+interval '7 days',invited_by=v_actor where id=v_id;
      update private.invitation_deliveries set state='queued',lease_id=null,lease_until=null,last_error_code=null,updated_at=now() where invitation_id=v_id;
    else
      v_details:=jsonb_build_object('reason',private.require_text(p_payload,'reason',500));
      update public.organization_invitations set status='revoked',revoked_by=v_actor,revoked_at=now() where id=v_id;
      update private.invitation_deliveries set state='cancelled',lease_id=null,lease_until=null,updated_at=now() where invitation_id=v_id;
    end if;
  when 'accept_invitation' then
    v_id:=private.require_text(p_payload,'id',36)::uuid;
    v_token:=private.require_text(p_payload,'token',128);
    select * into v_inv from public.organization_invitations where id=v_id and organization_id=p_organization_id for update;
    select lower(email) into v_email from auth.users where id=v_actor;
    if not found or v_inv.recipient_email is distinct from v_email or not exists(select 1 from private.invitation_secrets where invitation_id=v_id and token_hash=sha256(convert_to(v_token,'UTF8'))) then
      raise exception using errcode='42501',message='Invitation is invalid or unavailable';
    end if;
    if v_inv.status='accepted' and v_inv.accepted_by=v_actor then
      v_result:=jsonb_build_object('id',v_id,'organization_id',p_organization_id);
      update private.command_requests set result=v_result where actor_id=v_actor and scope_id=v_scope and command=p_command and request_id=p_request_id;
      return v_result;
    end if;
    if v_inv.status<>'pending' or v_inv.expires_at<=now() or not exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=v_inv.invited_by and status='active' and role in ('owner','admin')) then
      raise exception using errcode='42501',message='Invitation is invalid or unavailable';
    end if;
    if exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=v_actor) then
      raise exception using errcode='42501',message='Existing membership requires team administration';
    end if;
    insert into public.organization_memberships(organization_id,user_id,role) values(p_organization_id,v_actor,v_inv.proposed_role);
    update public.organization_invitations set status='accepted',accepted_by=v_actor,accepted_at=now() where id=v_id;
    update private.invitation_deliveries set state='cancelled',lease_id=null,lease_until=null,updated_at=now() where invitation_id=v_id;
    v_entity:='invitation';
  when 'change_member_role','suspend_member','reactivate_member','transfer_ownership' then
    v_recipient:=private.require_text(p_payload,'user_id',36)::uuid;
    v_details:=jsonb_build_object('reason',private.require_text(p_payload,'reason',500),'target_user_id',v_recipient);
    select * into v_target from public.organization_memberships where organization_id=p_organization_id and user_id=v_recipient for update;
    if not found or v_recipient=v_actor or v_target.role='owner' then raise exception using errcode='42501',message='Member operation denied'; end if;
    v_id:=v_target.id; v_entity:='membership';
    if p_command='transfer_ownership' then
      if v_role<>'owner' or v_target.status<>'active' or not exists(select 1 from auth.users where id=v_recipient and email_confirmed_at is not null) then
        raise exception using errcode='42501',message='Ownership transfer denied';
      end if;
      -- Require an actual recent password/OTP/WebAuthn AMR event, not token refresh time.
      if not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]')) a
        where a->>'method' in ('password','otp','totp','webauthn') and (a->>'timestamp')::numeric between extract(epoch from now()-interval '5 minutes') and extract(epoch from now()+interval '30 seconds')) then
        raise exception using errcode='42501',message='Recent reauthentication required';
      end if;
      perform pg_advisory_xact_lock(2701001);
      if exists(select 1 from public.organization_memberships where user_id=v_recipient and role='owner') then raise exception using errcode='23514',message='Recipient already owns an organization'; end if;
      update public.organization_memberships set role='admin',updated_at=now() where organization_id=p_organization_id and user_id=v_actor;
      update public.organization_memberships set role='owner',updated_at=now() where id=v_id;
    elsif p_command='change_member_role' then
      v_text:=private.require_text(p_payload,'role',32);
      if v_text='owner' then raise exception using errcode='42501',message='Use ownership transfer'; end if;
      if v_text=v_target.role then raise exception using errcode='22023',message='Role is unchanged'; end if;
      update public.organization_memberships set role=v_text,updated_at=now() where id=v_id;
    elsif p_command='suspend_member' then
      if v_target.status<>'active' then raise exception using errcode='22023',message='Member is already suspended'; end if;
      update public.organization_memberships set status='suspended',updated_at=now() where id=v_id;
    else
      if v_target.status<>'suspended' then raise exception using errcode='22023',message='Member is already active'; end if;
      update public.organization_memberships set status='active',updated_at=now() where id=v_id;
    end if;
  end case;
  if v_id is null then raise exception using errcode='22023',message='Record not found in this organization'; end if;
  v_result:=coalesce(v_result,jsonb_build_object('id',v_id,'organization_id',p_organization_id));
  case v_entity
  when 'organization' then select to_jsonb(o)-'created_at'-'updated_at' into v_after from public.organizations o where id=v_id;
  when 'location' then select to_jsonb(l)-'created_at'-'updated_at' into v_after from public.locations l where id=v_id;
  when 'item' then select to_jsonb(i)-'created_at'-'updated_at' into v_after from public.items i where id=v_id;
  when 'membership' then select to_jsonb(m)-'created_at'-'updated_at' into v_after from public.organization_memberships m where id=v_id;
  when 'invitation' then select to_jsonb(i)-'recipient_email' into v_after from public.organization_invitations i where id=v_id;
  when 'conversion' then select to_jsonb(c)||jsonb_build_object('factor',c.factor::text) into v_after from public.item_conversion_revisions c where id=v_id;
  end case;
  v_details:=v_details||jsonb_build_object('before',v_before,'after',v_after);
  if p_command='transfer_ownership' then v_details:=v_details||jsonb_build_object('former_owner_id',v_actor,'former_owner_new_role','admin'); end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details)
    values(p_organization_id,v_actor,p_command,v_entity,v_id,p_request_id,v_details);
  update private.command_requests set result=v_result where actor_id=v_actor and scope_id=v_scope and command=p_command and request_id=p_request_id;
  return v_result;
end; $$;

-- Delivery worker protocol. Only a trusted backend gets these grants.
-- A lease retry rotates the token; plaintext tokens are never persisted.
create function public.claim_invitation_delivery(p_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inv public.organization_invitations%rowtype; v_job private.invitation_deliveries%rowtype; v_token text; v_lease uuid:=gen_random_uuid(); v_org uuid;
begin
  select organization_id into v_org from public.organization_invitations where id=p_invitation_id;
  perform 1 from public.organizations where id=v_org for update;
  select * into v_inv from public.organization_invitations where id=p_invitation_id for update;
  select * into v_job from private.invitation_deliveries where invitation_id=p_invitation_id for update;
  if v_job.invitation_id is null or v_inv.status<>'pending' or v_inv.expires_at<=now() or
    not exists(select 1 from public.organization_memberships where organization_id=v_org and user_id=v_inv.invited_by and status='active' and role in ('owner','admin')) or
    v_job.state not in ('queued','failed','sending') or (v_job.state='sending' and v_job.lease_until>now()) then return null; end if;
  v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  update private.invitation_secrets set token_hash=sha256(convert_to(v_token,'UTF8')) where invitation_id=p_invitation_id;
  update private.invitation_deliveries set state='sending',attempts=attempts+1,lease_id=v_lease,lease_until=now()+interval '5 minutes',last_error_code=null,updated_at=now() where invitation_id=p_invitation_id;
  return jsonb_build_object('invitation_id',p_invitation_id,'organization_id',v_org,'email',v_inv.recipient_email,'token',v_token,'lease_id',v_lease,'expires_at',v_inv.expires_at);
end; $$;
create function public.complete_invitation_delivery(p_invitation_id uuid,p_lease_id uuid,p_success boolean,p_error_code text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_success is null or (p_error_code is not null and p_error_code !~ '^[A-Z0-9_]{1,64}$') then raise exception using errcode='22023',message='Use a non-sensitive delivery error code'; end if;
  update private.invitation_deliveries set state=case when p_success then 'sent' else 'failed' end,
    lease_id=null,lease_until=null,last_error_code=case when p_success then null else p_error_code end,updated_at=now()
    where invitation_id=p_invitation_id and lease_id=p_lease_id and state='sending' and lease_until>now();
  return found;
end; $$;
create function public.pending_invitation_deliveries(p_limit integer default 50)
returns table(invitation_id uuid) language sql stable security definer set search_path = '' as $$
  select d.invitation_id from private.invitation_deliveries d
  join public.organization_invitations i on i.id=d.invitation_id
  where i.status='pending' and i.expires_at>now() and (d.state in ('queued','failed') or (d.state='sending' and d.lease_until<=now()))
  order by d.updated_at,d.invitation_id limit greatest(1,least(coalesce(p_limit,50),100));
$$;
create function public.invitation_delivery_status(p_organization_id uuid)
returns table(invitation_id uuid,state text,attempts integer,last_error_code text,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(p_organization_id,array['owner','admin']) then raise exception using errcode='42501',message='Administration denied'; end if;
  return query select d.invitation_id,d.state,d.attempts,d.last_error_code,d.updated_at from private.invitation_deliveries d
    join public.organization_invitations i on i.id=d.invitation_id where i.organization_id=p_organization_id;
end; $$;

create function public.search_audit_events(
  p_organization_id uuid, p_limit integer default 50, p_cursor text default null,
  p_actor_id uuid default null, p_action text default null, p_entity_type text default null,
  p_entity_id uuid default null, p_from timestamptz default null, p_until timestamptz default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cursor jsonb; v_time timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_more boolean;
begin
  if not private.has_role(p_organization_id,array['owner','admin','accountant']) then
    raise exception using errcode='42501',message='Audit access denied';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_from is not null and p_until is not null and p_from>=p_until) then
    raise exception using errcode='22023',message='Invalid audit search bounds';
  end if;
  if p_cursor is not null then
    begin
      if length(p_cursor)>1024 then raise exception 'Invalid cursor'; end if;
      v_cursor:=convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;
      if (v_cursor->>'organization_id')::uuid is distinct from p_organization_id then raise exception 'Invalid cursor'; end if;
      v_time:=(v_cursor->>'created_at')::timestamptz; v_id:=(v_cursor->>'id')::uuid;
      if v_time is null or v_id is null then raise exception 'Invalid cursor'; end if;
    exception when others then raise exception using errcode='22023',message='Invalid audit cursor';
    end;
  end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb) into v_rows from (
    select * from public.audit_events a where a.organization_id=p_organization_id
      and (p_actor_id is null or a.actor_id=p_actor_id)
      and (p_action is null or a.action=p_action)
      and (p_entity_type is null or a.entity_type=p_entity_type)
      and (p_entity_id is null or a.entity_id=p_entity_id)
      and (p_from is null or a.created_at>=p_from) and (p_until is null or a.created_at<p_until)
      and (v_time is null or (a.created_at,a.id)<(v_time,v_id))
    order by a.created_at desc,a.id desc limit p_limit+1
  ) e;
  v_more:=jsonb_array_length(v_rows)>p_limit;
  if v_more then v_rows:=v_rows-p_limit; end if;
  v_last:=v_rows->(jsonb_array_length(v_rows)-1);
  return jsonb_build_object('events',v_rows,'next_cursor',case when v_more then
    replace(encode(convert_to(jsonb_build_object('organization_id',p_organization_id,'created_at',v_last->>'created_at','id',v_last->>'id')::text,'UTF8'),'base64'),E'\n','') else null end);
end; $$;

-- Deny by default, including service-role direct writes. Worker has narrow RPCs.
revoke all on public.organizations,public.organization_memberships,public.locations,public.units_of_measure,
  public.items,public.item_conversion_revisions,public.organization_invitations,public.audit_events from public, anon, authenticated, service_role;
revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.profitplate_command(text,uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.claim_invitation_delivery(uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_invitation_delivery(uuid,uuid,boolean,text) from public, anon, authenticated, service_role;
revoke all on function public.pending_invitation_deliveries(integer) from public, anon, authenticated, service_role;
revoke all on function public.invitation_delivery_status(uuid) from public, anon, authenticated, service_role;
revoke all on function public.search_audit_events(uuid,integer,text,uuid,text,text,uuid,timestamptz,timestamptz) from public, anon, authenticated, service_role;
grant usage on schema public to authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.has_role(uuid,text[]) to authenticated;
grant select on public.organizations,public.organization_memberships,public.locations,public.units_of_measure,public.items,public.item_conversion_revisions,public.organization_invitations,public.audit_events to authenticated;
revoke all on public.item_conversion_history from public,anon,authenticated,service_role;
grant select on public.item_conversion_history to authenticated;
grant execute on function public.profitplate_command(text,uuid,uuid,jsonb),public.invitation_delivery_status(uuid) to authenticated;
grant execute on function public.search_audit_events(uuid,integer,text,uuid,text,text,uuid,timestamptz,timestamptz) to authenticated;
grant execute on function public.claim_invitation_delivery(uuid),public.complete_invitation_delivery(uuid,uuid,boolean,text),public.pending_invitation_deliveries(integer) to service_role;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.locations enable row level security;
alter table public.units_of_measure enable row level security;
alter table public.items enable row level security;
alter table public.item_conversion_revisions enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.audit_events enable row level security;
alter table private.invitation_secrets enable row level security;
alter table private.invitation_deliveries enable row level security;
alter table private.command_requests enable row level security;
create policy org_read on public.organizations for select to authenticated using (private.has_role(id));
create policy membership_read on public.organization_memberships for select to authenticated using
  ((user_id=(select auth.uid()) and status='active') or private.has_role(organization_id,array['owner','admin']));
create policy location_read on public.locations for select to authenticated using (private.has_role(organization_id));
create policy unit_read on public.units_of_measure for select to authenticated using ((select auth.uid()) is not null);
create policy item_read on public.items for select to authenticated using (private.has_role(organization_id));
create policy conversion_read on public.item_conversion_revisions for select to authenticated using (private.has_role(organization_id));
create policy invitation_read on public.organization_invitations for select to authenticated using (private.has_role(organization_id,array['owner','admin']));
create policy audit_read on public.audit_events for select to authenticated using (private.has_role(organization_id,array['owner','admin','accountant']));

alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
commit;
