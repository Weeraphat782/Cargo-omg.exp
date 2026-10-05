-- Marketing carrier board: Poland (Warsaw) via Qatar Airways (QR)
INSERT INTO public.carrier_board_routes (country, city, carrier_code, sort_order, is_active)
VALUES ('Poland', 'Warsaw', 'QR', 7, true)
ON CONFLICT (country, city, carrier_code) DO NOTHING;
