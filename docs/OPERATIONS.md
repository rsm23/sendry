# Operations

## Environment variables

| Variable                | Default                 | Purpose                                                           |
| ----------------------- | ----------------------- | ----------------------------------------------------------------- |
| `PORT`                  | `4010`                  | HTTP listener                                                     |
| `HOST`                  | `127.0.0.1`             | HTTP bind address; the container image sets `0.0.0.0`             |
| `APP_URL`               | `http://localhost:5173` | Canonical public origin and WebAuthn origin                       |
| `DATABASE_URL`          | none                    | Required production PostgreSQL connection                         |
| `DATABASE_PATH`         | `./data/sendry.db`      | Read-only rollback/import source during phased cutover             |
| `REDIS_URL`             | none                    | BullMQ and Socket.IO Redis connection                              |
| `UPLOAD_DIR`            | `./data/uploads`        | Local quarantine path                                             |
| `SESSION_SECRET`        | local development value | Signed-link and session protection; set a random production value |
| `CREDENTIAL_ENCRYPTION_KEY` | none                | Required production AES-256-GCM provider-secret key               |
| `OBJECT_STORAGE_*`      | none                    | S3/MinIO endpoint, region, bucket and credentials                  |
| `CLAMAV_HOST` / `CLAMAV_PORT` | none / `3310`     | Attachment malware scanning service                               |
| `MAIL_TRANSPORT`        | `stream`                | Force `stream`, or allow each brand to choose `smtp` or `ses`     |
| `OPENAI_API_KEY`        | empty                   | Optional server-wide OpenAI key; a brand OpenAI key takes precedence |
| `AWS_REGION`            | `us-east-1`             | Default SES region                                                |
| `PAYPAL_CLIENT_ID`      | empty                   | PayPal REST client ID                                             |
| `PAYPAL_CLIENT_SECRET`  | empty                   | PayPal REST client secret                                         |
| `PAYPAL_ENVIRONMENT`    | `sandbox`               | `sandbox` or `live`                                               |
| `PROVIDER_EVENT_SECRET` | empty                   | Optional bearer secret required by the provider feedback endpoint |
| `SEED_DEMO`             | false in production     | Populate the demonstration workspace when set to `true`           |

## Container run

Create `.env` and set at least `APP_URL` and `SESSION_SECRET`, then run:

```bash
docker compose up --build
```

The service is available on port 4010. PostgreSQL, Redis AOF, MinIO, ClamAV definitions, and the rollback SQLite source use separate named volumes. The worker process is separate from the API.

## PostgreSQL migration and rollback

Apply versioned Drizzle migrations before starting new API/worker code:

```bash
pnpm db:migrate
```

Import the old database without modifying it:

```bash
pnpm db:import-sqlite --source ./data/sendry.db --dry-run --report ./data/import-dry-run.json
pnpm db:import-sqlite --source ./data/sendry.db --report ./data/import-report.json
```

The importer canonicalizes exact normalized emails within each brand, retains list membership/status/custom fields, migrates existing campaigns as `channel=email`, verifies referenced media, and writes row-count reconciliation. Keep the source database until at least one production release and a restore drill are complete.

## Backups

Use PostgreSQL-native base backups or managed snapshots, Redis AOF snapshots, and versioned object-storage replication. Store the old SQLite database untouched as the rollback source.

For a consistent online backup:

```bash
sqlite3 ./data/sendry.db ".backup './backups/sendry-$(date +%Y%m%d-%H%M%S).db'"
```

Validate recovery in an isolated environment by restoring PostgreSQL, Redis, media objects, and the legacy source, then running migration reconciliation and a stream-provider canary.

## Delivery providers

The stream transport produces complete MIME messages without opening an external connection. Use it for development, automated tests, and recovery checks.

The administration interface includes these production presets:

