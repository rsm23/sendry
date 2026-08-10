# Localization and themes

Sendry ships in English (`en`), French (`fr`), Spanish (`es`), and Arabic (`ar`). Arabic uses right-to-left layout. The selected locale and theme are available before sign-in, stored locally for the next first paint, and synchronized with an authenticated user's profile.

## Add a locale

1. Run `node scripts/i18n/extract.mjs` to refresh the canonical English catalog.
2. Copy `src/i18n/locales/en.json` to `src/i18n/locales/<locale>.json` and translate values only. Keep every English key unchanged.
3. Add the locale code and its metadata to `src/i18n/catalog.ts`. Set `direction` to `rtl` for right-to-left languages.
4. Add the locale to the profile and workspace API validation in `server/app.ts`.
5. Run `pnpm verify`, then test sign-in, the app shell, dialogs, tables, forms, charts, and mobile navigation in both themes. RTL locales must be checked separately.

Catalogs deliberately use the English source phrase as the key. Existing screens are localized at the application boundary for complete retrofit coverage. New reusable or dynamic copy should use `const { t } = useI18n()` and `t('Message')`; interpolation uses braces, for example `t('{count} recipients', { count })`. Static JSX text is still extracted, but explicit `t()` calls make dynamic behavior testable and easier to review.

Do not translate customer content, brand names, email addresses, URLs, provider identifiers, API payload values, or HTML email previews. Put `translate="no"` on dynamic customer/data subtrees; use `data-i18n-ignore` only for application-owned technical previews that must remain verbatim.

## Theme rules

Use semantic shadcn/Tailwind tokens such as `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, and `border-border`. Add paired light/dark variants only for semantic status colors. Do not introduce fixed white/black application surfaces; fixed colors are allowed inside message previews where they represent delivered content.

Use logical layout utilities (`start/end`, `ms/me`, `ps/pe`, `border-s/border-e`, `text-start/text-end`) so the same component works in LTR and RTL. The root `lang`, `dir`, theme class, `color-scheme`, and theme-color metadata are owned by `I18nProvider`.

## Files and viewer QA

The Files workspace, details tabs, collaboration controls, unsupported-preview reasons, upload states, password prompts, public share pages, and viewer toolbars are cataloged in all four locales. Dynamic file/folder names, sheet names, cell contents, document text, code, hashes, member names, and MIME identifiers are domain data and use `translate="no"` where the browser could otherwise translate them.

Arabic QA must cover the workspace sidebar side, breadcrumb order and chevrons, logical table spacing, selection and context menus, drag/drop alternatives, resizable details panel, bottom mobile Sheet, slide/page navigation, sheet row headers, mixed Latin filenames, code line numbers, and public link password flow. Office and PDF document content keeps its source direction; changing the administrator locale must not rewrite or reorder document data.
