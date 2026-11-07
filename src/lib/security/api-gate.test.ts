import { describe, expect, it } from 'vitest';
import {
  apiGateFor,
  isLabelOsApiPath,
  isLabelOsJoinApiPath,
  isLabelOsJoinPagePath,
  isLabelOsPagePath,
  isLabelOsRestoreApiPath,
  isLabelOsRestorePagePath,
  isLabelOsSetupApiPath,
  isLabelOsSetupPagePath,
  isLabelOsPressApiPath,
  isLabelOsPressPagePath,
  isLabelOsSignApiPath,
  isLabelOsSignPagePath,
  isPublicApiPath,
  requiresProducerForApi,
} from './api-gate';

describe('isPublicApiPath', () => {
  it.each([
    '/api/store', '/api/store/me', '/api/store/checkout', '/api/store/download-file',
    '/api/share/tok123', '/api/share/tok/preview/t1', '/api/projects/share/tok',
    '/api/stripe/webhook', '/api/resend/webhook', '/api/cron/process-uploads',
    '/api/csp-report', '/api/health', '/api/whoami', '/api/tracks/abc/heatmap',
  ])('allows %s', (p) => expect(isPublicApiPath(p)).toBe(true));

  it.each([
    '/api/email', '/api/upload/init', '/api/upload/image',
    '/api/tracks', '/api/tracks/abc', '/api/tracks/abc/heatmap/extra', '/api/projects',
    '/api/projects/abc', '/api/audio', '/api/sales', '/api/contacts', '/api/cover/generate',
    '/api/stripe/diagnostics', '/api/privacy/erase', '/api/profile',
    // prefix look-alikes must not slip through
    '/api/storefront-admin', '/api/stripe/webhooks-admin', '/api/healthz',
  ])('gates %s', (p) => expect(isPublicApiPath(p)).toBe(false));
});

describe('requiresProducerForApi', () => {
  it('leaves signed-out requests to the route (cron bearer, 401s)', () => {
    expect(requiresProducerForApi('/api/email', false)).toBe(false);
  });
  it('gates a signed-in caller on a dashboard route', () => {
    expect(requiresProducerForApi('/api/email', true)).toBe(true);
  });
  it('ignores non-api paths', () => {
    expect(requiresProducerForApi('/library', true)).toBe(false);
  });
});

describe('isLabelOsApiPath', () => {
  it.each(['/api/org', '/api/org/', '/api/org/abc', '/api/org/abc/members', '/api/org/join'])(
    'is the namespace: %s',
    (p) => expect(isLabelOsApiPath(p)).toBe(true),
  );
  it.each(['/api/organizations', '/api/orgs', '/api/orgx/1', '/api', '/api/', '/org', '/o/acme', '/api/tracks/org'])(
    'is not: %s',
    (p) => expect(isLabelOsApiPath(p)).toBe(false),
  );
});

describe('isLabelOsPagePath', () => {
  it.each(['/o', '/o/', '/o/acme', '/o/acme/artists/1', '/shared', '/shared/', '/shared/9f1c'])('is the namespace: %s', (p) =>
    expect(isLabelOsPagePath(p)).toBe(true),
  );
  it.each(['/offline', '/orders', '/org', '/oo/x', '/store/orders', '/', '/api/org', '/share/abc', '/shares', '/sharedx', '/projects/shared', '/api/shared'])('is not: %s', (p) =>
    expect(isLabelOsPagePath(p)).toBe(false),
  );
});

describe('the setup exception (LABEL-48)', () => {
  it('is exactly /api/org/setup, gate session', () => {
    expect(isLabelOsSetupApiPath('/api/org/setup')).toBe(true);
    expect(apiGateFor('/api/org/setup', true)).toBe('session');
    for (const p of ['/api/org/setup/', '/api/org/setup/x', '/api/org/setups', '/api/org/x/setup', '/api/setup']) {
      expect(isLabelOsSetupApiPath(p), p).toBe(false);
    }
    expect(apiGateFor('/api/org/x/setup', true)).toBe('member');
  });

  it('the setup page is /setup only', () => {
    for (const p of ['/setup', '/setup/']) expect(isLabelOsSetupPagePath(p), p).toBe(true);
    for (const p of ['/setup/x', '/setups', '/o/setup', '/store/setup']) expect(isLabelOsSetupPagePath(p), p).toBe(false);
  });
});

