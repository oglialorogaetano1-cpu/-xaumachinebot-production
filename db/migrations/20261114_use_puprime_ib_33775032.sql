-- The official PU Prime integration for this deployment belongs only to the
-- current IB/rebate account. Remove the legacy pair from the customer lookup
-- without deleting CRM conversations or historical records.
DO $migration$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.crm_puprime_lookup(text,text,bigint,bigint,text)'::regprocedure
  ) INTO definition;

  definition := replace(
    definition,
    '''7527073'',''23217421''',
    '''33775032'''
  );
  EXECUTE definition;
END
$migration$;
