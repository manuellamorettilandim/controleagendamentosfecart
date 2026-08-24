create index codex_app_settings_updated_by_idx
  on public.codex_app_settings (updated_by)
  where updated_by is not null;
