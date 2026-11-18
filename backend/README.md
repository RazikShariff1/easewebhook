# EaseWebhook backend (Go + GoFr)

Webhook gateway: receive on a source URL → route through connections (filter / transform / delay) → deliver to destinations with retries.

## Run
```bash
cd backend
cp configs/.env.example configs/.env   # fill DB_PASSWORD
go run .
```
API on `:8000`, GoFr metrics on `:2121`. Migrations run on startup.
Supabase note: `db.<ref>.supabase.co` is IPv6-only, so we use the IPv4 session pooler
(`aws-1-ap-southeast-1.pooler.supabase.com`, user `postgres.<ref>`).

## Concepts
| Entity | ID prefix | Notes |
|---|---|---|
| Source | `src_` | public URL `PUBLIC_INGEST_BASE_URL/<key>`; optional verification (hmac / api_key / basic_auth) |
| Destination | `des_` | URL, auth (NONE, BEARER_TOKEN, BASIC_AUTH, API_KEY, EASE_SIGNATURE), rate limit, path forwarding |
| Connection | `web_` | source → destination with ordered `rules` |
| Transformation | `trs_` | JS: `addHandler("transform", (request, context) => request)`, `process.env` |
| Request | `req_` | every inbound HTTP call |
| Event | `evt_` | one per (request × connection); QUEUED, SCHEDULED, SUCCESSFUL, FAILED, HOLD, CANCELLED |
| Attempt | `atm_` | each delivery try (INITIAL / AUTOMATIC / MANUAL) |

Rules: `{"type":"filter","body":{...},"headers":{...}}`, `{"type":"transform","transformation_id":"trs_..."}`,
`{"type":"retry","strategy":"linear|exponential","count":5,"interval":60000}`, `{"type":"delay","delay":5000}`.
Filter operators: `$eq $neq $gt $gte $lt $lte $in $nin $startsWith $endsWith $exist $or $and $not`.

## API (all JSON, responses wrapped in `{"data": ...}`; lists return `{models, count, next}`)
- Ingest: `ANY /e/{source_key}[/sub/path]`
- `GET|POST /sources`, `GET|PUT|DELETE /sources/{id}`, `PUT /sources/{id}/disable|enable`
- `GET|POST /destinations`, `GET|PUT|DELETE /destinations/{id}`, `PUT /destinations/{id}/disable|enable`
- `GET|POST /transformations`, `GET|PUT|DELETE /transformations/{id}`, `POST /transformations/run` (test code)
- `GET|POST /connections` (inline `source`/`destination` by name upserts them), `GET|PUT|DELETE /connections/{id}`, `PUT /connections/{id}/pause|unpause|disable|enable`
- `GET /requests`, `GET /requests/{id}`, `GET /requests/{id}/events`
- `GET /events` (filters: status, connection_id, source_id, destination_id, response_status, error_code, from, to, search, body=JSON containment, `include=data`), `GET /events/histogram?buckets=48`, `GET /events/{id}`, `GET /events/{id}/attempts`, `POST /events/{id}/retry|cancel`
- `POST /bulk/events/retry|cancel` with `{"query": {...same filters}}`
- `GET /attempts?event_id=`, `GET /attempts/{id}`, `GET /stats` (24h counters for list pages)

Delivery worker: leases due events with `FOR UPDATE SKIP LOCKED`, so several instances can run safely
(rate limiting is in-memory per instance for now).

## Auth
- `POST /auth/signup {name, email, password}`, `POST /auth/login {email, password}`,
  `POST /auth/google {credential}` (Google Identity Services ID token, verified against `GOOGLE_CLIENT_ID`)
  → `{token, expires_at, user}`. `GET /auth/me`, `GET /auth/config` (public: Google client ID for the frontend).
- Every management route needs `Authorization: Bearer <token>` (HS256, 7 days, `JWT_SECRET`).
  Public: `/auth/*` above, `/e/*` (ingestion), `/.well-known/*`.
- A Google sign-in with the same verified email as an existing password account links to it.
- Data is scoped to workspaces (see below).

## Workspaces
- Every source, destination, transformation, connection, request and event belongs to a workspace.
  Management calls send `X-Workspace-Id: ws_...`; the middleware rejects users who aren't members (403).
  Ingestion (`/e/{key}`) needs no header: the source key decides the workspace.
- `GET|POST /workspaces`, `GET|PUT|DELETE /workspaces/{id}` (rename/delete: owners),
  `GET|POST /workspaces/{id}/members` (`{email, role}`: adds an existing user, or saves an invite that is accepted on sign-up),
  `PUT|DELETE /workspaces/{id}/members/{user_id}` (anyone can remove themselves = leave; a workspace always keeps one owner),
  `DELETE /workspaces/{id}/invites/{email}`.
- Roles: `owner` (manage workspace and members) and `member` (manage everything inside it).
- Each new user gets "<name>'s workspace". Data from before workspaces lives in `ws_default` ("Default").

## Source types
`GET /source-types` returns the catalog (`internal/sourcetypes`). Create a source with `{"type": "STRIPE", "config": {...}}`; the type can't change later, config is merged on update.
- **WEBHOOK**: any sender; optional generic verification (HMAC / API key / basic auth).
- **PUBLISH_API**: server-generated `api_key` (`ewk_...`), sent as `Authorization: Bearer` or `X-Api-Key`. Rotate with `POST /sources/{id}/rotate-key`.
- **HTTP**: browsers/SDKs/devices; CORS preflight answered, all methods allowed; optional generic verification.
- **Providers** (signature verified natively when the secret is set; empty secret = accept unverified):
  Stripe, GitHub, Shopify, Paddle, Razorpay, Cashfree, Facebook/Instagram/WhatsApp (+ `hub.challenge` GET handshake),
  Slack (+ `url_verification`), Discord (Ed25519 + PING), Twitch (+ callback verification), Clerk, Resend,
  Standard Webhooks/Svix, Zendesk, Typeform, Segment, Linear, GitLab, Bitbucket, WooCommerce, Mailgun, Intercom,
  Calendly, Vercel, Sentry, Cal.com, Postmark, Pipedrive.
  Timestamped schemes reject requests older than 5 minutes. Failed checks are stored as rejected requests with the reason.
- Add a provider: one `provider(...)` entry in `providers.go` plus a case in `providers_test.go`.
