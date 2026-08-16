# HTTP API

## Authentication

The administration interface uses an HTTP-only session cookie. Integrations use a bearer token created in Settings:

```http
Authorization: Bearer snd_example
Content-Type: application/json
```

Tokens are workspace-scoped. Brand and audience ownership checks apply to every request. `/api/v2` additionally enforces granular scopes such as `contacts:*`, `campaigns:*`, `messages:send`, `conversations:*`, `providers:*`, `chatbots:read`, `chatbots:write`, and `calls:use`.

`/api/v1` remains backward compatible. New channel-aware integrations should use `/api/v2`; v2 failures always use `{ "error": string, "code": string, "details"?: unknown }`.

## Multi-channel v2

| Method | Route | Required scope |
| --- | --- | --- |
| `GET/POST` | `/api/v2/brands/:brandId/contacts` | `contacts:read` / `contacts:write` |
| `GET` | `/api/v2/brands/:brandId/contacts/:contactId` | `contacts:read` |
| `POST` | `/api/v2/brands/:brandId/contacts/:contactId/consents` | `contacts:write` |
| `GET/POST` | `/api/v2/brands/:brandId/campaigns` | `campaigns:read` / `campaigns:write` |
| `POST` | `/api/v2/brands/:brandId/campaigns/:id/send` | `campaigns:send` |
| `POST` | `/api/v2/messages` | `messages:send` |
| `GET/PATCH` | `/api/v2/brands/:brandId/conversations/:id` | `conversations:read` / `conversations:write` |
| `POST` | `/api/v2/brands/:brandId/conversations/:id/replies` | `conversations:write` |
| `GET/POST` | `/api/v2/brands/:brandId/connections` | `providers:read` / `providers:write` |
| `POST` | `/api/v2/brands/:brandId/connections/:id/test` | `providers:write` |
| `GET/POST` | `/api/v2/brands/:brandId/sender-identities` | `providers:read` / `providers:write` |
| `POST` | `/api/v2/brands/:brandId/calls/token` | `calls:use` |
| `GET/PATCH` | `/api/v2/brands/:brandId/chatbots[/:widgetId]` | `chatbots:read` / `chatbots:write` |
| `GET/POST/DELETE` | `/api/v2/brands/:brandId/chatbots/:widgetId/knowledge[/documentId]` | `chatbots:read` / `chatbots:write` plus Files access |
| `POST` | `/api/v2/brands/:brandId/chatbots/:widgetId/test` | `chatbots:read` |
| `POST` | `/api/v2/brands/:brandId/chatbots/reindex` | `chatbots:write` plus Files access |

Campaign and transactional content is discriminated by `channel`. Every request declares `marketing`, `transactional`, or `support` purpose. For example:

```json
{
  "brand_id": "brd_example",
  "contact_id": "ctc_example",
  "sender_identity_id": "snd_example",
  "purpose": "transactional",
  "content": {
    "channel": "whatsapp",
    "body": "Your order is on its way.",
    "template": {
      "name": "delivery_update",
      "language": "en",
      "variables": { "1": "Ada", "2": "A-123" }
    },
    "media": [],
    "buttons": []
  }
}
```

`POST /api/v2/messages` requires an `Idempotency-Key`. Reusing the key with the identical request replays the original status/body; changing the request returns `409 IDEMPOTENCY_CONFLICT`.

## Provider and inbound endpoints

Provider callbacks are connection-specific and validate the signature against the raw request body before parsing:

```text
POST /api/v2/webhooks/twilio/:connectionId
POST /api/v2/webhooks/vonage/:connectionId
POST /api/v2/webhooks/meta/:connectionId
POST /api/v2/webhooks/email/sendgrid/:connectionId
POST /api/v2/webhooks/email/ses/:connectionId
```

Duplicate provider event identifiers are acknowledged but not processed twice. `STOP`, `ARRET`, and equivalent inbound keywords create a suppression and cancel matching queued deliveries immediately.

The public chat/push surface is under `/api/v2/public`. The chat loader validates its embedding-site Referer and issues a five-minute launch token. Visitor sessions are signed, persisted, conversation-bound, and used to authenticate Socket.IO. `GET /api/v2/public/widget/:publicKey/messages` provides cursor-based reconnect history. Public message serialization never includes retrieval sources, filenames, excerpts, scores, provider details, or internal notes. The same-origin browser push assets are `/sendry-push.js` and `/sendry-sw.js`.

## Files workspace

