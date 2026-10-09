-- SECURITY: every self sign-up becomes 'customer'.
-- Previously the trigger defaulted to 'staff' and trusted raw_user_meta_data->>'role'
-- (client-controlled), so anyone calling supabase.auth.signUp could get staff/admin.
-- Staff / admin / lab_admin must be promoted manually, e.g.:
--   UPDATE public.profiles SET role = 'staff' WHERE email = 'name@company.com';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _full_name TEXT;
BEGIN
  _full_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'name'), ''),
    ''
  );

  INSERT INTO public.profiles (id, email, full_name, company, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    _full_name,
    COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'company'), ''), ''),
    'customer'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = CASE WHEN EXCLUDED.full_name = '' THEN profiles.full_name ELSE EXCLUDED.full_name END,
    company = CASE WHEN EXCLUDED.company = '' THEN profiles.company ELSE EXCLUDED.company END,
    updated_at = NOW();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user trigger error: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- AUDIT: recent staff/admin accounts — demote any that are not real team members:
-- SELECT id, email, role, created_at FROM public.profiles
-- WHERE role IN ('staff', 'admin') ORDER BY created_at DESC;
-- UPDATE public.profiles SET role = 'customer' WHERE email = 'customer@example.com';
