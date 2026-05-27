import { NextRequest, NextResponse } from 'next/server';
import { getCreatorProfile, updateCreatorProfile } from '@/lib/actions/profile';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await getCreatorProfile();
  if (result.error) {
    const status = result.error === 'Not authenticated' ? 401 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ profile: result.profile });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Whitelist profile fields
    const {
      display_name,
      bio,
      hero_image_url,
      credits,
      license_lease_price_usd,
      license_exclusive_price_usd,
      license_notes,
      license_agreement,
      default_discount_percent,
      instagram_handle,
      twitter_handle,
      spotify_url,
      soundcloud_url,
      website_url,
      contact_email,
      accent_color,
      font_style,
      seo_title,
      seo_description,
      og_image_url,
      license_template_md,
    } = body;

    const payload = {
      display_name: display_name || null,
      bio: bio || null,
      hero_image_url: hero_image_url || null,
      credits: credits || null,
      license_lease_price_usd: license_lease_price_usd ? parseFloat(license_lease_price_usd) : null,
      license_exclusive_price_usd: license_exclusive_price_usd ? parseFloat(license_exclusive_price_usd) : null,
      license_notes: license_notes || null,
      license_agreement: license_agreement || null,
      default_discount_percent: default_discount_percent ? parseFloat(default_discount_percent) : null,
      instagram_handle: instagram_handle || null,
      twitter_handle: twitter_handle || null,
      spotify_url: spotify_url || null,
      soundcloud_url: soundcloud_url || null,
      website_url: website_url || null,
      contact_email: contact_email || null,
      // Storefront theme (migration 034)
      accent_color: accent_color || '#D4BFA0',
      font_style: font_style || 'default',
      // Storefront SEO + share card (migration 055)
      seo_title: seo_title || null,
      seo_description: seo_description || null,
      og_image_url: og_image_url || null,
      // License contract template (migration 057)
      license_template_md: license_template_md || null,
    };

    const result = await updateCreatorProfile(payload);
    if (result.error) {
      const status = result.error === 'Not authenticated' ? 401 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ profile: result.profile });
  } catch (error: any) {
    console.error('Profile POST API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  return POST(req);
}
