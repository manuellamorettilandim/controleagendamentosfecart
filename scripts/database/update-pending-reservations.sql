begin;
select set_config('request.jwt.claim.role', 'service_role', true);

update public.codex_reservations
set starts_at = '2026-09-02 14:20:26+00',
    ends_at = '2026-09-02 19:20:26+00',
    requested_quota_percent = 100
where id = '8a5c0033-2936-4889-b530-a91ee35c7cda';

update public.codex_reservations
set starts_at = '2026-09-03 15:20:26+00',
    ends_at = '2026-09-03 20:20:26+00',
    requested_quota_percent = 100
where id = '69ca0bad-5e67-4cee-8557-883b3d7b51c5';

commit;