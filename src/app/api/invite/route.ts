import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { Resend } from 'resend';
import { nanoid } from 'nanoid';
import { isSupabaseConfigured, insert, createServiceClient } from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const { email, role } = await req.json();

    if (!email || !role) {
      return NextResponse.json({ error: 'Email and role required' }, { status: 400 });
    }

    // Without an auth gate this endpoint is an open relay — anyone could fire
    // invitation emails through our Resend account, spending the budget and
    // damaging sender reputation. Require a logged-in user.
    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
    }

    const token = nanoid(16);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    let invite: any;

    if (isSupabaseConfigured()) {
      const supabaseAdmin = createServiceClient();

      const { data, error } = await supabaseAdmin
        .from('invites')
        .insert({ email, role, token, expires_at: expiresAt })
        .select()
        .single();

      if (error) throw new Error(error.message);
      invite = data;
    } else {
      invite = insert('invites', { email, role, token, expires_at: expiresAt });
    }

    const inviteUrl = `${getAppUrl()}/invite/${token}`;

    // Send email if Resend is configured
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to: email,
        subject: `You've been invited to join U2C Beatstore`,
        html: `
          <div style="background-color: #0a0907; color: #E8DCC8; padding: 40px; font-family: sans-serif;">
            <h1 style="color: #D4BFA0;">ANTIGRAVITY</h1>
            <p>You have been invited to join the team as a <strong>${role}</strong>.</p>
            <a href="${inviteUrl}" style="background-color: #D4BFA0; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 20px;">
              ACCEPT INVITE
            </a>
          </div>
        `,
      });
    }

    return NextResponse.json({ success: true, invite, inviteUrl });
  } catch (error: any) {
    console.error('Invite Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
