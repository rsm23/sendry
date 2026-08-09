# Sendry

Sendry is a self-hosted multi-channel marketing and conversations platform. It combines a React administration interface with a Node.js API, PostgreSQL, Redis/BullMQ, Socket.IO, and S3-compatible media storage. The previous SQLite email engine remains available as a phased compatibility bridge for `/api/v1` and rollback-safe imports.

## Product areas

- Multi-brand workspaces with client accounts and area-level permissions
- Native Amazon SES v2, SendGrid, Mailjet, Elastic Email, custom SMTP, and local stream delivery transports
- Campaign creation with visual, block, and HTML editing modes
- Audience inclusion and exclusion using lists or live segments
- Test sends, scheduling, stop/resume, attachments, personalization, and query parameters
- Open and click tracking with identified, anonymous, and disabled modes
- Delivery reports, activity exports, link metrics, geography, and AI performance analysis
- Subscriber profiles, CSV import/export, custom fields, notes, consent evidence, and status management
- Hosted and embeddable forms with single or double opt-in and optional reCAPTCHA
- Preference center, scoped unsubscribe, confirmation, thank-you, and goodbye emails
- Drip, annual, and one-time date automations with segment controls and per-step reports
- Templates, file manager, rules, webhooks, suppression lists, blocked domains, and housekeeping
- AI email generation, subject suggestions, copy improvement, content scoring, and report analysis
- Per-brand message allowances, optional campaign fees, and PayPal checkout
- Password, authenticator, recovery-code, and passkey authentication
- Complete system, light, and dark themes with English, French, Spanish, and Arabic RTL administration
- Bearer-token API, RSS feeds, provider feedback events, audit records, and background job visibility
- Email, SMS, WhatsApp, and Push campaigns with mixed-channel automation steps
- Twilio and Vonage SMS; Twilio, Meta, and Vonage WhatsApp; Web Push and FCM
- Unified email, SMS, WhatsApp, web chat, and call inbox with assignment and SLA queues
- Twilio browser voice, embeddable sandboxed chat, realtime presence, and message status

The full product surface is catalogued in [docs/FEATURES.md](docs/FEATURES.md).

The static product showcase lives in [`site/`](site/) and is deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml). Preview it locally with `python3 -m http.server 4173 --directory site`.

## Quick start

Requirements for local frontend/API work: Node.js 24+ and pnpm 11+. The complete stack also requires PostgreSQL, Redis, S3-compatible storage, and ClamAV; Docker Compose supplies all four.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev:setup
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). Development mode includes a complete demonstration workspace:

```text
Email: qa@sendry.local
Password: TestPass123!
```

The local stream transport exercises the complete send pipeline without contacting external recipients. Use Channels to add write-only provider credentials and test each connection before enabling a brand feature flag.

For migration, seed, Docker-only, reset, and daily-start commands, see [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

## Verification

```bash
pnpm test
pnpm test:e2e
pnpm test:coverage
pnpm verify
```

`pnpm verify` runs linting, both TypeScript projects, API and unit tests, and the production build. Playwright covers desktop Chromium and an iPhone-sized viewport.

## Production

```bash
pnpm build
NODE_ENV=production APP_URL=https://mail.example.com pnpm start
```

In production, the API serves the compiled web application from the same process. Set independent strong `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` values, configure `DATABASE_URL`, `REDIS_URL`, object storage and ClamAV, and use a public HTTPS `APP_URL`. Run `pnpm db:migrate` before the API/worker release.

Container instructions, backups, environment variables, and provider setup are in [docs/OPERATIONS.md](docs/OPERATIONS.md). API routes and examples are in [docs/API.md](docs/API.md).