| Provider      | Delivery path     | Default endpoint             | Security                                            | Authentication                                   |
| ------------- | ----------------- | ---------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Amazon SES    | Native SES v2 API | Selected AWS region          | AWS SDK HTTPS                                       | Per-brand access keys or the deployment identity |
| SendGrid      | SMTP              | `smtp.sendgrid.net:587`      | Required STARTTLS                                   | Username `apikey`; API key as password           |
| Mailjet       | SMTP              | `in-v3.mailjet.com:465`      | Direct TLS                                          | API key and secret key                           |
| Elastic Email | SMTP              | `smtp.elasticemail.com:2525` | Required STARTTLS                                   | Dedicated SMTP username and password             |
| Custom SMTP   | SMTP              | Configurable                 | Direct TLS, required STARTTLS, or opportunistic TLS | Optional username and password                   |

Every SMTP connection requires at least TLS 1.2 and has bounded connection, greeting, and socket timeouts. The Test connection action authenticates with SMTP without sending a message. For Amazon SES, it calls the SES account endpoint in the selected region; the identity therefore needs `ses:GetAccount` for this test in addition to the delivery permissions used for sending.

Amazon SES accepts a region, configuration set, and optional per-brand credentials. When credentials are empty, the AWS SDK uses the deployment's configured identity. To use the Amazon SES SMTP interface instead, select Custom SMTP, enter the regional SES SMTP endpoint, and use region-specific SES SMTP credentials. SES SMTP credentials are different from AWS access keys.

Provider and AI credentials are write-only in the administration interface. Existing secrets are retained when masked fields are saved blank, and each secret has an explicit removal control.

## AI providers

Settings → AI & privacy requires an explicit provider and model before AI can be enabled. Hosted providers are OpenAI, Anthropic, Mistral AI, Z.ai, Moonshot AI, and OpenRouter. Each brand key is encrypted with `CREDENTIAL_ENCRYPTION_KEY`, is never returned by the API, and is cleared when the provider changes so credentials cannot be reused across incompatible services. `OPENAI_API_KEY` remains an optional deployment fallback only when OpenAI is selected.

LM Studio and Ollama run without a hosted-provider key. Sendry discovers installed models server-side from LM Studio's OpenAI-compatible `/v1/models` endpoint or Ollama's `/api/tags` endpoint, then sends completions to `/v1/chat/completions` or `/api/chat`. The configured URL must resolve only to a loopback or private-network address. Defaults are `http://127.0.0.1:1234/v1` for LM Studio and `http://127.0.0.1:11434` for Ollama. When Sendry runs in a container, use a private address or `host.docker.internal` that is reachable from the API container.

## Worker behavior

BullMQ workers use deterministic delivery IDs and database idempotency records. They handle:

- activates scheduled campaigns;
- sends campaign and automation deliveries;
- applies allowances, consent rules, suppressions, and blocked domains;
- retries failed jobs with exponential delay;
- delivers rules and webhooks;
- resets monthly usage on each brand's configured day.
- raw provider-webhook normalization and deduplication;
- IMAP, template, retention, media-quarantine, and scheduling work.

Annual automations retain each delivery record and enqueue the next yearly occurrence after a successful send. Brand privacy mode forces enabled campaign and automation tracking to anonymous collection while preserving any explicitly disabled tracking mode.

Use Settings → API & jobs to inspect the latest jobs and errors.

## Production checklist

- Use a random secret of at least 32 bytes.
- Use a separate random `CREDENTIAL_ENCRYPTION_KEY`; never rotate it without a credential re-encryption procedure.
- Serve the application behind HTTPS and set the exact public `APP_URL`.
- Keep stream mode enabled until a test send succeeds for the selected provider.
- Verify sender identities, SPF, DKIM, DMARC, and provider feedback delivery.
- Keep the PayPal environment on sandbox until checkout and capture are confirmed.
- Back up the database and uploads, then perform a restore test.
- Restrict MinIO/S3 bucket access, require ClamAV, and verify signed URL expiry.
- Run provider sandbox/canary checks for every enabled brand/channel.
- Run `pnpm verify` and `pnpm test:e2e` for each release.
