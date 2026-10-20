-- Live SYD / MEL airport rows for MCP IATA lookup (keep legacy combined row unchanged).

INSERT INTO public.destinations (country, port)
SELECT 'Australia', 'SYD'
WHERE NOT EXISTS (
  SELECT 1 FROM public.destinations d WHERE upper(trim(d.port)) = 'SYD'
);

INSERT INTO public.destinations (country, port)
SELECT 'Australia', 'MEL'
WHERE NOT EXISTS (
  SELECT 1 FROM public.destinations d WHERE upper(trim(d.port)) = 'MEL'
);