describe('the join exception (LABEL-08)', () => {
  it('is exactly /api/org/join', () => {
    expect(isLabelOsJoinApiPath('/api/org/join')).toBe(true);
    for (const p of ['/api/org/join/', '/api/org/join/x', '/api/org/joint', '/api/org/x/join', '/api/org', '/api/join', '/api/org/JOIN']) {
      expect(isLabelOsJoinApiPath(p), p).toBe(false);
    }
  });

  it('the join page is /join/<token>', () => {
    for (const p of ['/join/abc', '/join/abc/']) expect(isLabelOsJoinPagePath(p), p).toBe(true);
    for (const p of ['/join', '/join/', '/joiner/x', '/o/join/x', '/api/org/join', '/store/join/x']) {
      expect(isLabelOsJoinPagePath(p), p).toBe(false);
    }
  });

  it('the external signer’s entrance is exactly /api/sign/<token> and /sign/<token> (LABEL-60)', () => {
    for (const p of ['/api/sign/abc', '/api/sign/abc/', '/api/sign/abc/document', '/api/sign/abc/document/']) expect(isLabelOsSignApiPath(p), p).toBe(true);
    for (const p of ['/api/sign', '/api/sign/', '/api/sign/abc/def', '/api/sign/abc/document/x', '/api/sign/abc/documents', '/api/signer/abc', '/api/org/sign/abc', '/api/signx/abc', '/api/store/sign/abc']) {
      expect(isLabelOsSignApiPath(p), p).toBe(false);
    }
    for (const p of ['/sign/abc', '/sign/abc/']) expect(isLabelOsSignPagePath(p), p).toBe(true);
    for (const p of ['/sign', '/sign/', '/sign/abc/def', '/signer/abc', '/o/x/sign/abc', '/store/sign/abc', '/api/sign/abc']) {
      expect(isLabelOsSignPagePath(p), p).toBe(false);
    }
  });

  it('the public press kit is exactly /api/press/<token>[/assets/<id>] and /press/<token> (LABEL-66)', () => {
    for (const p of ['/api/press/abc', '/api/press/abc/', '/api/press/abc/assets/p1']) expect(isLabelOsPressApiPath(p), p).toBe(true);
    for (const p of ['/api/press', '/api/press/', '/api/press/abc/def', '/api/press/abc/assets', '/api/press/abc/assets/p1/x', '/api/pressx/abc', '/api/org/press/abc', '/api/store/press/abc']) {
      expect(isLabelOsPressApiPath(p), p).toBe(false);
    }
    for (const p of ['/press/abc', '/press/abc/']) expect(isLabelOsPressPagePath(p), p).toBe(true);
    for (const p of ['/press', '/press/', '/press/abc/def', '/presskit/abc', '/o/x/press/abc', '/api/press/abc']) expect(isLabelOsPressPagePath(p), p).toBe(false);
    expect(apiGateFor('/api/press/abc', true)).toBe('none');
    expect(apiGateFor('/api/press/abc/assets/p1', true)).toBe('none');
    expect(apiGateFor('/api/press/abc/def', true)).toBe('producer');
  });

  it('any caller — signed in or out, member or buyer — reaches /api/sign/<token> without a producer or membership check; the route authorises with the link', () => {
    expect(apiGateFor('/api/sign/abc', true)).toBe('none');
    expect(apiGateFor('/api/sign/abc', false)).toBe('none');
    expect(requiresProducerForApi('/api/sign/abc', true)).toBe(false);
    // Nothing else under that name is opened: a look-alike stays producer-only for a signed-in caller.
    expect(apiGateFor('/api/sign/abc/def', true)).toBe('producer');
    expect(apiGateFor('/api/signer/abc', true)).toBe('producer');
  });

  it('admits any signed-in caller to /api/org/join only; the route authorises', () => {
    expect(apiGateFor('/api/org/join', true)).toBe('session');
    expect(apiGateFor('/api/org/join', false)).toBe('none');
    for (const p of ['/api/org/join/x', '/api/org/joint', '/api/org/x/join', '/api/org/x/invitations']) {
      expect(apiGateFor(p, true), p).toBe('member');
    }
    expect(requiresProducerForApi('/api/org/join', true)).toBe(false);
  });
});

