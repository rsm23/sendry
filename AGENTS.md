# Sendry engineering guide

This file is the operating contract for agents and contributors working anywhere in this repository. Preserve these conventions unless a task explicitly changes the product direction.

## Product and scope

Sendry is a self-hosted multi-channel marketing and conversations platform. It combines campaign operations, audiences, automations, templates, reports, files, safety rules, provider connections, a unified inbox, web chat, browser voice, and account administration in one multi-brand workspace.

The product is intentionally broad. Email, SMS, WhatsApp, push, chat, inbound email, and calls are first-class channels. Do not reduce a feature to email-only assumptions when its domain model is channel-aware. Customer data, credentials, and delivery operations remain controlled by the Sendry installation.

## Stack and boundaries

- Web: React 19, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS v4, shadcn/Base UI, Lucide, Recharts.
- API: Node.js, Express, Zod validation, HTTP-only sessions and bearer tokens.
- Data: SQLite currently owns authentication and compatibility product areas; PostgreSQL/Drizzle owns native multi-channel contacts, campaigns, connections, conversations, and deliveries.
- Async/realtime: Redis, BullMQ, Socket.IO.
- Files: S3-compatible object storage with a local quarantine path and ClamAV scanning.
- Providers: SMTP/SES email, Twilio/Vonage SMS, Meta/Twilio/Vonage WhatsApp, Web Push/FCM, IMAP inbound email, Twilio browser voice.

Key locations:

- `src/pages/`: route-level product surfaces.
- `src/components/`: shared application components; `src/components/ui/` contains shadcn primitives.
- `src/i18n/`: locale registry, runtime, and JSON catalogs.
- `server/app.ts`: session-authenticated and compatibility API surface.
- `server/multichannel/`: PostgreSQL-native channel domain, providers, policy, storage, and v2 routes.
- `server/worker.ts` and `server/multichannel-worker.ts`: scheduled and queued work.
- `server/scripts/`: seed and import tooling.
- `drizzle/`: reviewed, versioned PostgreSQL migrations.
- `tests/` and `tests/e2e/`: API/unit and rendered product coverage.
- `docs/`: product, API, local-development, localization, and operations runbooks.
- `site/`: static public product showcase; it is separate from the administration app.

## UI philosophy

Sendry should feel like an operational workspace: calm, dense enough for serious work, highly legible, and explicit about state. Prefer clear hierarchy, compact controls, useful empty states, visible system status, and predictable tables over decorative dashboards. Preserve the current restrained geometry, small radii, blue action color, warm light canvas, and deep neutral dark canvas.

Every UI change must work at desktop and mobile widths, with keyboard navigation, visible focus, meaningful accessible names, and no pointer-only action. Loading, empty, error, disabled, destructive, and success states are part of the feature. Use semantic HTML before ARIA. Icons support labels; they do not replace labels unless the control has an accessible name and the icon is universally understood.

Do not hard-code app surfaces to white or black. Use semantic tokens: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `primary`, `destructive`, and their foreground partners. Fixed colors are acceptable inside email/message/device previews only when they represent content that will actually be delivered.

Use logical direction utilities everywhere: `start/end`, `ms/me`, `ps/pe`, `border-s/border-e`, and `text-start/text-end`. Do not add physical `left/right`, `ml/mr`, or `pl/pr` layout utilities to page/application components. Arabic RTL is a release requirement, not optional polish.

## shadcn usage

The shadcn configuration is in `components.json`. Reuse a primitive from `src/components/ui/` before creating a local replacement. Compose primitives in feature components; do not fork basic Button, Input, Dialog, Select, Sheet, Table, Tabs, Dropdown, Field, Card, or Toast behavior inside pages.

Application UI controls must use shadcn primitives or shared feature components composed from them. This is a non-negotiable consistency rule:

