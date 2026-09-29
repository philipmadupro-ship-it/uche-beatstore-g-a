// A Supabase-shaped front door for the local stack on :54321.
//   /rest/v1/*       → PostgREST on :3000 (real SQL, real RLS, real JWT roles)
//   /auth/v1/user    → the user in a JWT signed by jwt.mjs
//   /auth/v1/token   → refresh with that same JWT
// Plus a fake Resend on :54400 that records emails (GET /emails lists, DELETE clears).
import http from 'node:http';
import { sign, verify } from './jwt.mjs';

const PGRST = process.env.LOCAL_PGRST_URL ?? 'http://127.0.0.1:3000';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };

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
      return send(200, { id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
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
