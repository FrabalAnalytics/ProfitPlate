begin;
create table public.management_actions (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,title text not null check(length(title) between 1 and 160),
 assigned_to uuid not null,priority text not null check(priority in ('normal','high','urgent')),due_on date not null,
 status text not null default 'open' check(status in ('open','in_progress','resolved')),
 evidence_reference text not null check(length(evidence_reference) between 1 and 500),
 resolution_note text,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id),foreign key(organization_id,assigned_to) references public.organization_memberships(organization_id,user_id)
);
alter table public.management_actions enable row level security;
revoke all on public.management_actions from public,anon,authenticated,service_role;
grant select on public.management_actions to authenticated;
create policy authorized_read on public.management_actions for select to authenticated using(private.can_finance(organization_id) or (private.has_role(organization_id) and assigned_to=auth.uid()));
create trigger identity_protect before update or delete on public.management_actions for each row execute function private.protect_record();
create function public.action_command(p_command text,p_request_id uuid,p_organization_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_inventory_actor();entity uuid;allowed text[];saved private.command_requests%rowtype;hash bytea;v_result jsonb;rec public.management_actions%rowtype;
begin
 if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>8192 then raise exception using errcode='22023',message='Invalid action command';end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 if not found or not private.has_role(p_organization_id) then raise exception using errcode='42501',message='Organization access denied';end if;
 allowed:=case p_command when 'create_action' then array['title','assigned_to','priority','due_on','evidence_reference'] when 'update_action' then array['id','status','reason'] end;
 if allowed is null or exists(select 1 from jsonb_object_keys(p_payload) k where not k=any(allowed)) then raise exception using errcode='22023',message='Unknown action field';end if;
 if p_command='create_action' then
 if not private.can_finance(p_organization_id) then raise exception using errcode='42501',message='Management reporting authority required';end if;
 else select * into rec from public.management_actions where organization_id=p_organization_id and id=(p_payload->>'id')::uuid for update;
 if not found or (rec.assigned_to<>actor and not private.can_finance(p_organization_id)) then raise exception using errcode='42501',message='Action access denied';end if;end if;
 hash:=sha256(convert_to(p_payload::text,'UTF8'));
 insert into private.command_requests(actor_id,scope_id,command,request_id,payload_hash) values(actor,p_organization_id,'action:'||p_command,p_request_id,hash) on conflict do nothing;
 select * into saved from private.command_requests where actor_id=actor and scope_id=p_organization_id and command='action:'||p_command and request_id=p_request_id for update;
 if saved.payload_hash<>hash then raise exception using errcode='22023',message='Request key reused with different payload';end if;if saved.result is not null then return saved.result;end if;
 if p_command='create_action' then
 if not exists(select 1 from public.organization_memberships m join auth.users u on u.id=m.user_id where m.organization_id=p_organization_id and m.user_id=(p_payload->>'assigned_to')::uuid and m.status='active' and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then raise exception using errcode='22023',message='Active verified assignee required';end if;
 insert into public.management_actions(organization_id,title,assigned_to,priority,due_on,evidence_reference,created_by)
 values(p_organization_id,private.require_text(p_payload,'title',160),(p_payload->>'assigned_to')::uuid,private.require_text(p_payload,'priority',10),(p_payload->>'due_on')::date,private.require_text(p_payload,'evidence_reference',500),actor) returning id into entity;
 else
 update public.management_actions set status=private.require_text(p_payload,'status',20),resolution_note=private.require_text(p_payload,'reason',500),updated_at=clock_timestamp() where id=rec.id;entity:=rec.id;
 end if;
 v_result:=jsonb_build_object('id',entity,'organization_id',p_organization_id);
 insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,request_id,details) values(p_organization_id,actor,p_command,'management_action',entity,p_request_id,p_payload);
 update private.command_requests set result=v_result where actor_id=actor and scope_id=p_organization_id and command='action:'||p_command and request_id=p_request_id;
 return v_result;
end $$;
revoke all on function public.action_command(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.action_command(text,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';commit;
