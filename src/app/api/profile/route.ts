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
      share_card_style,
      share_video_style,
      lossless_exports,
      auto_tagging,
      voice_tag_url,
      voice_tag_interval_seconds,
      bundle_discount_threshold,
      bundle_discount_percent,
      dither_mode,
      dither_color_mode,
      dither_texture,
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
      // Share template styles (migration 062)
      share_card_style: share_card_style || null,
      share_video_style: share_video_style || null,
      // Workspace preferences (migration 063)
      ...(lossless_exports !== undefined && { lossless_exports: Boolean(lossless_exports) }),
      ...(auto_tagging !== undefined && { auto_tagging: Boolean(auto_tagging) }),
      // Voice tag (migration 072) — url set via /api/profile/voice-tag upload
      ...(voice_tag_url !== undefined && { voice_tag_url: voice_tag_url || null }),
      ...(voice_tag_interval_seconds !== undefined && { voice_tag_interval_seconds: Math.max(5, Math.min(120, Number(voice_tag_interval_seconds) || 20)) }),
      // Bundle/quantity discount (migration 077)
      ...(bundle_discount_threshold !== undefined && { bundle_discount_threshold: Math.max(0, Math.min(99, Math.round(Number(bundle_discount_threshold) || 0))) }),
      ...(bundle_discount_percent !== undefined && { bundle_discount_percent: Math.max(0, Math.min(90, Number(bundle_discount_percent) || 0)) }),
      // Audio-reactive dither style (migration 093)
      ...(dither_mode && { dither_mode: ['bayer','halftone','noise','crosshatch'].includes(dither_mode) ? dither_mode : 'bayer' }),
      ...(dither_color_mode && { dither_color_mode: ['original','grayscale','duotone'].includes(dither_color_mode) ? dither_color_mode : 'original' }),
      ...(dither_texture && { dither_texture: ['paper','film-grain','concrete','scanlines','none'].includes(dither_texture) ? dither_texture : 'paper' }),
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
