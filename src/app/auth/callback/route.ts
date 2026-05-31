import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Only accept a relative, same-origin path for `next` — reject absolute
  // URLs and protocol-relative `//host` so a crafted link can't bounce the
  // freshly-authenticated user off to an attacker's site (open redirect).
  const rawNext = searchParams.get('next') ?? '/library';
  const next = /^\/(?!\/)/.test(rawNext) ? rawNext : '/library';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/login?error=auth-failure`);
}