- Use `Input`, `Textarea`, `Checkbox`, `Switch`, `RadioGroup`, `Select`, `NativeSelect`, `ToggleGroup`, and `Button` instead of styling raw HTML form controls in pages or feature components.
- Use the shared `DatePicker` and `DateTimePicker` from `src/components/date-picker.tsx` for date and date-time selection. They compose shadcn `Calendar`, `Popover`, `Input`, `Field`, and `Button`; do not ship bare `input[type=date]` or `input[type=datetime-local]` controls in the administration app.
- Put `SelectItem` elements inside `SelectGroup`, and use `FieldGroup`, `Field`, `FieldLabel`, `FieldDescription`, and `FieldError` to structure forms and validation.
- Product-specific wrappers belong in `src/components/`, while generic shadcn primitives stay in `src/components/ui/`. Search the installed components and read the current shadcn docs before adding or recreating a control.
- Raw controls are allowed only when they are part of customer-authored or delivered HTML, portable embed-code examples, email/message previews, or a browser capability that cannot be expressed through an installed primitive. Keep those exceptions isolated and document why they cannot use the shared component.

Keep shadcn primitives generic and product copy out of them. Product-specific state belongs in shared components outside `ui/` or in the route. Preserve Base UI interaction and accessibility behavior when styling. Use `cn()` for conditional class composition and CVA for reusable variants. Never edit a primitive solely to fix one screen when a wrapper or caller class is sufficient; primitive changes must be validated across all consumers and in RTL.

When adding a shadcn component, use the existing aliases and Tailwind setup. Review generated code before keeping it, convert physical positioning to logical positioning where appropriate, and verify light, dark, LTR, and RTL behavior.

## Themes

Supported preferences are `system`, `light`, and `dark`. `I18nProvider` owns the root theme class, `data-theme`, `color-scheme`, and theme-color metadata. The inline initializer in `index.html` must stay consistent with it so the first paint does not flash the wrong theme.

Theme selection is available before authentication, persisted in `localStorage` as `sendry_theme`, and synchronized with the authenticated profile. Do not toggle the root class directly from a page. Use `useI18n().setTheme()` or `PreferencesMenu`.

All semantic status colors require readable dark variants. Check contrast for normal, muted, disabled, focus, hover, selected, destructive, chart, sidebar, popover, dialog, and toast states. A build is not visual verification.

## Languages and RTL

The supported administration locales are:

- `en`: English, LTR
- `fr`: Français, LTR
- `es`: Español, LTR
- `ar`: العربية, RTL

`src/i18n/catalog.ts` is the single locale registry. Each locale has a complete JSON catalog under `src/i18n/locales/`. English source phrases are stable message keys. The runtime sets document `lang` and `dir`, localizes existing static JSX at the app boundary, and exposes `useI18n()` for explicit and dynamic messages. Locale selection is persisted as `sendry_locale` and synchronized with the user profile.

Rules for every new feature:

1. No new user-visible English may ship in only one locale. This includes headings, form labels, placeholders, accessible names, tooltips, dialogs, toasts, validation messages, empty states, table labels, chart labels, onboarding, and public widget copy.
2. Run `node scripts/i18n/extract.mjs`, then translate every new key in `fr.json`, `es.json`, and `ar.json`. Never translate keys; translate values only.
3. Use `const { t } = useI18n()` for dynamic copy and interpolation: `t('{count} recipients', { count })`. Static JSX is extracted, but explicit `t()` is preferred for reusable logic and tests.
4. Format numbers, percentages, dates, times, currencies, and relative times through locale-aware helpers. Do not pass a hard-coded `'en'` locale to `Intl`.
5. Do not translate customer-authored content, brand/user/audience/campaign/file names, addresses, URLs, provider identifiers, API enum values, or delivered message/email HTML. Put the standard `translate="no"` attribute on dynamic customer/data subtrees. Reserve `data-i18n-ignore` for application-owned technical previews that must stay verbatim.
6. New locale support requires one catalog, registry metadata/direction, API validation, parity tests, and rendered LTR/RTL QA. See `docs/LOCALIZATION.md`.

