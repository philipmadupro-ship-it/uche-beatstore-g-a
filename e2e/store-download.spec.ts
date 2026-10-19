/**
 * BUYER-05: the post-purchase download page tells the buyer why a file will not
 * save instead of filing a silent failed download.
 *
 * The delivery and download-file APIs are stubbed with the shapes the real
 * routes return (Content-Disposition on success, `{ error }` JSON on a refusal);
 * the page, its click handling and the browser's own download handling are
 * real. The authorization rules themselves are route tests
 * (src/app/api/store/{delivery,download-file}/route.test.ts).
 */
import { test, expect, type Page } from '@playwright/test';

const SESSION = 'cs_test_e2e';
const FILE_PATH = '/api/store/download-file';

const delivery = {
  purchase: { id: 'p1', buyer_email: 'buyer@example.test', amount_usd: 30, created_at: '2026-01-01T00:00:00Z', status: 'paid' },
  tracks: [{
    id: 't1', title: 'Night Shift', type: 'beat', license_type: 'lease', file_types: ['MP3'],
    downloads: [{
      format: 'mp3', label: 'MP3',
      proxied_url: `${FILE_PATH}?session_id=${SESSION}&track_id=t1&format=mp3`,
    }],
  }],
};

async function stubDelivery(page: Page, file: { status: number; body?: unknown }) {
  await page.route('**/api/store/delivery**', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify(delivery),
  }));
  await page.route('**/api/store/theme**', (route) => route.fulfill({ contentType: 'application/json', body: '{}' }));
  await page.route(`**${FILE_PATH}**`, (route) => {
    if (file.status >= 400) {
      return route.fulfill({ status: file.status, contentType: 'application/json', body: JSON.stringify(file.body) });
    }
    return route.fulfill({
      status: route.request().headers().range ? 206 : 200,
      headers: {
        'content-type': 'audio/mpeg',
        'content-disposition': 'attachment; filename="Night Shift.mp3"',
        'cache-control': 'private, no-store',
      },
      body: 'ID3-fixture-bytes',
    });
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test.describe(`store download @ ${viewport.width}px`, () => {
    test.use({ viewport });

    test('an authorized buyer saves the file under its server-given name', async ({ page }) => {
      await stubDelivery(page, { status: 206 });
      await page.goto(`/store/download?session_id=${SESSION}`);

      const saved = page.waitForEvent('download');
      await page.getByRole('button', { name: /download/i }).first().click();
      expect((await saved).suggestedFilename()).toBe('Night Shift.mp3');
    });

    test('a refused file says why and nothing is saved', async ({ page }) => {
      await stubDelivery(page, { status: 403, body: { error: 'Download access revoked (refunded or disputed)' } });
      await page.goto(`/store/download?session_id=${SESSION}`);

      let downloaded = false;
      page.on('download', () => { downloaded = true; });
      const button = page.getByRole('button', { name: /download/i }).first();
      await button.click();

      await expect(page.getByText('MP3 could not be downloaded')).toBeVisible();
      await expect(page.getByText('Download access revoked (refunded or disputed)')).toBeVisible();
      await expect(button).toBeEnabled();
      expect(downloaded).toBe(false);
    });
  });
}
