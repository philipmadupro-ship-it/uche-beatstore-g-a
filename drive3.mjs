import { chromium } from 'playwright-core';
import { existsSync } from 'fs';
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
const allReq=[];
page.on('request', r=>allReq.push(r.url()));
page.on('requestfailed', r=>console.log('REQ_FAILED:', r.url().slice(0,80), r.failure()?.errorText));

await page.goto('http://localhost:3000/store', { waitUntil:'networkidle', timeout:30000 });
await page.waitForTimeout(1500);
await page.locator('[id^="beat-"]').first().click({ position:{x:120,y:120} });
await page.waitForTimeout(5000);

// Find audio file requests (the actual mp3/wav, or /api/audio proxy)
const audio = allReq.filter(u => /\/api\/audio|\.mp3|\.wav|\.m4a|audio\//i.test(u) && !/covers|image|\.png|\.jpg/i.test(u));
console.log('AUDIO_FILE_REQUESTS:', audio.length);
audio.slice(0,5).forEach(u=>console.log('  ', u.slice(0,100)));

// Check the wavesurfer canvas in the player bar - does it have non-zero size & drawn pixels?
const canvasInfo = await page.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')];
  return cs.map(c => ({ w:c.width, h:c.height, cw:c.clientWidth }));
});
console.log('CANVASES:', JSON.stringify(canvasInfo));

// Is audio element playing?
const audioState = await page.evaluate(() => {
  const a = document.querySelector('audio');
  if(!a) return 'NO_AUDIO_EL';
  return { src: (a.src||'').slice(0,70), paused: a.paused, dur: a.duration, ready: a.readyState };
});
console.log('AUDIO_EL:', JSON.stringify(audioState));
await browser.close();
