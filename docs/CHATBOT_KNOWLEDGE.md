# Chatbot knowledge

Sendry chat widgets can opt into a widget-specific grounded knowledge agent. Existing human-only chat remains available when the feature is disabled or knowledge infrastructure is unavailable.

## Enablement

1. Configure the brand generation provider under Settings → AI & privacy.
2. Configure a separate embedding provider/model, or inherit a generation provider that exposes an embeddings API. Hosted providers receive document text; the administration UI warns before use.
3. In Channels → Chat, select a widget and attach clean Files or upload new knowledge files.
4. Wait until at least one source is `ready`.
5. Enable the brand `chat_ai` feature flag and then enable the widget knowledge agent.

Publishing requires brand Settings permission and Files manager access. Bearer integrations require `chatbots:write` plus Files write access. Secrets are encrypted and write-only.

## Supported documents

V1 indexes searchable PDF, DOCX, PPTX, XLSX, CSV, ODS, TXT, Markdown, and HTML up to 25 MB. It rejects scanned/image-only PDF, legacy `.doc`/`.ppt`/`.xls`, encrypted documents, macros, malformed archives, empty files, and unsupported media. Parsing never executes scripts, macros, links, or embedded objects.

Chunks preserve page, slide, sheet/row, section, or text locations with an approximate 800-token ceiling and 120-token overlap. PostgreSQL retains canonical text and locations. Qdrant stores vectors plus opaque identifiers and mandatory brand/widget/document filters.

## Answer and handoff policy

Retrieval fuses Qdrant dense candidates with lexical candidates, deduplicates them, and supplies at most eight bounded chunks. Documents are explicitly marked as untrusted reference material and cannot grant tools, URL access, workflow execution, or access to unattached Files.

The agent hands off when no source is ready, evidence is below the widget threshold, the model requests handoff, a provider fails, a visitor asks for a human, or a human claims/replies. The bot stays paused until an authorized agent selects Resume AI. Public visitors receive only the final message; inbox agents can inspect private evidence.

## File lifecycle and repair

Indexing is idempotent by widget, immutable file version, parser version, and embedding profile. A new version becomes active only after indexing completes. Trash/unlink excludes a source immediately and schedules vector cleanup. Provider/profile changes require reindexing before the new profile can serve answers.

Audit consistency without changing state:

```bash
pnpm knowledge:repair -- --dry-run
```

Rebuild affected chunks and all Qdrant vectors from immutable source files:

```bash
pnpm knowledge:repair -- --rebuild-vectors
```

Use `--brand=BRAND_ID` to limit either command. Back up PostgreSQL, every immutable source-file object, and Qdrant snapshots; validate restore isolation and handoff behavior in a private environment.
