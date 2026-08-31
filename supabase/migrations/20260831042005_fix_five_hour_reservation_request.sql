-- Reapplies the current reservation contract for environments that already ran
-- the older 1-to-3-hour version of codex_request_reservation.
create or replace function public.codex_request_reservation(
  p_account_id text,
  p_starts_at timestamptz,
  p_duration_hours integer,
  p_requested_quota_percent integer
)
returns setof public.codex_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid := (select auth.uid());
  settings public.codex_app_settings%rowtype;
  approval text;
  reset_at timestamptz := codex_private.five_hour_reset(p_account_id);
  ends_at_val timestamptz;
begin
  if requester is null then
    raise exception 'Autenticação necessária.' using errcode = '42501';
  end if;
  if p_duration_hours <> 5 or p_requested_quota_percent <> 100 then
    raise exception 'Cada sessão usa a quota disponível de uma janela de cinco horas.' using errcode = '22023';
  end if;
  if reset_at is null then
    raise exception 'A conta ainda não informou o próximo reset da janela de 5 horas.' using errcode = 'P0001';
  end if;
  if p_starts_at < now() - interval '1 minute' then
    raise exception 'Não é possível agendar um horário passado.' using errcode = '22023';
  end if;

  if codex_private.is_five_hour_boundary(p_account_id, p_starts_at) then
    ends_at_val := p_starts_at + interval '5 hours';
  elsif p_starts_at <= now() + interval '1 minute'
      and p_starts_at < reset_at
      and reset_at - p_starts_at >= interval '5 minutes' then
    ends_at_val := reset_at;
  else
    raise exception 'Escolha agora ou o início de um novo ciclo de 5 horas.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles
    where user_id = requester
      and enabled = true
      and coalesce(scheduling_enabled, true) = true
  ) then
    raise exception 'Os agendamentos deste grupo estão bloqueados pelo administrador.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.codex_account_snapshots
    where account_id = p_account_id and status = 'ready'
  ) then
    raise exception 'Essa conta não está pronta para receber agendamentos.' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_account_id, 0));
  if exists (
    select 1
    from public.codex_reservations
    where account_id = p_account_id
      and status = 'scheduled'
      and approval_status in ('pending', 'approved')
      and starts_at < ends_at_val
      and ends_at > p_starts_at
  ) then
    raise exception 'Esse horário já está reservado.' using errcode = 'P0001';
  end if;

  select * into settings from public.codex_app_settings where singleton = true;
  approval := case when coalesce(settings.auto_approve_quota_percent, 0) > 0 then 'approved' else 'pending' end;

  return query
    insert into public.codex_reservations (
      user_id,
      account_id,
      starts_at,
      ends_at,
      status,
      approval_status,
      requested_quota_percent,
      quota_budget_percent,
      reviewed_at,
      review_note
    ) values (
      requester,
      p_account_id,
      p_starts_at,
      ends_at_val,
      'scheduled',
      approval,
      100,
      case when approval = 'approved' then 100 else null end,
      case when approval = 'approved' then now() else null end,
      case when approval = 'approved' then 'Aprovado automaticamente pela política geral.' else null end
    ) returning *;
end;
$$;

revoke execute on function public.codex_request_reservation(text, timestamptz, integer, integer) from public, anon;
grant execute on function public.codex_request_reservation(text, timestamptz, integer, integer) to authenticated, service_role;