Source content language (`web_language`, provider template language, marketplace/provider text) is domain data and remains distinct from the administrator interface locale.

## React and data flow

Keep route modules lazy-loaded in `src/App.tsx`. Use TanStack Query for server state, stable query keys scoped by brand/resource, and invalidation after mutations. Do not mirror query results into local state unless the user is editing a draft. Run independent requests in parallel and avoid request waterfalls.

Keep permissions enforced on both client and server. Client filtering improves UX but is never authorization. Brand ownership, workspace scope, capability flags, and granular v2 scopes must be checked server-side.

Prefer derived render state over effects. Keep global browser listeners deduplicated and cleaned up. Do not read local storage repeatedly during render; the preference provider owns its cached values. Route pages should remain domain-focused and extract reusable, independently testable components when they become difficult to scan.

## API, security, and providers

Validate request bodies with Zod at the route boundary. Legacy endpoints return an `error` string; v2 endpoints use stable `{ error, code, details? }` errors. Keep API enum values stable and do not localize protocol payloads.

Provider and AI secrets are write-only: retain configured secrets when a masked input is submitted empty, provide an explicit removal action, encrypt at rest with `CREDENTIAL_ENCRYPTION_KEY`, and never return or log plaintext. Webhooks must validate signatures against the raw body before parsing and deduplicate provider event identifiers.

Every send path must preserve consent, suppression, blocked-domain, allowance, quiet-hour, purpose, sender-identity, and channel-policy checks at queue time. Queue jobs and provider calls require deterministic delivery/idempotency identifiers. Retries must be safe. Keep the local stream provider non-delivering and suitable for tests.

Public chat/push endpoints require signed sessions, origin checks, bounded payloads, and rate limits. Uploads stay quarantined until type, size, and malware checks pass. Never weaken tenant/brand filters for convenience.

## Databases, migrations, and seed data

Change `server/multichannel/schema.ts` first for PostgreSQL schema work, then run `pnpm db:generate`. Review generated SQL before applying it. Migrations are production-safe and contain no demo data. `pnpm db:seed` is deterministic and idempotent; preserve stable demo IDs and never delete user-created records during a normal seed.

Do not collapse the SQLite/PostgreSQL boundary casually. Import work must keep the source read-only, support dry-run reconciliation, and preserve ownership, consent, status, referenced media, and channel semantics.

## Verification and definition of done

Use the smallest relevant checks while iterating, then run the full gates for a completed feature:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm verify` runs lint, typecheck, unit/API tests, and the production build. Rendered UI work additionally requires browser QA; a passing build is not sufficient. Test at least desktop and one mobile viewport, console health, the changed interaction, keyboard/focus behavior, both themes, and all four locales. Arabic must be inspected for reading order, sidebar side, logical spacing, popover/dialog placement, icon direction, overflow, tables, and mixed Latin/Arabic content.

For locale changes, catalog parity and `tests/i18n.test.ts` must pass. For migrations, prove migration from a clean database, idempotent seed, restart persistence, and the documented start path. For providers, use stream/sandbox test paths and never contact real recipients during automated QA.

Preserve unrelated worktree changes. Stage only intended files. Run `git diff --check` before handoff. Do not commit, push, deploy, reset data, or remove volumes unless the user explicitly requests it.

## Local workflow

First run:

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev:setup
pnpm dev
```

Daily startup is `pnpm dev:services` followed by `pnpm dev`. The Vite web app is `http://127.0.0.1:5173`; the API is `http://127.0.0.1:4010`. The seeded local account is documented in `README.md` and `docs/LOCAL_DEVELOPMENT.md`. Never put production credentials in tests, fixtures, screenshots, or documentation.

Before changing operations, deployment, provider setup, API behavior, or the compatibility data boundary, read the corresponding file in `docs/` and update it with the code.
