import { expect, test, type Page } from '@playwright/test';
import { startStubSupabase, signInCookie, stubSupabaseConfigured } from './fixtures/stub-supabase';

/**
 * UI-03: no control sits past the right edge of the viewport at the four supported widths.
 *
 * `document.scrollingElement.scrollWidth` is NOT enough. The dashboard top bar is `position: fixed` and the store
 * toolbar clips its own overflow, so each ran 100–275px past the screen while the page reported no overflow at all
 * (the account menu and sign-out were unreachable at 768–1279). This measures element edges instead: any visible
 * element whose right edge passes the viewport, unless an ancestor scrolls or clips it inside the screen, or it is
 * decorative (`aria-hidden` / `pointer-events-none`).
 *
 * Dashboard pages sign in through the stub Supabase (e2e/fixtures/stub-supabase.ts) and skip without it.
 */
const WIDTHS = [390, 768, 1440, 1920] as const;

async function offscreen(page: Page) {
  return page.evaluate(() => {
    const iw = window.innerWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('nextjs-portal, [aria-hidden="true"], svg')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || (r.right <= iw + 1 && r.left >= -1)) continue;
      let skip = false;
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.pointerEvents === 'none') { skip = true; break; }
        if (p !== el && /(auto|scroll|hidden|clip)/.test(s.overflowX)) {
          const pr = p.getBoundingClientRect();
          if (pr.right <= iw + 1 && pr.left >= -1) { skip = true; break; }
        }
      }
      if (skip) continue;
      out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.left)}→${Math.round(r.right)} of ${iw}`);
    }
    return out.slice(0, 8);
  });
}

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
}

let stub: Awaited<ReturnType<typeof startStubSupabase>> = null;
test.beforeAll(async () => {
  if (stubSupabaseConfigured()) stub = await startStubSupabase();
});
test.afterAll(async () => {
  await stub?.close();
});

const PUBLIC = ['/store', '/store/track-demo-001'];
const DASHBOARD = ['/library', '/store-editor', '/profile', '/calendar', '/studio'];

for (const w of WIDTHS) {
  test.describe(`${w}px`, () => {
    test.use({ viewport: { width: w, height: 900 } });

    for (const url of PUBLIC) {
      test(`${url}: nothing past the right edge`, async ({ page }) => {
        await page.goto(url);
        await settle(page);
        expect(await offscreen(page)).toEqual([]);
        const doc = await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
        expect(doc).toBeLessThanOrEqual(0);
      });
    }

    for (const url of DASHBOARD) {
      test(`${url}: nothing past the right edge`, async ({ page, context, baseURL }) => {
        test.skip(!stub, 'dashboard pages need the stub Supabase sign-in');
        await context.addCookies([signInCookie(baseURL!)]);
        await page.goto(url);
        await settle(page);
        expect(await offscreen(page)).toEqual([]);
      });
    }
  });
}

// The top bar was worst between md and xl, not at the named widths.
for (const w of [900, 1024, 1100, 1279]) {
  test(`top bar fits at ${w}px and keeps the account menu reachable`, async ({ page, context, baseURL }) => {
    test.skip(!stub, 'dashboard pages need the stub Supabase sign-in');
    await page.setViewportSize({ width: w, height: 800 });
    await context.addCookies([signInCookie(baseURL!)]);
    await page.goto('/profile');
    await settle(page);
    expect(await offscreen(page)).toEqual([]);
    const menu = page.getByRole('button', { name: 'Open account menu' });
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(w);
    // Icon-only search keeps its name once the visible label is gone.
    await expect(page.getByRole('button', { name: 'Search', exact: true }).first()).toBeVisible();
  });
}

test('store editor header stacks at 768 instead of squeezing the title', async ({ page, context, baseURL }) => {
  test.skip(!stub, 'dashboard pages need the stub Supabase sign-in');
  await page.setViewportSize({ width: 768, height: 900 });
  await context.addCookies([signInCookie(baseURL!)]);
  await page.goto('/store-editor');
  await settle(page);
  const title = (await page.getByRole('heading', { name: 'Store Editor' }).boundingBox())!;
  const tabs = (await page.getByRole('button', { name: 'design', exact: true }).boundingBox())!;
  expect(title.width).toBeGreaterThan(150);
  expect(tabs.y).toBeGreaterThanOrEqual(title.y + title.height); // below the title, not over it
});

test.describe('mobile tap targets', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('calendar day "Add event" buttons and the logo link are at least 32px', async ({ page, context, baseURL }) => {
    test.skip(!stub, 'dashboard pages need the stub Supabase sign-in');
    await context.addCookies([signInCookie(baseURL!)]);
    await page.goto('/calendar');
    await settle(page);
    const add = page.getByRole('button', { name: /^Add event on/ }).first();
    const a = (await add.boundingBox())!;
    expect(Math.min(a.width, a.height)).toBeGreaterThanOrEqual(32);
    const logo = (await page.getByRole('link', { name: 'Home', exact: true }).first().boundingBox())!;
    expect(Math.min(logo.width, logo.height)).toBeGreaterThanOrEqual(32);
  });

  test('the comment box keeps Post inside the screen', async ({ page }) => {
    await page.goto('/store/track-demo-001');
    await settle(page);
    const post = page.getByRole('button', { name: /^Post$/ });
    await post.scrollIntoViewIfNeeded();
    const b = (await post.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(390);
  });
});
