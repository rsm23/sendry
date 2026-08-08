# Product capabilities

## Workspace and access

- Guided first-run setup for the owner, workspace, and first brand
- Multiple brands with isolated identity, audiences, messages, files, and provider configuration
- Brand duplication and guarded deletion
- Owner, administrator, and client accounts
- Per-brand permissions for campaigns, templates, audiences, automations, reports, files, rules, and settings
- Profile language, time zone, theme, name, and email preferences

## Authentication and account security

- Password login and password reset links
- Time-based authenticator codes with eight single-use recovery codes
- WebAuthn passkey registration, sign-in, naming, and removal
- HTTP-only session cookies, expiry, and sign-out
- Bearer API tokens with one-time secret display and revocation

## Brand and delivery settings

- Sender name, sender address, reply-to, logo, and test-prefix defaults
- SendGrid, Mailjet, and Elastic Email presets with provider-specific hosts, ports, authentication labels, and TLS defaults
- Custom SMTP host, port, credentials, direct TLS, and required STARTTLS
- Native Amazon SES v2 delivery with region, optional access keys, deployment identity support, and configuration sets
- Credential-safe provider switching and live SMTP or Amazon SES connection verification
- Local stream delivery for complete non-delivering tests
- Per-brand custom domain for tracking and subscriber links
- Attachment extension allowlist
- Identified, anonymous, or disabled open and click tracking
- Brand privacy mode that forces enabled campaign and automation tracking to anonymous collection
- Campaign-completion notification and authenticated RSS switch
- Per-brand monthly allowance, reset day, and carry-over option
- Fixed and per-recipient campaign fees in EUR, USD, or GBP

## Campaigns

- Draft, queued, scheduled, sending, stopped, sent, and failed states
- Label, subject, sender, reply-to, HTML, plain text, language, and query-string controls
- Block, visual, and source editing modes with responsive preview
- Template application and campaign duplication
- Include or exclude whole audiences and dynamic segments
- Attachment selection from the brand file library
- Link checking option, test sends to multiple addresses, recipient estimate, and fee quote
- Immediate delivery, local-time scheduling, stop, and resume
- Personalization tags for name, email, custom fields, current date values, unsubscribe, and preferences
- Fallback personalization syntax
- Open pixels, tracked links, provider event ingestion, bounces, and complaints
- Report metrics, timeline, geography, link results, recent activity, CSV exports, and activity-to-audience import

## AI assistance

- Complete email generation from a goal, design direction, and requirements
- Subject suggestions in concise, curiosity, value, and personal modes
- Copy improvement with a supplied instruction
- Pre-send content score and prioritized advice
- Campaign performance score and evidence-based recommendations
- Persisted analyses that can be closed, reopened, and regenerated
- Per-brand feature switch and provider key
- Deterministic local assistance when no provider key is configured

## Audiences and subscribers

- Audience creation, opt-in mode, visibility, ordering, and deletion
- Subscriber search, status, source, and country filters
- Subscriber creation, profile editing, notes, consent, country, status, and custom values
- Header-based CSV upload, pasted address import, skip counts, and full CSV export
- Active, unconfirmed, unsubscribed, bounced, and complaint states
- Text, date, number, and boolean custom fields
- Dynamic segments with all/any matching, condition groups, and live counts
- Hosted form, signed embeddable form token, selectable fields, and custom inputs
- Explicit marketing permission and expectation copy
- Optional reCAPTCHA verification
- Single and double opt-in flows
- Configurable success, confirmation, existing-subscriber, no-consent, and unsubscribe redirects
- Confirmation, thank-you, and goodbye messages
- Topic preference center and list-wide or brand-wide unsubscribe
- Consent and preference event evidence

## Automations

- Drip series triggered by activation
- Annual messages driven by a date custom field
- One-time messages driven by a date custom field
- Before/after offsets in minutes, hours, days, weeks, or months
- Step creation, editing, enabling, ordering, and deletion
- AI email drafting, subject suggestions, copy improvement, personalization, HTML and plain text
- Segment inclusion and exclusion per step
- Identified, anonymous, or disabled tracking per step
- Suppression, blocked-domain, consent, status, and allowance checks at delivery time
- Delivered, failed, unique-open, and unique-click reporting per step
- Persisted AI performance scoring and recommendations across the whole automation

## Operations and integrations

- Reusable templates with source editing, URL import, duplication, preview, and AI generation
- Brand-scoped folder and file manager with upload, rename, navigation, and recursive cleanup
- Event rules for subscribe, unsubscribe, campaign start, campaign completion, and automation delivery
- Webhook, notification email, and audience unsubscribe actions
- Webhook attempt log with response codes and bodies
- Suppressed addresses and blocked domains applied to forms, imports, API writes, campaigns, and automations
- Subscriber housekeeping for stale or inactive records
- PayPal Orders checkout and capture with a local test checkout when credentials are absent
- Public JSON API for brands, audiences, subscriber state, counts, campaigns, and delivery
- Provider feedback endpoint for delivery, bounce, and complaint events
- Signed public links, RSS output, background jobs, retry state, and audit records
