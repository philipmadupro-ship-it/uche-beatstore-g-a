// A Supabase-shaped front door for the local stack on :54321.
//   /rest/v1/*       → PostgREST on :3000 (real SQL, real RLS, real JWT roles)
//   /auth/v1/user    → the user in a JWT signed by jwt.mjs
//   /auth/v1/token   → refresh with that same JWT, or ?grant_type=password
//                       against the local password hash (bootstrap.sql)
//   /auth/v1/admin/users{,/<id>} → the admin API subset the team-account
//                       routes use (create, get, update password / ban, delete)
// Plus a fake Resend on :54400 that records emails (GET /emails lists, DELETE clears).
import http from 'node:http';
import { SERVICE_KEY, sign, verify } from './jwt.mjs';

const PGRST = process.env.LOCAL_PGRST_URL ?? 'http://127.0.0.1:3000';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

/** A local-only SQL function (scripts/local-db/bootstrap.sql), called with the service key. */
async function rpc(name, args) {
  const r = await fetch(`${PGRST}/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:54321');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(204);
  try {
    if (url.pathname === '/auth/v1/user') {
      const claims = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!claims?.sub) return send(401, { message: 'invalid token' });
      return send(200, { id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: new Date((claims.iat ?? 0) * 1000).toISOString() });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const user = await rpc('local_auth_password_sign_in', { p_email: body.email ?? '', p_password: body.password ?? '' });
      if (!user?.id) return send(400, { error: 'invalid_grant', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      const access = sign({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, iat: Math.floor(Date.now() / 1000) });
      return send(200, { access_token: access, refresh_token: access, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: { provider: 'email' }, user_metadata: {} } });
    }
    const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users(?:\/([0-9a-f-]{36}))?$/);
    if (adminUser) {
      const claims = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (claims?.role !== 'service_role') return send(401, { msg: 'service role required' });
      const id = adminUser[1];
      const body = ['POST', 'PUT'].includes(req.method) ? JSON.parse((await readBody(req)).toString() || '{}') : {};
      const asUser = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.user_metadata ?? body.user_metadata ?? {}, app_metadata: { provider: 'email' }, banned_until: u.banned_until ?? null, created_at: new Date().toISOString() });
      if (req.method === 'POST' && !id) {
        const out = await rpc('local_auth_admin_create', { p_email: body.email ?? '', p_password: body.password ?? null, p_meta: body.user_metadata ?? {} });
        if (out?.error === 'email_exists') return send(422, { code: 'email_exists', error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
        return send(200, asUser(out));
      }
      if (req.method === 'PUT' && id) {
        const out = await rpc('local_auth_admin_update', { p_id: id, p_password: body.password ?? null, p_ban: body.ban_duration ?? null });
        if (out?.error) return send(404, { msg: 'User not found' });
        return send(200, asUser(out));
      }
      if (req.method === 'GET' && id) {
        const out = await rpc('local_auth_admin_get', { p_id: id });
        if (!out) return send(404, { msg: 'User not found' });
        return send(200, asUser(out));
      }
      if (req.method === 'DELETE' && id) {
        await rpc('local_auth_admin_delete', { p_id: id });
        return send(200, {});
      }
      return send(405, { msg: 'not provided by the local stack' });
    }
    if (url.pathname === '/auth/v1/token') {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const claims = verify(body.refresh_token);
      if (!claims?.sub) return send(400, { error: 'invalid_grant' });
      const access = sign({ sub: claims.sub, role: 'authenticated', aud: 'authenticated', email: claims.email });
      return send(200, { access_token: access, refresh_token: body.refresh_token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email } });
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const headers = { ...req.headers };
      delete headers.host;
      delete headers['content-length'];
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      const r = await fetch(PGRST + url.pathname.slice('/rest/v1'.length) + url.search, { method: req.method, headers, body });
      const out = Buffer.from(await r.arrayBuffer());
      const h = { ...cors };
      r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k)) h[k] = v; });
      res.writeHead(r.status, h);
      return res.end(out);
    }
    return send(404, { message: `not provided by the local stack: ${url.pathname}` });
  } catch (e) {
    return send(500, { message: String(e) });
  }
}).listen(54321, '127.0.0.1', () => console.log('gateway on :54321'));

const emails = [];
let n = 0;
http.createServer(async (req, res) => {
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'POST' && req.url.startsWith('/emails')) {
    const id = `local-${Date.now()}-${++n}`;
    emails.push({ id, at: new Date().toISOString(), body: JSON.parse((await readBody(req)).toString() || '{}') });
    return json(200, { id });
  }
  if (req.method === 'GET' && req.url.startsWith('/emails')) return json(200, emails);
  if (req.method === 'DELETE' && req.url.startsWith('/emails')) { emails.length = 0; return json(200, {}); }
  return json(404, {});
}).listen(54400, '127.0.0.1', () => console.log('fake resend on :54400'));