describe('the restore exception (LABEL-39)', () => {
  const ID = '0b0e1a57-0000-4000-8000-000000000001';

  it('is exactly /api/org/<uuid>/restore', () => {
    expect(isLabelOsRestoreApiPath(`/api/org/${ID}/restore`)).toBe(true);
    for (const p of [`/api/org/${ID}/restore/`, `/api/org/${ID}/restore/x`, `/api/org/${ID}`, '/api/org/x/restore', `/api/org/${ID}/export`, `/api/org/${ID}/restored`, '/api/org/restore', `/api/org/${ID}/x/restore`, `/api/orgs/${ID}/restore`]) {
      expect(isLabelOsRestoreApiPath(p), p).toBe(false);
    }
  });

  it('admits any signed-in caller to it and to nothing beside it; the route authorises', () => {
    expect(apiGateFor(`/api/org/${ID}/restore`, true)).toBe('session');
    expect(apiGateFor(`/api/org/${ID}/restore`, false)).toBe('none');
    for (const p of [`/api/org/${ID}/export`, `/api/org/${ID}`, `/api/org/${ID}/members`]) {
      expect(apiGateFor(p, true), p).toBe('member');
    }
  });

  it('the restore page is /restore/<uuid>', () => {
    for (const p of [`/restore/${ID}`, `/restore/${ID}/`]) expect(isLabelOsRestorePagePath(p), p).toBe(true);
    for (const p of ['/restore', '/restore/', '/restore/abc', `/restore/${ID}/x`, `/o/restore/${ID}`, `/restored/${ID}`]) {
      expect(isLabelOsRestorePagePath(p), p).toBe(false);
    }
  });
});

describe('the release calendar feed (LABEL-34) needs no exception', () => {
  const ID = '0b0e1a57-0000-4000-8000-000000000001';

  it('is inside the Label OS namespace, so LABEL_OS_ENABLED and the database check still apply to it', () => {
    expect(isLabelOsApiPath(`/api/org/${ID}/calendar.ics`)).toBe(true);
  });

  it('a calendar app has no cookies: signed out is left to the route (token check), signed in is the ordinary member gate', () => {
    expect(apiGateFor(`/api/org/${ID}/calendar.ics`, false)).toBe('none');
    expect(apiGateFor(`/api/org/${ID}/calendar.ics`, true)).toBe('member');
  });

  it('opens nothing beside it: the link management and the export are ordinary member routes', () => {
    for (const p of [`/api/org/${ID}/calendar/feed`, `/api/org/${ID}/releases/${ID}/export`, `/api/org/${ID}/calendar.ics/x`]) {
      expect(apiGateFor(p, true), p).toBe('member');
    }
    expect(requiresProducerForApi(`/api/org/${ID}/calendar.ics`, true)).toBe(false);
  });
});

describe('apiGateFor', () => {
  it('gates Label OS paths on membership, never on producer', () => {
    expect(apiGateFor('/api/org', true)).toBe('member');
    expect(apiGateFor('/api/org/abc/members', true)).toBe('member');
    expect(requiresProducerForApi('/api/org/abc', true)).toBe(false);
  });

  it('leaves signed-out callers to the route everywhere, Label OS included', () => {
    for (const p of ['/api/org', '/api/email', '/api/store']) expect(apiGateFor(p, false)).toBe('none');
  });

  it('keeps every other path exactly as requiresProducerForApi had it', () => {
    for (const p of ['/api/email', '/api/tracks', '/api/organizations', '/api/orgs', '/api/stripe/diagnostics']) {
      expect(apiGateFor(p, true), p).toBe('producer');
    }
    for (const p of ['/api/store/me', '/api/share/t', '/api/portal/t', '/api/tracks/t/heatmap', '/library', '/o/acme']) {
      expect(apiGateFor(p, true), p).toBe('none');
    }
  });
});
