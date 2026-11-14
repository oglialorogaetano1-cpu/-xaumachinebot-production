-- Remove only accidental outer quote characters produced by a portal export.
-- Apostrophes inside a name are intentionally preserved.
update public.puprime_clienti
set nome = btrim(nome, chr(39) || chr(34) || ' ')
where affiliate_id = '33775032'
  and nome is not null
  and nome <> btrim(nome, chr(39) || chr(34) || ' ');