Files remain in the authenticated SQLite compatibility domain. All byte access is authorized separately from metadata; `/uploads` is not a public route.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/brands/:brandId/files` | List files using `parentId`, `view`, `q`, `type`, `owner`, `sort`, `direction`, `cursor`, and `limit` |
| `POST` | `/api/brands/:brandId/files/folder` | Create a folder |
| `POST` | `/api/brands/:brandId/files/upload` | Quarantine, inspect, scan, and store one or more files |
| `GET/PATCH/DELETE` | `/api/brands/:brandId/files/:fileId` | Read, update, or soft-delete an item |
| `GET` | `/api/brands/:brandId/files/:fileId/content` | Serve an authorized current or requested immutable version; supports ranges locally |
| `POST` | `/api/brands/:brandId/files/bulk` | Move, copy, star, trash, or restore selected items |
| `GET` | `/api/brands/:brandId/files/bulk/download?ids=` | Stream a ZIP of accessible files and recursive folder contents |
| `GET/POST` | `/api/brands/:brandId/files/:fileId/versions` | List versions or upload a new immutable version |
| `POST` | `/api/brands/:brandId/files/:fileId/versions/:versionId/restore` | Create a new current version from old immutable bytes |
| `GET/PUT` | `/api/brands/:brandId/files/:fileId/access[/userId]` | Inspect or change member ACLs |
| `GET/POST` | `/api/brands/:brandId/files/:fileId/comments` | Read or create file-level and version-bound discussions |
| `GET/POST` | `/api/brands/:brandId/files/:fileId/shares` | List or create external links; the raw token is returned once |
| `GET` | `/api/brands/:brandId/files/:fileId/activity` | Read file audit events |

Each listed item includes its `effective_role`, current immutable version, star/share state, comment count, `preview_kind`, and a precise `preview_reason` when unsupported. The legacy create/upload/update routes retain their existing paths, while `DELETE` now means soft deletion.

Public link metadata and content use `/api/share/files/:token` and `/api/share/files/:token/content`. Passwords are supplied in `X-Share-Password`, download requests are rejected unless explicitly enabled, and an allowed folder download streams a recursive ZIP from the same content route with `?download=1`. Folder traversal stops at descendants that break permission inheritance. Responses are rate-limited with `noindex`, no-referrer, no-store, and content security headers. ZIP responses are built as streams and are never written to server storage.

## Integration routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/brands` | List accessible brands |
| `GET` | `/api/v1/brands/:brandId/lists` | List visible audiences; add `?include_hidden=1` when needed |
| `POST` | `/api/v1/lists/:listId/subscribers` | Create or update a subscriber |
| `GET` | `/api/v1/lists/:listId/subscribers/count` | Count active subscribers |
| `GET` | `/api/v1/lists/:listId/subscribers/status?email=` | Read subscription status |
| `DELETE` | `/api/v1/lists/:listId/subscribers?email=` | Remove a subscriber record |
| `POST` | `/api/v1/brands/:brandId/campaigns` | Create a campaign |
| `GET` | `/api/v1/brands/:brandId/campaigns/:campaignId` | Read campaign state |
| `POST` | `/api/v1/brands/:brandId/campaigns/:campaignId/send` | Queue delivery |

## Subscriber example

```bash
curl -X POST https://mail.example.com/api/v1/lists/LIST_ID/subscribers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "status": "active",
    "custom_values": { "Company": "Analytical Engine Co." },
    "consent": true,
    "notes": "Imported from product registration"
  }'
```

Valid subscriber states are `active`, `unconfirmed`, `unsubscribed`, `bounced`, and `complaint`.

## Campaign example

```bash
curl -X POST https://mail.example.com/api/v1/brands/BRAND_ID/campaigns \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Product notes",
    "label": "Monthly update",
    "from_name": "Product Team",
    "from_email": "hello@example.com",
    "reply_to": "support@example.com",
    "plain_text": "Read the update. [unsubscribe]",
    "html_text": "<h1>Product notes</h1><p>[unsubscribe]</p>",
    "editor_mode": "html",
    "editor_data": {},
    "attachments": [],
    "query_string": "utm_source=email",
    "web_language": "en",
    "opens_tracking": "identified",
    "clicks_tracking": "identified",
    "check_links": true,
    "targets": [{ "kind": "list", "target_id": "LIST_ID", "mode": "include" }]
  }'
```

Targets support `list` and `segment` kinds with `include` or `exclude` modes. A campaign must include at least one eligible recipient before it can be queued.

## Provider feedback

Delivery providers can submit normalized event payloads to:

```text
POST /api/provider-events/:provider
```

The endpoint recognizes common delivery, bounce, and complaint names. Include `campaignId` and `subscriberId` in the payload, or forward the `X-Sendry-Campaign` and `X-Sendry-Subscriber` headers attached to outbound campaign messages.

When `PROVIDER_EVENT_SECRET` is configured, include it as a bearer credential:

```http
Authorization: Bearer your-provider-event-secret
```

## Errors

Legacy JSON errors use an `error` string. V2 adds a stable `code`; validation failures also include structured `details`. Common status codes are:

- `401`: authentication required or invalid credentials
- `403`: brand or product-area permission denied
- `404`: resource not found within the selected brand
- `409`: state conflict, blocked address, or exhausted allowance
- `422`: invalid input or a target from another brand
- `402`: campaign checkout is required before delivery
