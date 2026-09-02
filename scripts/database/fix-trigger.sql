create or replace function codex_private.enforce_reservation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, codex_private
as $$
declare
  is_admin boolean;
  default_budget integer;
begin
  select (
    coalesce(auth.role(), '') in ('service_role', 'supabase_admin') or
    exists (
      select 1
      from public.codex_admins
      where user_id = (select auth.uid()) and enabled = true
    )
  ) into is_admin;

  if TG_OP = 'INSERT' then
    if not codex_private.valid_five_hour_session(new.account_id, new.starts_at, new.ends_at) then
      raise exception 'A sessao deve ocupar um ciclo completo ou terminar no reset atual';
    end if;
    if not is_admin and (new.ends_at <= now() or new.starts_at < now() - interval '1 minute') then
      raise exception 'Nao e possivel agendar horarios passados';
    end if;
    if not is_admin and new.approval_status is null then
      new.approval_status := 'pending';
      new.quota_budget_percent := null;
      new.reviewed_at := null;
      new.reviewed_by := null;
      new.review_note := null;
    end if;
    new.requested_quota_percent := 100;
    if new.approval_status = 'approved' and new.quota_budget_percent is null then
      select coalesce(session_weekly_quota_percent, 10) into default_budget from public.codex_app_settings where singleton = true;
      new.quota_budget_percent := coalesce(default_budget, 10);
    end if;
  end if;

  if TG_OP = 'UPDATE' then
    if not is_admin and (
      new.approval_status is distinct from old.approval_status or
      new.quota_budget_percent is distinct from old.quota_budget_percent or
      new.requested_quota_percent is distinct from old.requested_quota_percent or
      new.reviewed_at is distinct from old.reviewed_at or
      new.reviewed_by is distinct from old.reviewed_by or
      new.review_note is distinct from old.review_note or
      new.user_id is distinct from old.user_id or
      new.account_id is distinct from old.account_id or
      new.starts_at is distinct from old.starts_at or
      new.ends_at is distinct from old.ends_at
    ) then
      raise exception 'Somente administradores podem aprovar ou alterar parametros da reserva.';
    end if;
    if not is_admin and new.device_id is distinct from old.device_id and not (
      old.device_id is null and
      new.device_id is not null and
      pg_catalog.btrim(new.device_id) <> '' and
      old.approval_status = 'approved' and
      new.approval_status = 'approved' and
      old.status = 'scheduled' and
      new.status = 'scheduled' and
      new.user_id = (select auth.uid()) and
      new.starts_at <= now() + interval '1 minute' and
      new.ends_at > now() and
      old.activated_at is null and
      new.activated_at between now() - interval '1 minute' and now() + interval '1 minute'
    ) then
      raise exception 'A credencial so pode ser vinculada uma vez durante uma reserva aprovada e ativa.';
    end if;
    if (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at)
       and not codex_private.valid_five_hour_session(new.account_id, new.starts_at, new.ends_at) then
      raise exception 'A sessao deve ocupar um ciclo completo ou terminar no reset atual';
    end if;
    if old.approval_status = 'pending' and new.approval_status = 'approved' and new.ends_at <= now() then
      raise exception 'Nao e permitido aprovar uma solicitacao cujo horario ja expirou.';
    end if;
    if old.approval_status = 'pending' and new.approval_status = 'approved' and new.quota_budget_percent is null then
      select coalesce(session_weekly_quota_percent, 10) into default_budget from public.codex_app_settings where singleton = true;
      new.requested_quota_percent := 100;
      new.quota_budget_percent := coalesce(default_budget, 10);
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_reservation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, codex_private
as $$
begin
  return codex_private.enforce_reservation_integrity();
end;
$$;