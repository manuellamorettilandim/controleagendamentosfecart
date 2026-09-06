begin;
select set_config('request.jwt.claim.role', 'service_role', true);

-- Ajustar blackinwhite para 10%
update public.codex_reservations
set quota_budget_percent = 10,
    review_note = 'Aprovado para sess?o de 5h com cota padr?o de 10%.'
where id = '8a5c0033-2936-4889-b530-a91ee35c7cda';

-- Aprovar fecurity com 10%
update public.codex_reservations
set approval_status = 'approved',
    quota_budget_percent = 10,
    reviewed_at = now(),
    review_note = 'Aprovado para sess?o de 5h com cota padr?o de 10%.'
where id = '69ca0bad-5e67-4cee-8557-883b3d7b51c5';

commit;