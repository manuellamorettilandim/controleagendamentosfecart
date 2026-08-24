alter table public.codex_app_settings
  add column enabled_models jsonb not null default
    '["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4"]'::jsonb;

alter table public.codex_app_settings
  add constraint codex_app_settings_enabled_models_valid check (
    pg_catalog.jsonb_typeof(enabled_models) = 'array'
    and pg_catalog.jsonb_array_length(enabled_models) > 0
    and not pg_catalog.jsonb_path_exists(enabled_models, '$[*] ? (@.type() != "string")')
  );
