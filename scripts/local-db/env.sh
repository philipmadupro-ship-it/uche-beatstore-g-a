# source scripts/local-db/env.sh — point the app at the local stack.
_LOCAL_DB_HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY=$(node -e "import('$_LOCAL_DB_HERE/jwt.mjs').then(m => console.log(m.ANON_KEY))")
export SUPABASE_SERVICE_ROLE_KEY=$(node -e "import('$_LOCAL_DB_HERE/jwt.mjs').then(m => console.log(m.SERVICE_KEY))")
export NEXT_PUBLIC_APP_URL=http://localhost:3457
export RESEND_API_KEY=re_local
export RESEND_BASE_URL=http://127.0.0.1:54400
export RESEND_FROM_EMAIL=studio@local.test
export SHARE_MEDIA_TOKEN_SECRET=local-share-media-secret
export E2E_REAL_DB=1
export CRON_SECRET=local-cron
