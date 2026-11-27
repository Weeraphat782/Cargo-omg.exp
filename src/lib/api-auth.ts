import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { customerNeedsCompanySetup } from '@/lib/customer-company-gate';

type AuthSuccess = {
  ok: true;
  user: User;
  role: string | null;
  supabase: SupabaseClient;
};

type AuthFailure = {
  ok: false;
  response: NextResponse;
};

export type ApiAuthResult = AuthSuccess | AuthFailure;

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function createServerSupabaseClient(key: string) {
  return createClient(getSupabaseUrl(), key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function requireApiUser(request: Request): Promise<ApiAuthResult> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server auth configuration error.' }, { status: 500 }),
    };
  }

  const token = getBearerToken(request);
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }),
    };
  }

  const anonClient = createServerSupabaseClient(anonKey);
  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  const user = userData?.user;

  if (userError || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Session expired. Please sign in again.' }, { status: 401 }),
    };
  }

  const supabase = createServerSupabaseClient(serviceRoleKey);
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('API auth profile lookup failed:', profileError);
    return {
      ok: false,
      response: NextResponse.json({ error: 'Could not verify user role.' }, { status: 500 }),
    };
  }

  return {
    ok: true,
    user,
    role: typeof profile?.role === 'string' ? profile.role : null,
    supabase,
  };
}

import { ROLES } from '@/lib/roles';

/**
 * 403 when this user is a customer with no company name and no companies row.
 * Staff, admin, lab admin, and missing profiles are left to the caller.
 */
export async function customerWithoutCompanyResponse(
  supabase: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, company')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('customer company gate profile lookup failed:', error);
    return NextResponse.json({ error: 'Could not verify company setup.' }, { status: 500 });
  }

  if (!customerNeedsCompanySetup({ role: profile?.role, companyName: profile?.company })) {
    return null;
  }

  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('id')
    .eq('customer_user_id', userId)
    .limit(1);

  if (companyError) {
    console.error('customer company gate company lookup failed:', companyError);
    return NextResponse.json({ error: 'Could not verify company setup.' }, { status: 500 });
  }

  if (companies && companies.length > 0) return null;

  return NextResponse.json(
    { error: 'Complete company setup before using the portal.' },
    { status: 403 },
  );
}

export async function requireStaffApiUser(request: Request): Promise<ApiAuthResult> {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth;

  if (auth.role !== ROLES.STAFF && auth.role !== ROLES.ADMIN) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Staff access required.' }, { status: 403 }),
    };
  }

  return auth;
}

export async function requireLabAdminApiUser(request: Request): Promise<ApiAuthResult> {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth;

  if (auth.role !== ROLES.LAB_ADMIN && auth.role !== ROLES.ADMIN) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Lab admin access required.' }, { status: 403 }),
    };
  }

  return auth;
}

export async function requireAdminApiUser(request: Request): Promise<ApiAuthResult> {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth;

  if (auth.role !== ROLES.ADMIN) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Admin access required.' }, { status: 403 }),
    };
  }

  return auth;
}
