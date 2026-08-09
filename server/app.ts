import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import multer from "multer";
import sanitizeHtml from "sanitize-html";
import { parse as parseCsv } from "csv-parse/sync";
import { stringify as stringifyCsv } from "csv-stringify/sync";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { load } from "cheerio";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { authMiddleware, requireAuth } from "./auth";
import { getConfig, type AppConfig } from "./config";
import { audit, createDatabase, tokenHash, type AppDatabase } from "./db";
import {
  analyzeAutomationReport,
  analyzeContent,
  analyzeReport,
  generateEmail,
  generateSubject,
  improveContent,
  type AiContext,
} from "./ai";
import {
  AI_PROVIDER_IDS,
  discoverLocalAiModels,
  isLocalAiProvider,
  normalizeLocalAiBaseUrl,
  type AiProviderId,
} from "./ai-providers";
import { decryptCredentials, encryptCredentials } from "./multichannel/crypto";
import { deserializeRow, deserializeRows, nowIso } from "./serialize";
import { refreshSegmentCount } from "./segments";
import { sendMessage, verifyMailProvider } from "./mail";
import { capturePayPalOrder, createPayPalOrder } from "./payments";
import {
  enqueueJob,
  estimateCampaign,
  scheduleSubscriberAutomations,
  startWorker,
} from "./worker";
import { signToken, verifyToken } from "./tokens";
import { createMultiChannelRuntime } from "./multichannel/factory";
import { createMultiChannelRouter, createPublicChannelRouter, createWebhookRouter } from "./multichannel/routes";

type CreateOptions = {
  db?: AppDatabase;
  config?: Partial<AppConfig>;
  worker?: boolean;
};

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const bool = (value: unknown) => (value ? 1 : 0);
const routeParam = (request: Request, key: string) =>
  String(request.params[key] ?? "");

function body<T>(schema: z.ZodType<T>) {
  return (request: Request, response: Response, next: NextFunction) => {
    const result = schema.safeParse(request.body);
    if (!result.success)
      return response
        .status(422)
        .json({
          error: "Validation failed",
          details: z.treeifyError(result.error),
        });
    request.body = result.data;
    next();
  };
}

function brandAccess(db: AppDatabase, request: Request, brandId: string) {
  if (request.authKind === "api")
    return !!db
      .prepare("SELECT id FROM brands WHERE id=? AND workspace_id=?")
      .get(brandId, request.apiWorkspaceId);
  return !!db
    .prepare(
      `SELECT bm.id FROM brand_members bm WHERE bm.brand_id=? AND bm.user_id=?`,
    )
    .get(brandId, request.authUser?.id);
}

function listAccess(db: AppDatabase, request: Request, listId: string) {
  const list = db
    .prepare("SELECT brand_id FROM lists WHERE id=?")
    .get(listId) as { brand_id: string } | undefined;
  return !!list && brandAccess(db, request, list.brand_id);
}

function brandOwner(db: AppDatabase, request: Request, brandId: string) {
  return (
    !!request.authUser &&
    !!db
      .prepare(
        "SELECT id FROM brand_members WHERE brand_id=? AND user_id=? AND role='owner'",
      )
      .get(brandId, request.authUser.id)
  );
}

function createSession(
  db: AppDatabase,
  config: AppConfig,
  request: Request,
  response: Response,
  userId: string,
) {
  const sessionId = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
  db.prepare(
    "INSERT INTO sessions (id,user_id,expires_at,created_at,ip,user_agent) VALUES (?,?,?,?,?,?)",
  ).run(
    sessionId,
    userId,
    expiresAt,
    nowIso(),
    request.ip,
    request.headers["user-agent"] ?? "",
  );
  response.cookie("sendry_session", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    expires: new Date(expiresAt),
  });
}

function requireBrand(db: AppDatabase) {
  return (request: Request, response: Response, next: NextFunction) => {
    const brandId = String(
      routeParam(request, "brandId") ??
        request.body?.brand_id ??
        request.query.brandId ??
        "",
    );
    if (!brandId || !brandAccess(db, request, brandId))
      return response.status(403).json({ error: "Brand access denied" });
    const ownershipChecks: Array<[string, string, string]> = [
      ["listId", "SELECT id FROM lists WHERE id=? AND brand_id=?", "Audience"],
      [
        "campaignId",
        "SELECT id FROM campaigns WHERE id=? AND brand_id=?",
        "Campaign",
      ],
      [
        "templateId",
        "SELECT id FROM templates WHERE id=? AND brand_id=?",
        "Template",
      ],
      ["fileId", "SELECT id FROM files WHERE id=? AND brand_id=?", "File"],
      ["ruleId", "SELECT id FROM rules WHERE id=? AND brand_id=?", "Rule"],
      [
        "memberId",
        "SELECT id FROM brand_members WHERE id=? AND brand_id=?",
        "Member",
      ],
      [
        "automationId",
        "SELECT a.id FROM automations a JOIN lists l ON l.id=a.list_id WHERE a.id=? AND l.brand_id=?",
        "Automation",
      ],
    ];
    for (const [parameter, sql, label] of ownershipChecks) {
      const resourceId = routeParam(request, parameter);
      if (resourceId && !db.prepare(sql).get(resourceId, brandId))
        return response.status(404).json({ error: `${label} not found` });
    }
    const listId = routeParam(request, "listId");
    const automationId = routeParam(request, "automationId");
    const nestedChecks: Array<[string, string, unknown[], string]> = [
      [
        "subscriberId",
        "SELECT id FROM subscribers WHERE id=? AND list_id=?",
        [listId],
        "Subscriber",
      ],
      [
        "fieldId",
        "SELECT id FROM custom_fields WHERE id=? AND list_id=?",
        [listId],
        "Field",
      ],
      [
        "segmentId",
        "SELECT id FROM segments WHERE id=? AND list_id=?",
        [listId],
        "Segment",
      ],
      [
        "stepId",
        "SELECT id FROM automation_steps WHERE id=? AND automation_id=?",
        [automationId],
        "Automation step",
      ],
    ];
    for (const [parameter, sql, parent, label] of nestedChecks) {
      const resourceId = routeParam(request, parameter);
      if (
        resourceId &&
        (!parent[0] || !db.prepare(sql).get(resourceId, ...parent))
      )
        return response.status(404).json({ error: `${label} not found` });
    }
    if (request.authUser) {
      const member = db
        .prepare(
          "SELECT role,permissions FROM brand_members WHERE brand_id=? AND user_id=?",
        )
        .get(brandId, request.authUser.id) as
        | { role: string; permissions: string }
        | undefined;
      const permissions = member
        ? (JSON.parse(member.permissions) as string[])
        : [];
      const suffix = request.path.split(`/brands/${brandId}`)[1] ?? "";
      const required =
        suffix.includes("/campaigns/") &&
        (suffix.includes("/report") ||
          suffix.includes("/export") ||
          suffix.endsWith("/web"))
          ? "reports"
          : suffix.startsWith("/campaigns") || suffix.startsWith("/ai")
            ? "campaigns"
            : suffix.startsWith("/templates")
              ? "templates"
              : suffix.startsWith("/lists") || suffix.startsWith("/segments")
                ? "lists"
                : suffix.startsWith("/automations")
                  ? "automations"
                  : suffix.startsWith("/files")
                    ? "files"
                    : [
                          "/rules",
                          "/webhooks",
                          "/suppressions",
                          "/blocked-domains",
                          "/housekeeping",
                        ].some((area) => suffix.startsWith(area))
                      ? "rules"
                      : suffix.startsWith("/rss")
                        ? "reports"
                        : suffix === "/overview"
                          ? null
                          : "settings";
      if (
        required &&
        !permissions.includes("*") &&
        !permissions.includes(required)
      )
        return response
          .status(403)
          .json({ error: `${required} permission is required` });
    }
    next();
  };
}

function updateColumns(
  db: AppDatabase,
  table: string,
  recordId: string,
  values: Record<string, unknown>,
  allowed: string[],
) {
  const entries = Object.entries(values).filter(([key]) =>
    allowed.includes(key),
  );
  if (!entries.length) return;
  const normalized = entries.map(
    ([key, value]) =>
      [
        key,
        typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : typeof value === "boolean"
            ? bool(value)
            : value,
      ] as const,
  );
  db.prepare(
    `UPDATE ${table} SET ${normalized.map(([key]) => `${key}=?`).join(",")},updated_at=? WHERE id=?`,
  ).run(...normalized.map(([, value]) => value), nowIso(), recordId);
}

function withoutBrandSecrets(
  value: Record<string, unknown>,
  settingsAccess = false,
  deploymentOpenAiKeyConfigured = false,
) {
  const row = { ...value };
  const storedAiKeyConfigured = Boolean(
    row.ai_encrypted_api_key || row.openai_api_key,
  );
  row.ai_api_key_configured = storedAiKeyConfigured;
  row.ai_server_key_configured =
    !storedAiKeyConfigured &&
    row.ai_provider === "openai" &&
    deploymentOpenAiKeyConfigured;
  row.openai_api_key_configured = storedAiKeyConfigured;
  row.recaptcha_secret_key_configured = Boolean(row.recaptcha_secret_key);
  delete row.ai_api_key;
  delete row.ai_encrypted_api_key;
  delete row.openai_api_key;
  delete row.recaptcha_secret_key;
  const provider =
    typeof row.provider_config === "object" && row.provider_config
      ? (row.provider_config as Record<string, unknown>)
      : {};
  if (settingsAccess)
    row.provider_config = {
      ...provider,
      password: "",
      secretAccessKey: "",
      passwordConfigured: Boolean(provider.password),
      secretAccessKeyConfigured: Boolean(provider.secretAccessKey),
    };
  else
    row.provider_config = Object.fromEntries(
      ["healthy", "dailyRemaining", "sendRate", "mode"]
        .filter((key) => provider[key] !== undefined)
        .map((key) => [key, provider[key]]),
    );
  return row;
}

function mergeProviderConfiguration(
  currentValue: unknown,
  incomingValue: unknown,
) {
  const current =
    currentValue && typeof currentValue === "object"
      ? (currentValue as Record<string, unknown>)
      : {};
  const incoming =
    incomingValue && typeof incomingValue === "object"
      ? (incomingValue as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = {
    ...current,
    ...incoming,
    password: incoming.password || current.password,
    secretAccessKey: incoming.secretAccessKey || current.secretAccessKey,
  };
  delete merged.passwordConfigured;
  delete merged.secretAccessKeyConfigured;
  return merged;
}

function aiEncryptionKey(config: AppConfig) {
  return (
    config.credentialEncryptionKey ??
    (process.env.NODE_ENV === "production" ? "" : config.sessionSecret)
  );
}

function resolveAiContext(
  db: AppDatabase,
  config: AppConfig,
  brandId: string,
): { enabled: boolean; context: AiContext } {
  const brand = deserializeRow(
    db
      .prepare(
        "SELECT ai_enabled,ai_provider,ai_provider_config,ai_encrypted_api_key,openai_api_key FROM brands WHERE id=?",
      )
      .get(brandId) as Record<string, unknown>,
  ) as Record<string, unknown> | null;
  if (!brand) throw new Error("Brand not found");
  const provider = String(
    brand.ai_provider ||
      (brand.openai_api_key || config.openaiApiKey ? "openai" : ""),
  ) as AiProviderId | "";
  const providerConfig =
    brand.ai_provider_config && typeof brand.ai_provider_config === "object"
      ? (brand.ai_provider_config as Record<string, unknown>)
      : {};
  let apiKey: string | undefined;
  if (brand.ai_encrypted_api_key) {
    apiKey = decryptCredentials(
      String(brand.ai_encrypted_api_key),
      aiEncryptionKey(config),
    ).apiKey;
  } else if (provider === "openai") {
    apiKey = String(brand.openai_api_key || config.openaiApiKey || "") || undefined;
  }
  return {
    enabled: Boolean(brand.ai_enabled),
    context: {
      provider,
      model: String(
        providerConfig.model || (provider === "openai" ? "gpt-5-mini" : ""),
      ),
      baseUrl: providerConfig.baseUrl
        ? String(providerConfig.baseUrl)
        : undefined,
      apiKey,
      brandId,
      db,
    },
  };
}

function requireEnabledAi(
  db: AppDatabase,
  config: AppConfig,
  brandId: string,
) {
  const result = resolveAiContext(db, config, brandId);
  if (!result.enabled) return null;
  return result.context;
}

function providerError(
  error: unknown,
  providerConfig: Record<string, unknown>,
) {
  let message =
    error instanceof Error
      ? error.message
      : "Unable to connect to the delivery provider";
  for (const secret of [
    providerConfig.password,
    providerConfig.pass,
    providerConfig.secretAccessKey,
  ]) {
    if (typeof secret === "string" && secret.length > 3)
      message = message.replaceAll(secret, "••••");
  }
  return message.slice(0, 300);
}

function campaignReport(db: AppDatabase, campaignId: string) {
  const campaign = deserializeRow(
    db.prepare("SELECT * FROM campaigns WHERE id=?").get(campaignId) as Record<
      string,
      unknown
    >,
  );
  if (!campaign) return null;
  const events = db
    .prepare(
      "SELECT type,COUNT(*) AS total,COUNT(DISTINCT subscriber_id) AS unique_count FROM campaign_events WHERE campaign_id=? GROUP BY type",
    )
    .all(campaignId) as Array<{
    type: string;
    total: number;
    unique_count: number;
  }>;
  const metricMap = Object.fromEntries(events.map((row) => [row.type, row]));
  const delivered =
    Number(campaign.delivered) || Number(campaign.total_recipients) || 1;
  const uniqueOpens = metricMap.open?.unique_count ?? 0;
  const uniqueClicks = metricMap.click?.unique_count ?? 0;
  const metrics = {
    delivered: Number(campaign.delivered),
    deliveryRate: Number(campaign.total_recipients)
      ? (Number(campaign.delivered) / Number(campaign.total_recipients)) * 100
      : 0,
    uniqueOpens,
    openRate: (uniqueOpens / delivered) * 100,
    uniqueClicks,
    clickRate: (uniqueClicks / delivered) * 100,
    ctor: uniqueOpens ? (uniqueClicks / uniqueOpens) * 100 : 0,
    unsubscribed: metricMap.unsubscribe?.unique_count ?? 0,
    bounced: metricMap.bounce?.unique_count ?? 0,
    complaints: metricMap.complaint?.unique_count ?? 0,
  };
  const links = db
    .prepare(
      `SELECT cl.id,cl.url,COUNT(ce.id) AS total_clicks,COUNT(DISTINCT ce.subscriber_id) AS unique_clicks
    FROM campaign_links cl LEFT JOIN campaign_events ce ON ce.campaign_id=cl.campaign_id AND ce.type='click' AND ce.link_url=cl.url
    WHERE cl.campaign_id=? GROUP BY cl.id ORDER BY unique_clicks DESC`,
    )
    .all(campaignId);
  const countries = db
    .prepare(
      `SELECT COALESCE(country,'Unknown') AS country,COUNT(*) AS opens FROM campaign_events WHERE campaign_id=? AND type='open' GROUP BY country ORDER BY opens DESC`,
    )
    .all(campaignId);
  const timeline = db
    .prepare(
      `SELECT substr(occurred_at,1,13)||':00:00.000Z' AS bucket,type,COUNT(*) AS count FROM campaign_events WHERE campaign_id=? AND type IN ('delivered','open','click') GROUP BY bucket,type ORDER BY bucket`,
    )
    .all(campaignId);
  const settings = db
    .prepare(
      `SELECT b.report_rows FROM campaigns c JOIN brands b ON b.id=c.brand_id WHERE c.id=?`,
    )
    .get(campaignId) as { report_rows: number } | undefined;
  const reportRows = Math.min(
    250,
    Math.max(10, Number(settings?.report_rows ?? 25)),
  );
  const recent = db
    .prepare(
      `SELECT ce.*,s.name,s.email,s.status FROM campaign_events ce LEFT JOIN subscribers s ON s.id=ce.subscriber_id WHERE ce.campaign_id=? ORDER BY ce.occurred_at DESC LIMIT ?`,
    )
    .all(campaignId, reportRows);
  const analysis = deserializeRow(
    db
      .prepare(
        `SELECT * FROM ai_analyses WHERE entity_type='campaign' AND entity_id=? ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(campaignId) as Record<string, unknown>,
  );
  return { campaign, metrics, links, countries, timeline, recent, analysis };
}

function campaignQuote(db: AppDatabase, campaignId: string) {
  const row = db
    .prepare(
      `SELECT c.id,c.brand_id,b.currency,b.delivery_fee,b.recipient_fee,b.monthly_limit,b.current_usage
    FROM campaigns c JOIN brands b ON b.id=c.brand_id WHERE c.id=?`,
    )
    .get(campaignId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const recipients = estimateCampaign(db, campaignId);
  const amount = Math.max(
    0,
    Number(row.delivery_fee) + recipients * Number(row.recipient_fee),
  );
  const remaining =
    Number(row.monthly_limit) < 0
      ? null
      : Math.max(0, Number(row.monthly_limit) - Number(row.current_usage));
  return {
    recipients,
    amount: Math.round(amount * 100) / 100,
    currency: String(row.currency),
    remaining,
  };
}

function campaignTargetsBelongToBrand(
  db: AppDatabase,
  brandId: string,
  targets: Array<{ kind: "list" | "segment"; target_id: string }>,
) {
  return targets.every((target) =>
    target.kind === "list"
      ? !!db
          .prepare("SELECT id FROM lists WHERE id=? AND brand_id=?")
          .get(target.target_id, brandId)
      : !!db
          .prepare(
            "SELECT s.id FROM segments s JOIN lists l ON l.id=s.list_id WHERE s.id=? AND l.brand_id=?",
          )
          .get(target.target_id, brandId),
  );
}

async function sendLifecycleEmail(
  config: AppConfig,
  db: AppDatabase,
  list: Record<string, unknown>,
  subscriber: { name?: string; email: string },
  kind: "confirmation" | "thank_you" | "goodbye",
  confirmationLink?: string,
) {
  if (kind !== "confirmation" && !list[`${kind}_enabled`]) return;
  const brand = db
    .prepare("SELECT * FROM brands WHERE id=?")
    .get(list.brand_id) as Record<string, unknown> | undefined;
  if (!brand) return;
  const subject = String(
    list[`${kind}_subject`] ||
      (kind === "confirmation"
        ? "Please confirm your subscription"
        : kind === "thank_you"
          ? "Thank you for subscribing"
          : "Subscription updated"),
  );
  const source = String(
    list[`${kind}_html`] ||
      (kind === "confirmation"
        ? '<p><a href="[confirmation_link]">Confirm subscription</a></p>'
        : "<p>Your subscription preferences have been updated.</p>"),
  );
  const replace = (value: string) =>
    value
      .replaceAll("[Name]", subscriber.name ?? "")
      .replaceAll("[Email]", subscriber.email)
      .replaceAll("[confirmation_link]", confirmationLink ?? "");
  await sendMessage(config, brand as never, {
    to: subscriber.email,
    name: subscriber.name,
    subject: replace(subject),
    html: replace(source),
    text: replace(source).replace(/<[^>]+>/g, " "),
  });
}

async function verifyRecaptcha(secret: string, token: string, ip?: string) {
  if (secret.endsWith(".test")) return token === "test-token";
  const parameters = new URLSearchParams({ secret, response: token });
  if (ip) parameters.set("remoteip", ip);
  const result = await fetch(
    "https://www.google.com/recaptcha/api/siteverify",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: parameters,
    },
  );
  if (!result.ok) return false;
  return !!((await result.json()) as { success?: boolean }).success;
}

function privateAddress(address: string) {
  if (
    address === "::1" ||
    address === "::" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:")
  )
    return true;
  if (!isIP(address)) return true;
  const parts = address.split(".").map(Number);
  return (
    parts.length === 4 &&
    (parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168))
  );
}

async function assertPublicUrl(url: URL) {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Public HTTP or HTTPS URL required");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((entry) => privateAddress(entry.address))
  )
    throw new Error("Private network addresses are not allowed");
}

function publicBrandUrl(config: AppConfig, brand: Record<string, unknown>) {
  return brand.custom_domain_enabled && brand.custom_domain
    ? `${String(brand.custom_domain_protocol || "https")}://${String(
        brand.custom_domain,
      )
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "")}`
    : config.appUrl;
}

async function campaignLinkIssues(campaign: Record<string, unknown>) {
  if (!campaign.check_links) return [];
  const $ = load(String(campaign.html_text ?? ""), null, false);
  const urls = [
    ...new Set(
      $("a[href]")
        .map((_index, element) => $(element).attr("href"))
        .get()
        .filter(Boolean),
    ),
  ] as string[];
  const issues: Array<{ url: string; reason: string }> = [];
  for (const value of urls) {
    if (/\[[^\]]+\]/.test(value) || /^(mailto|tel):/i.test(value)) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      issues.push({ url: value, reason: "Invalid URL" });
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      issues.push({ url: value, reason: "Unsupported protocol" });
      continue;
    }
    if (/(^|\.)(test|example|invalid|localhost)$/i.test(url.hostname)) continue;
    try {
      await assertPublicUrl(url);
      const result = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(4000),
        headers: { "user-agent": "Sendry-Link-Check/1.0" },
      });
      if (result.status >= 400)
        issues.push({ url: value, reason: `HTTP ${result.status}` });
    } catch (error) {
      issues.push({
        url: value,
        reason: error instanceof Error ? error.message : "Unable to reach URL",
      });
    }
  }
  return issues;
}

export function createApp(options: CreateOptions = {}) {
  const config = getConfig(options.config);
  const db = options.db ?? createDatabase(config.databasePath);
  const multiChannel = createMultiChannelRuntime(db, config);
  mkdirSync(config.uploadDir, { recursive: true });
  const upload = multer({
    dest: config.uploadDir,
    limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  });
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: false,
    }),
  );
  app.use(compression());
  app.use(cors({ origin: config.appUrl, credentials: true }));
  app.use(cookieParser());
  app.use(createWebhookRouter(db, multiChannel, config));
  app.use(express.json({ limit: "4mb" }));
  app.use(express.urlencoded({ extended: true, limit: "4mb" }));
  app.use(
    "/uploads",
    express.static(config.uploadDir, { fallthrough: false, maxAge: "1d" }),
  );
  app.use(authMiddleware(db, config));
  app.use("/api/v2/public", createPublicChannelRouter(db, multiChannel, config));
  app.use("/api/v2", createMultiChannelRouter(db, multiChannel, config));

  app.get("/api/setup/status", (_request, response) =>
    response.json({
      required: !db.prepare("SELECT id FROM users LIMIT 1").get(),
    }),
  );
  app.post(
    "/api/setup",
    body(
      z.object({
        name: z.string().min(2),
        email: z.email(),
        password: z.string().min(12),
        company: z.string().min(1),
        brand: z.string().min(1),
        from_name: z.string().min(1),
        from_email: z.email(),
        reply_to: z.email(),
        timezone: z.string().min(1).default("UTC"),
      }),
    ),
    async (request, response) => {
      if (db.prepare("SELECT id FROM users LIMIT 1").get())
        return response
          .status(409)
          .json({ error: "Setup is already complete" });
      const userId = id("usr");
      const workspaceId = id("wsp");
      const brandId = id("brd");
      const timestamp = nowIso();
      const passwordHash = await hash(request.body.password, 12);
      db.transaction(() => {
        db.prepare(
          "INSERT INTO users (id,name,email,password_hash,language,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ).run(
          userId,
          request.body.name,
          request.body.email,
          passwordHash,
          "en",
          request.body.timezone,
          timestamp,
          timestamp,
        );
        db.prepare(
          "INSERT INTO workspaces (id,name,company,owner_id,default_timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        ).run(
          workspaceId,
          request.body.company,
          request.body.company,
          userId,
          request.body.timezone,
          timestamp,
          timestamp,
        );
        db.prepare(
          "INSERT INTO brands (id,workspace_id,name,from_name,from_email,reply_to,provider,provider_config,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
          brandId,
          workspaceId,
          request.body.brand,
          request.body.from_name,
          request.body.from_email,
          request.body.reply_to,
          "stream",
          "{}",
          timestamp,
          timestamp,
        );
        db.prepare(
          "INSERT INTO brand_members (id,brand_id,user_id,role,permissions,created_at) VALUES (?,?,?,?,?,?)",
        ).run(id("mem"), brandId, userId, "owner", '["*"]', timestamp);
      })();
      createSession(db, config, request, response, userId);
      response
        .status(201)
        .json({
          user: {
            id: userId,
            name: request.body.name,
            email: request.body.email,
            language: "en",
            timezone: request.body.timezone,
            theme: "system",
          },
          workspaceId,
          brandId,
        });
    },
  );
  app.get("/api/health", (_request, response) =>
    response.json({
      ok: true,
      time: nowIso(),
      mailTransport: config.mailTransport,
    }),
  );

  app.post(
    "/api/auth/login",
    body(
      z.object({
        email: z.email(),
        password: z.string().min(8),
        code: z.string().optional(),
      }),
    ),
    async (request, response) => {
      const user = db
        .prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE")
        .get(request.body.email) as Record<string, unknown> | undefined;
      if (
        !user ||
        !(await compare(request.body.password, String(user.password_hash)))
      )
        return response
          .status(401)
          .json({ error: "Invalid email or password" });
      if (user.totp_enabled && !request.body.code)
        return response.status(202).json({ requiresTwoFactor: true });
      if (user.totp_enabled) {
        const supplied = String(request.body.code ?? "").replaceAll(" ", "");
        const recoveryCodes = JSON.parse(
          String(user.totp_recovery_codes ?? "[]"),
        ) as string[];
        const recoveryHash = createHash("sha256")
          .update(supplied.toLowerCase())
          .digest("hex");
        const recoveryIndex = recoveryCodes.indexOf(recoveryHash);
        const totp =
          supplied.length === 6 && !!user.totp_secret
            ? await verifyTotp({
                secret: String(user.totp_secret),
                token: supplied,
                epochTolerance: 30,
              })
            : { valid: false };
        if (!totp.valid && recoveryIndex < 0)
          return response
            .status(401)
            .json({ error: "Invalid authentication code" });
        if (recoveryIndex >= 0) {
          recoveryCodes.splice(recoveryIndex, 1);
          db.prepare(
            "UPDATE users SET totp_recovery_codes=?,updated_at=? WHERE id=?",
          ).run(JSON.stringify(recoveryCodes), nowIso(), user.id);
        }
      }
      createSession(db, config, request, response, String(user.id));
      response.json({
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          language: user.language,
          timezone: user.timezone,
          theme: user.theme,
        },
      });
    },
  );

  app.post(
    "/api/auth/passkey/options",
    body(z.object({ email: z.email() })),
    async (request, response) => {
      const user = db
        .prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE")
        .get(request.body.email) as { id: string } | undefined;
      if (!user)
        return response
          .status(404)
          .json({ error: "No passkey is registered for this account" });
      const credentials = db
        .prepare(
          "SELECT credential_id,transports FROM passkeys WHERE user_id=?",
        )
        .all(user.id) as Array<{ credential_id: string; transports: string }>;
      if (!credentials.length)
        return response
          .status(404)
          .json({ error: "No passkey is registered for this account" });
      const rpID = new URL(config.appUrl).hostname;
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "required",
        allowCredentials: credentials.map((credential) => ({
          id: credential.credential_id,
          transports: JSON.parse(credential.transports),
        })),
      });
      const challengeId = id("chl");
      db.prepare(
        "DELETE FROM auth_challenges WHERE expires_at<=? OR (user_id=? AND kind='authentication')",
      ).run(nowIso(), user.id);
      db.prepare(
        "INSERT INTO auth_challenges (id,user_id,kind,challenge,expires_at,created_at) VALUES (?,?,?,?,?,?)",
      ).run(
        challengeId,
        user.id,
        "authentication",
        options.challenge,
        new Date(Date.now() + 5 * 60000).toISOString(),
        nowIso(),
      );
      response.json({ challengeId, options });
    },
  );

  app.post(
    "/api/auth/passkey/verify",
    body(
      z.object({
        challengeId: z.string(),
        response: z.record(z.string(), z.unknown()),
      }),
    ),
    async (request, response) => {
      const challenge = db
        .prepare(
          "SELECT * FROM auth_challenges WHERE id=? AND kind='authentication' AND expires_at>?",
        )
        .get(request.body.challengeId, nowIso()) as
        | { id: string; user_id: string; challenge: string }
        | undefined;
      if (!challenge)
        return response
          .status(400)
          .json({ error: "Passkey challenge expired" });
      const credentialResponse = request.body
        .response as AuthenticationResponseJSON;
      const stored = db
        .prepare("SELECT * FROM passkeys WHERE user_id=? AND credential_id=?")
        .get(challenge.user_id, credentialResponse.id) as
        | {
            id: string;
            credential_id: string;
            public_key: Buffer;
            counter: number;
            transports: string;
          }
        | undefined;
      if (!stored)
        return response
          .status(401)
          .json({ error: "Passkey was not recognized" });
      const verification = await verifyAuthenticationResponse({
        response: credentialResponse,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.appUrl,
        expectedRPID: new URL(config.appUrl).hostname,
        credential: {
          id: stored.credential_id,
          publicKey: new Uint8Array(stored.public_key),
          counter: stored.counter,
          transports: JSON.parse(stored.transports),
        } as WebAuthnCredential,
        requireUserVerification: true,
      });
      if (!verification.verified)
        return response
          .status(401)
          .json({ error: "Passkey verification failed" });
      db.prepare("UPDATE passkeys SET counter=? WHERE id=?").run(
        verification.authenticationInfo.newCounter,
        stored.id,
      );
      db.prepare("DELETE FROM auth_challenges WHERE id=?").run(challenge.id);
      createSession(db, config, request, response, challenge.user_id);
      const user = db
        .prepare(
          "SELECT id,name,email,language,timezone,theme FROM users WHERE id=?",
        )
        .get(challenge.user_id);
      response.json({ user });
    },
  );

  app.post("/api/auth/logout", requireAuth, (request, response) => {
    if (request.cookies?.sendry_session)
      db.prepare("DELETE FROM sessions WHERE id=?").run(
        request.cookies.sendry_session,
      );
    response.clearCookie("sendry_session").status(204).end();
  });
  app.get("/api/auth/session", (request, response) =>
    request.authUser
      ? response.json({ user: request.authUser })
      : response.status(401).json({ error: "No active session" }),
  );
  app.post(
    "/api/auth/forgot-password",
    body(z.object({ email: z.email() })),
    async (request, response) => {
      const user = db
        .prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE")
        .get(request.body.email) as { id: string } | undefined;
      let resetUrl: string | undefined;
      if (user) {
        const token = randomBytes(24).toString("base64url");
        db.prepare(
          "UPDATE users SET password_reset_token=?,password_reset_expires=?,updated_at=? WHERE id=?",
        ).run(
          tokenHash(token),
          new Date(Date.now() + 3600000).toISOString(),
          nowIso(),
          user.id,
        );
        resetUrl = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
        const brand = db
          .prepare(
            `SELECT b.* FROM brands b JOIN brand_members bm ON bm.brand_id=b.id WHERE bm.user_id=? ORDER BY bm.role='owner' DESC LIMIT 1`,
          )
          .get(user.id) as Record<string, unknown> | undefined;
        if (brand)
          await sendMessage(config, brand as never, {
            to: request.body.email,
            subject: "Reset your Sendry password",
            html: `<p><a href="${resetUrl}">Reset password</a></p><p>This link expires in one hour.</p>`,
            text: `Reset password: ${resetUrl}`,
          });
      }
      response.json({
        ok: true,
        resetUrl:
          config.mailTransport === "stream" &&
          process.env.NODE_ENV !== "production"
            ? resetUrl
            : undefined,
      });
    },
  );
  app.post(
    "/api/auth/reset-password",
    body(z.object({ token: z.string().min(20), password: z.string().min(12) })),
    async (request, response) => {
      const user = db
        .prepare(
          "SELECT id FROM users WHERE password_reset_token=? AND password_reset_expires>?",
        )
        .get(tokenHash(request.body.token), nowIso()) as
        | { id: string }
        | undefined;
      if (!user)
        return response
          .status(400)
          .json({ error: "The reset link is invalid or expired" });
      db.prepare(
        "UPDATE users SET password_hash=?,password_reset_token=NULL,password_reset_expires=NULL,updated_at=? WHERE id=?",
      ).run(await hash(request.body.password, 12), nowIso(), user.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
      response.json({ ok: true });
    },
  );

  app.get("/api/bootstrap", requireAuth, (request, response) => {
    const workspaces =
      request.authKind === "api"
        ? db
            .prepare("SELECT * FROM workspaces WHERE id=?")
            .all(request.apiWorkspaceId)
        : db
            .prepare(
              "SELECT DISTINCT w.* FROM workspaces w JOIN brands b ON b.workspace_id=w.id JOIN brand_members bm ON bm.brand_id=b.id WHERE bm.user_id=?",
            )
            .all(request.authUser?.id);
    const workspaceIds = (workspaces as Array<{ id: string }>).map(
      (workspace) => workspace.id,
    );
    const brands =
      request.authKind === "api"
        ? workspaceIds.length
          ? (db
              .prepare(
                `SELECT b.*,'["*"]' AS permissions,'api' AS role FROM brands b WHERE b.workspace_id IN (${workspaceIds.map(() => "?").join(",")}) ORDER BY b.name`,
              )
              .all(...workspaceIds) as Record<string, unknown>[])
          : []
        : (db
            .prepare(
              `SELECT b.*,bm.permissions,bm.role FROM brands b JOIN brand_members bm ON bm.brand_id=b.id WHERE bm.user_id=? ORDER BY b.name`,
            )
            .all(request.authUser?.id) as Record<string, unknown>[]);
    const visibleBrands = deserializeRows(brands).map((brand) => {
      const permissions = Array.isArray(brand.permissions)
        ? brand.permissions
        : [];
      const settingsAccess =
        request.authKind !== "api" &&
        (permissions.includes("*") || permissions.includes("settings"));
      return withoutBrandSecrets(
        brand,
        settingsAccess,
        Boolean(config.openaiApiKey),
      );
    });
    const visibleWorkspaces =
      request.authKind === "api"
        ? (
            deserializeRows(workspaces as Record<string, unknown>[]) as Record<
              string,
              unknown
            >[]
          ).map((workspace) => ({ id: workspace.id, name: workspace.name }))
        : deserializeRows(workspaces as Record<string, unknown>[]);
    response.json({
      user: request.authUser ?? null,
      workspaces: visibleWorkspaces,
      brands: visibleBrands,
      capabilities: {
        ai: true,
        passkeys: config.secureCookies,
        streamMail: config.mailTransport === "stream",
      },
    });
  });

  app.get(
    "/api/brands/:brandId/overview",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const brandId = routeParam(request, "brandId");
      const campaignStats = db
        .prepare(
          `SELECT COUNT(*) AS campaigns,COALESCE(SUM(delivered),0) AS delivered FROM campaigns WHERE brand_id=? AND created_at>=datetime('now','start of month')`,
        )
        .get(brandId);
      const eventStats = db
        .prepare(
          `SELECT ce.type,COUNT(DISTINCT ce.subscriber_id) AS count FROM campaign_events ce JOIN campaigns c ON c.id=ce.campaign_id WHERE c.brand_id=? GROUP BY ce.type`,
        )
        .all(brandId) as Array<{ type: string; count: number }>;
      const subscriberStats = db
        .prepare(
          `SELECT s.status,COUNT(*) AS count FROM subscribers s JOIN lists l ON l.id=s.list_id WHERE l.brand_id=? GROUP BY s.status`,
        )
        .all(brandId);
      const campaigns = deserializeRows(
        db
          .prepare(
            "SELECT id,label,subject,status,total_recipients,delivered,sent_at,scheduled_at,created_at FROM campaigns WHERE brand_id=? ORDER BY COALESCE(sent_at,scheduled_at,created_at) DESC LIMIT 12",
          )
          .all(brandId) as Record<string, unknown>[],
      );
      const provider = withoutBrandSecrets(
        deserializeRow(
          db
            .prepare(
              "SELECT provider,provider_config,monthly_limit,current_usage FROM brands WHERE id=?",
            )
            .get(brandId) as Record<string, unknown>,
        ) ?? {},
      );
      const alerts: Array<{
        id: string;
        severity: string;
        title: string;
        detail: string;
      }> = [];
      const paused = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM automations a JOIN lists l ON l.id=a.list_id WHERE l.brand_id=? AND a.enabled=0`,
          )
          .get(brandId) as { count: number }
      ).count;
      if (paused)
        alerts.push({
          id: "paused-automations",
          severity: "warning",
          title: `${paused} paused automation${paused === 1 ? "" : "s"}`,
          detail: "Open Automations to review or resume delivery.",
        });
      const recentDelivery = db
        .prepare(
          `SELECT COUNT(*) AS total,SUM(CASE WHEN ce.type='bounce' THEN 1 ELSE 0 END) AS bounced FROM campaign_events ce JOIN campaigns c ON c.id=ce.campaign_id WHERE c.brand_id=? AND ce.type IN ('delivered','bounce') AND ce.occurred_at>=datetime('now','-30 days')`,
        )
        .get(brandId) as { total: number; bounced: number };
      if (
        recentDelivery.total &&
        recentDelivery.bounced / recentDelivery.total >= 0.05
      )
        alerts.push({
          id: "bounce-rate",
          severity: "danger",
          title: "Bounce rate needs attention",
          detail: `${Math.round((recentDelivery.bounced / recentDelivery.total) * 100)}% of recent delivery events were bounces.`,
        });
      if (
        Number(provider.monthly_limit) > 0 &&
        Number(provider.current_usage) / Number(provider.monthly_limit) >= 0.8
      )
        alerts.push({
          id: "monthly-allowance",
          severity: "warning",
          title: "Monthly allowance is nearly used",
          detail: `${Math.round((Number(provider.current_usage) / Number(provider.monthly_limit)) * 100)}% of the configured allowance has been used.`,
        });
      response.json({
        campaignStats,
        eventStats,
        subscriberStats,
        campaigns,
        provider,
        alerts,
      });
    },
  );

  const brandSchema = z.object({
    name: z.string().min(1),
    from_name: z.string().min(1),
    from_email: z.email(),
    reply_to: z.email(),
    workspace_id: z.string().min(1),
  });
  app.post(
    "/api/brands",
    requireAuth,
    body(brandSchema),
    (request, response) => {
      const brandId = id("brd");
      const workspace = db
        .prepare("SELECT owner_id FROM workspaces WHERE id=?")
        .get(request.body.workspace_id) as { owner_id: string } | undefined;
      if (
        !workspace ||
        (request.authUser && workspace.owner_id !== request.authUser.id)
      )
        return response.status(403).json({ error: "Workspace access denied" });
      db.prepare(
        "INSERT INTO brands (id,workspace_id,name,from_name,from_email,reply_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        brandId,
        request.body.workspace_id,
        request.body.name,
        request.body.from_name,
        request.body.from_email,
        request.body.reply_to,
        nowIso(),
        nowIso(),
      );
      db.prepare(
        "INSERT INTO brand_members (id,brand_id,user_id,role,permissions,created_at) VALUES (?,?,?,?,?,?)",
      ).run(
        id("mem"),
        brandId,
        request.authUser?.id,
        "owner",
        JSON.stringify(["*"]),
        nowIso(),
      );
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM brands WHERE id=?")
              .get(brandId) as Record<string, unknown>,
          ),
        );
    },
  );

  app.get(
    "/api/brands/:brandId",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        withoutBrandSecrets(
          deserializeRow(
            db
              .prepare("SELECT * FROM brands WHERE id=?")
              .get(routeParam(request, "brandId")) as Record<string, unknown>,
          ) ?? {},
          true,
          Boolean(config.openaiApiKey),
        ),
      ),
  );
  app.patch(
    "/api/brands/:brandId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const brandId = routeParam(request, "brandId");
      const current =
        deserializeRow(
          db.prepare("SELECT * FROM brands WHERE id=?").get(brandId) as Record<
            string,
            unknown
          >,
        ) ?? {};
      const values = { ...request.body };
      const requestedAiProvider =
        values.ai_provider === undefined
          ? String(current.ai_provider || "")
          : String(values.ai_provider || "");
      const aiSettingsResult = z
        .object({
          ai_provider: z.enum(AI_PROVIDER_IDS).or(z.literal("")).optional(),
          ai_provider_config: z
            .object({
              model: z.string().trim().max(200).optional(),
              baseUrl: z.url().max(500).optional(),
            })
            .optional(),
          ai_api_key: z.string().trim().max(8_192).optional(),
          openai_api_key: z.string().trim().max(8_192).optional(),
          clear_ai_api_key: z.boolean().optional(),
          clear_openai_api_key: z.boolean().optional(),
        })
        .safeParse(values);
      if (!aiSettingsResult.success)
        return response.status(422).json({
          error: "Validation failed",
          details: z.treeifyError(aiSettingsResult.error),
        });
      const incomingAiKey = String(
        values.ai_api_key || values.openai_api_key || "",
      ).trim();
      delete values.ai_api_key;
      delete values.openai_api_key;
      delete values.ai_encrypted_api_key;
      const aiProviderChanged =
        values.ai_provider !== undefined &&
        requestedAiProvider !== String(current.ai_provider || "");
      if (
        request.body.clear_ai_api_key ||
        request.body.clear_openai_api_key ||
        aiProviderChanged ||
        isLocalAiProvider(requestedAiProvider)
      ) {
        db.prepare(
          "UPDATE brands SET ai_encrypted_api_key=NULL,openai_api_key=NULL WHERE id=?",
        ).run(brandId);
      }
      if (incomingAiKey) {
        values.ai_encrypted_api_key = encryptCredentials(
          { apiKey: incomingAiKey },
          aiEncryptionKey(config),
        );
        db.prepare("UPDATE brands SET openai_api_key=NULL WHERE id=?").run(
          brandId,
        );
      }
      if (
        values.ai_provider_config &&
        typeof values.ai_provider_config === "object"
      ) {
        const aiProviderConfig = {
          ...(values.ai_provider_config as Record<string, unknown>),
        };
        if (isLocalAiProvider(requestedAiProvider))
          aiProviderConfig.baseUrl = normalizeLocalAiBaseUrl(
            requestedAiProvider,
            String(aiProviderConfig.baseUrl || ""),
          );
        values.ai_provider_config = aiProviderConfig;
      }
      if (!values.recaptcha_secret_key) delete values.recaptcha_secret_key;
      if (
        values.provider_config &&
        typeof values.provider_config === "object"
      ) {
        values.provider_config = mergeProviderConfiguration(
          current.provider_config,
          values.provider_config,
        );
      }
      if (request.body.clear_recaptcha_secret_key)
        db.prepare(
          "UPDATE brands SET recaptcha_secret_key=NULL WHERE id=?",
        ).run(brandId);
      if (request.body.clear_provider_secret) {
        const provider =
          values.provider_config && typeof values.provider_config === "object"
            ? { ...(values.provider_config as Record<string, unknown>) }
            : mergeProviderConfiguration(current.provider_config, {});
        delete provider.password;
        delete provider.secretAccessKey;
        values.provider_config = provider;
      }
      updateColumns(db, "brands", brandId, values, [
        "name",
        "from_name",
        "from_email",
        "reply_to",
        "logo_path",
        "provider",
        "provider_config",
        "custom_domain",
        "custom_domain_protocol",
        "custom_domain_enabled",
        "recaptcha_site_key",
        "recaptcha_secret_key",
        "ai_provider",
        "ai_provider_config",
        "ai_encrypted_api_key",
        "ai_enabled",
        "default_query",
        "test_prefix",
        "allowed_attachments",
        "list_sort",
        "template_sort",
        "default_opt_in",
        "hide_hidden_lists",
        "privacy_mode",
        "opens_tracking",
        "clicks_tracking",
        "consent_campaigns_only",
        "consent_automations_only",
        "consent_options_enabled",
        "monthly_limit",
        "reset_day",
        "limit_never_expires",
        "currency",
        "delivery_fee",
        "recipient_fee",
        "notify_campaign_sent",
        "report_rows",
        "rss_enabled",
      ]);
      audit(db, "update", "brand", brandId, request.authUser?.id, brandId);
      response.json(
        withoutBrandSecrets(
          deserializeRow(
            db
              .prepare("SELECT * FROM brands WHERE id=?")
              .get(brandId) as Record<string, unknown>,
          ) ?? {},
          true,
          Boolean(config.openaiApiKey),
        ),
      );
    },
  );
  app.post(
    "/api/brands/:brandId/provider-test",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        provider: z.enum(["stream", "smtp", "ses"]),
        provider_config: z.record(z.string(), z.unknown()).default({}),
        clear_provider_secret: z.boolean().default(false),
      }),
    ),
    async (request, response) => {
      const brandId = routeParam(request, "brandId");
      const current = deserializeRow(
        db.prepare("SELECT * FROM brands WHERE id=?").get(brandId) as Record<
          string,
          unknown
        >,
      );
      if (!current)
        return response.status(404).json({ error: "Brand not found" });
      const providerConfig = mergeProviderConfiguration(
        current.provider_config,
        request.body.provider_config,
      );
      if (request.body.clear_provider_secret) {
        delete providerConfig.password;
        delete providerConfig.secretAccessKey;
      }
      try {
        const result = await verifyMailProvider(config, {
          ...current,
          provider: request.body.provider,
          provider_config: providerConfig,
        } as never);
        audit(
          db,
          "test",
          "mail_provider",
          brandId,
          request.authUser?.id,
          brandId,
        );
        response.json(result);
      } catch (error) {
        response
          .status(422)
          .json({ error: providerError(error, providerConfig) });
      }
    },
  );
  app.post(
    "/api/brands/:brandId/ai/models",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        provider: z.enum(["lmstudio", "ollama"]),
        baseUrl: z.url().max(500),
      }),
    ),
    async (request, response) => {
      try {
        const result = await discoverLocalAiModels(
          request.body.provider,
          request.body.baseUrl,
        );
        audit(
          db,
          "test",
          "ai_provider",
          routeParam(request, "brandId"),
          request.authUser?.id,
          routeParam(request, "brandId"),
        );
        response.json(result);
      } catch (error) {
        response.status(422).json({
          error:
            error instanceof Error
              ? error.message
              : "Unable to discover local AI models",
        });
      }
    },
  );
  app.post(
    "/api/brands/:brandId/duplicate",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      if (!brandOwner(db, request, routeParam(request, "brandId")))
        return response
          .status(403)
          .json({ error: "Only a brand owner can duplicate the brand" });
      const source = db
        .prepare("SELECT * FROM brands WHERE id=?")
        .get(routeParam(request, "brandId")) as Record<string, unknown>;
      const copyId = id("brd");
      const columns = Object.keys(source).filter(
        (key) =>
          !["id", "name", "created_at", "updated_at", "current_usage"].includes(
            key,
          ),
      );
      db.prepare(
        `INSERT INTO brands (id,name,current_usage,created_at,updated_at,${columns.join(",")}) VALUES (?,?,0,?,?,${columns.map(() => "?").join(",")})`,
      ).run(
        copyId,
        `${source.name} copy`,
        nowIso(),
        nowIso(),
        ...columns.map((column) => source[column]),
      );
      if (request.authUser)
        db.prepare(
          "INSERT INTO brand_members (id,brand_id,user_id,role,permissions,created_at) VALUES (?,?,?,?,?,?)",
        ).run(
          id("mem"),
          copyId,
          request.authUser.id,
          "owner",
          JSON.stringify(["*"]),
          nowIso(),
        );
      response
        .status(201)
        .json(
          withoutBrandSecrets(
            deserializeRow(
              db
                .prepare("SELECT * FROM brands WHERE id=?")
                .get(copyId) as Record<string, unknown>,
            ) ?? {},
            true,
            Boolean(config.openaiApiKey),
          ),
        );
    },
  );
  app.delete(
    "/api/brands/:brandId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const brandId = routeParam(request, "brandId");
      if (!brandOwner(db, request, brandId))
        return response
          .status(403)
          .json({ error: "Only a brand owner can delete the brand" });
      const brand = db
        .prepare("SELECT workspace_id FROM brands WHERE id=?")
        .get(brandId) as { workspace_id: string } | undefined;
      if (!brand)
        return response.status(404).json({ error: "Brand not found" });
      const count = (
        db
          .prepare("SELECT COUNT(*) AS count FROM brands WHERE workspace_id=?")
          .get(brand.workspace_id) as { count: number }
      ).count;
      if (count <= 1)
        return response
          .status(409)
          .json({
            error:
              "Create another brand before deleting the only brand in this workspace",
          });
      db.prepare("DELETE FROM brands WHERE id=?").run(brandId);
      response.status(204).end();
    },
  );

  app.get(
    "/api/brands/:brandId/members",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const rows = db
        .prepare(
          `SELECT bm.id,bm.user_id,bm.role,bm.permissions,bm.created_at,u.name,u.email
      FROM brand_members bm JOIN users u ON u.id=bm.user_id WHERE bm.brand_id=? ORDER BY bm.role='owner' DESC,u.name`,
        )
        .all(routeParam(request, "brandId"));
      response.json(deserializeRows(rows as Record<string, unknown>[]));
    },
  );
  app.post(
    "/api/brands/:brandId/members",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        name: z.string().min(1),
        email: z.email(),
        password: z.string().min(12),
        role: z.enum(["admin", "client"]).default("client"),
        permissions: z
          .array(
            z.enum([
              "campaigns",
              "templates",
              "lists",
              "automations",
              "reports",
              "files",
              "rules",
              "settings",
            ]),
          )
          .min(1),
      }),
    ),
    async (request, response) => {
      const brandId = routeParam(request, "brandId");
      if (!brandOwner(db, request, brandId))
        return response
          .status(403)
          .json({ error: "Only a brand owner can manage teammates" });
      let user = db
        .prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE")
        .get(request.body.email) as { id: string } | undefined;
      if (!user) {
        const userId = id("usr");
        db.prepare(
          "INSERT INTO users (id,name,email,password_hash,language,timezone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        ).run(
          userId,
          request.body.name,
          request.body.email,
          await hash(request.body.password, 12),
          "en",
          "Europe/Paris",
          nowIso(),
          nowIso(),
        );
        user = { id: userId };
      }
      const memberId = id("mem");
      try {
        db.prepare(
          "INSERT INTO brand_members (id,brand_id,user_id,role,permissions,created_at) VALUES (?,?,?,?,?,?)",
        ).run(
          memberId,
          brandId,
          user.id,
          request.body.role,
          JSON.stringify(request.body.permissions),
          nowIso(),
        );
      } catch {
        return response
          .status(409)
          .json({ error: "This account already has access to the brand" });
      }
      audit(
        db,
        "create",
        "brand_member",
        memberId,
        request.authUser?.id,
        brandId,
      );
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare(
                `SELECT bm.id,bm.user_id,bm.role,bm.permissions,bm.created_at,u.name,u.email FROM brand_members bm JOIN users u ON u.id=bm.user_id WHERE bm.id=?`,
              )
              .get(memberId) as Record<string, unknown>,
          ),
        );
    },
  );
  app.patch(
    "/api/brands/:brandId/members/:memberId",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        role: z.enum(["admin", "client"]).optional(),
        permissions: z.array(z.string()).min(1).optional(),
      }),
    ),
    (request, response) => {
      const brandId = routeParam(request, "brandId");
      if (!brandOwner(db, request, brandId))
        return response
          .status(403)
          .json({ error: "Only a brand owner can manage teammates" });
      const member = db
        .prepare(
          "SELECT id FROM brand_members WHERE id=? AND brand_id=? AND role!='owner'",
        )
        .get(routeParam(request, "memberId"), brandId);
      if (!member)
        return response.status(404).json({ error: "Teammate not found" });
      if (request.body.role)
        db.prepare("UPDATE brand_members SET role=? WHERE id=?").run(
          request.body.role,
          routeParam(request, "memberId"),
        );
      if (request.body.permissions)
        db.prepare("UPDATE brand_members SET permissions=? WHERE id=?").run(
          JSON.stringify(request.body.permissions),
          routeParam(request, "memberId"),
        );
      response.json(
        deserializeRow(
          db
            .prepare(
              `SELECT bm.id,bm.user_id,bm.role,bm.permissions,bm.created_at,u.name,u.email FROM brand_members bm JOIN users u ON u.id=bm.user_id WHERE bm.id=?`,
            )
            .get(routeParam(request, "memberId")) as Record<string, unknown>,
        ),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/members/:memberId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const brandId = routeParam(request, "brandId");
      if (!brandOwner(db, request, brandId))
        return response
          .status(403)
          .json({ error: "Only a brand owner can manage teammates" });
      db.prepare(
        "DELETE FROM brand_members WHERE id=? AND brand_id=? AND role!='owner'",
      ).run(routeParam(request, "memberId"), brandId);
      response.status(204).end();
    },
  );

  app.get(
    "/api/brands/:brandId/campaigns",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const status = request.query.status ? String(request.query.status) : null;
      const search = `%${String(request.query.q ?? "")}%`;
      const rows = status
        ? db
            .prepare(
              "SELECT * FROM campaigns WHERE brand_id=? AND status=? AND (subject LIKE ? OR label LIKE ?) ORDER BY COALESCE(sent_at,scheduled_at,created_at) DESC",
            )
            .all(routeParam(request, "brandId"), status, search, search)
        : db
            .prepare(
              "SELECT * FROM campaigns WHERE brand_id=? AND (subject LIKE ? OR label LIKE ?) ORDER BY COALESCE(sent_at,scheduled_at,created_at) DESC",
            )
            .all(routeParam(request, "brandId"), search, search);
      response.json(deserializeRows(rows as Record<string, unknown>[]));
    },
  );

  const campaignSchema = z.object({
    subject: z.string().min(1),
    label: z.string().default(""),
    from_name: z.string().min(1),
    from_email: z.email(),
    reply_to: z.email(),
    plain_text: z.string().default(""),
    html_text: z.string().default(""),
    editor_mode: z.enum(["blocks", "visual", "html"]).default("blocks"),
    editor_data: z.record(z.string(), z.unknown()).default({}),
    attachments: z.array(z.string()).default([]),
    query_string: z.string().default(""),
    web_language: z.string().default("en"),
    opens_tracking: z
      .enum(["identified", "anonymous", "off"])
      .default("identified"),
    clicks_tracking: z
      .enum(["identified", "anonymous", "off"])
      .default("identified"),
    check_links: z.boolean().default(true),
    targets: z
      .array(
        z.object({
          kind: z.enum(["list", "segment"]),
          target_id: z.string(),
          mode: z.enum(["include", "exclude"]),
        }),
      )
      .default([]),
  });
  app.post(
    "/api/brands/:brandId/campaigns",
    requireAuth,
    requireBrand(db),
    body(campaignSchema),
    (request, response) => {
      const campaignId = id("cmp");
      const { targets, ...campaign } = request.body;
      if (
        !campaignTargetsBelongToBrand(
          db,
          routeParam(request, "brandId"),
          targets,
        )
      )
        return response
          .status(422)
          .json({ error: "Every campaign target must belong to this brand" });
      db.prepare(
        `INSERT INTO campaigns (id,brand_id,label,subject,from_name,from_email,reply_to,plain_text,html_text,editor_mode,editor_data,attachments,query_string,web_language,opens_tracking,clicks_tracking,check_links,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        campaignId,
        routeParam(request, "brandId"),
        campaign.label,
        campaign.subject,
        campaign.from_name,
        campaign.from_email,
        campaign.reply_to,
        campaign.plain_text,
        sanitizeEmailHtml(campaign.html_text),
        campaign.editor_mode,
        JSON.stringify(campaign.editor_data),
        JSON.stringify(campaign.attachments),
        campaign.query_string,
        campaign.web_language,
        campaign.opens_tracking,
        campaign.clicks_tracking,
        bool(campaign.check_links),
        nowIso(),
        nowIso(),
      );
      const targetStmt = db.prepare(
        "INSERT INTO campaign_targets (id,campaign_id,kind,target_id,mode) VALUES (?,?,?,?,?)",
      );
      for (const target of targets)
        targetStmt.run(
          id("tgt"),
          campaignId,
          target.kind,
          target.target_id,
          target.mode,
        );
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM campaigns WHERE id=?")
              .get(campaignId) as Record<string, unknown>,
          ),
        );
    },
  );

  app.get(
    "/api/brands/:brandId/campaigns/:campaignId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const campaign = deserializeRow(
        db
          .prepare("SELECT * FROM campaigns WHERE id=? AND brand_id=?")
          .get(
            routeParam(request, "campaignId"),
            routeParam(request, "brandId"),
          ) as Record<string, unknown>,
      );
      if (!campaign)
        return response.status(404).json({ error: "Campaign not found" });
      const targets = db
        .prepare("SELECT * FROM campaign_targets WHERE campaign_id=?")
        .all(routeParam(request, "campaignId"));
      response.json({ ...campaign, targets });
    },
  );
  app.patch(
    "/api/brands/:brandId/campaigns/:campaignId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const campaignId = routeParam(request, "campaignId");
      const current = db
        .prepare("SELECT id,status FROM campaigns WHERE id=? AND brand_id=?")
        .get(campaignId, routeParam(request, "brandId")) as
        | { status: string }
        | undefined;
      if (!current)
        return response.status(404).json({ error: "Campaign not found" });
      if (["sending", "sent"].includes(current.status))
        return response
          .status(409)
          .json({ error: "This campaign can no longer be edited" });
      const values = { ...request.body };
      if (
        Array.isArray(values.targets) &&
        !campaignTargetsBelongToBrand(
          db,
          routeParam(request, "brandId"),
          values.targets,
        )
      )
        return response
          .status(422)
          .json({ error: "Every campaign target must belong to this brand" });
      if (typeof values.html_text === "string")
        values.html_text = sanitizeEmailHtml(values.html_text);
      updateColumns(db, "campaigns", campaignId, values, [
        "label",
        "subject",
        "from_name",
        "from_email",
        "reply_to",
        "plain_text",
        "html_text",
        "editor_mode",
        "editor_data",
        "query_string",
        "web_language",
        "attachments",
        "opens_tracking",
        "clicks_tracking",
        "check_links",
      ]);
      if (Array.isArray(values.targets)) {
        db.prepare("DELETE FROM campaign_targets WHERE campaign_id=?").run(
          campaignId,
        );
        for (const target of values.targets)
          db.prepare(
            "INSERT INTO campaign_targets (id,campaign_id,kind,target_id,mode) VALUES (?,?,?,?,?)",
          ).run(
            id("tgt"),
            campaignId,
            target.kind,
            target.target_id,
            target.mode,
          );
      }
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM campaigns WHERE id=?")
            .get(campaignId) as Record<string, unknown>,
        ),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/campaigns/:campaignId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare(
        `DELETE FROM campaigns WHERE id=? AND brand_id=? AND status NOT IN ('sending')`,
      ).run(routeParam(request, "campaignId"), routeParam(request, "brandId"));
      response.status(204).end();
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/duplicate",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const source = db
        .prepare("SELECT * FROM campaigns WHERE id=? AND brand_id=?")
        .get(
          routeParam(request, "campaignId"),
          routeParam(request, "brandId"),
        ) as Record<string, unknown> | undefined;
      if (!source)
        return response.status(404).json({ error: "Campaign not found" });
      const copyId = id("cmp");
      const columns = Object.keys(source).filter(
        (key) =>
          ![
            "id",
            "status",
            "scheduled_at",
            "started_at",
            "sent_at",
            "stopped_at",
            "total_recipients",
            "delivered",
            "failed",
            "error",
            "created_at",
            "updated_at",
          ].includes(key),
      );
      db.prepare(
        `INSERT INTO campaigns (id,status,total_recipients,delivered,failed,created_at,updated_at,${columns.join(",")}) VALUES (?,'draft',0,0,0,?,?,${columns.map(() => "?").join(",")})`,
      ).run(
        copyId,
        nowIso(),
        nowIso(),
        ...columns.map((column) =>
          column === "subject" ? `${source[column]} copy` : source[column],
        ),
      );
      const targets = db
        .prepare(
          "SELECT kind,target_id,mode FROM campaign_targets WHERE campaign_id=?",
        )
        .all(routeParam(request, "campaignId")) as Array<{
        kind: string;
        target_id: string;
        mode: string;
      }>;
      for (const target of targets)
        db.prepare(
          "INSERT INTO campaign_targets (id,campaign_id,kind,target_id,mode) VALUES (?,?,?,?,?)",
        ).run(id("tgt"), copyId, target.kind, target.target_id, target.mode);
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM campaigns WHERE id=?")
              .get(copyId) as Record<string, unknown>,
          ),
        );
    },
  );
  app.get(
    "/api/brands/:brandId/campaigns/:campaignId/estimate",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json({
        recipients: estimateCampaign(db, routeParam(request, "campaignId")),
      }),
  );
  app.get(
    "/api/brands/:brandId/campaigns/:campaignId/quote",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const quote = campaignQuote(db, routeParam(request, "campaignId"));
      if (quote) response.json(quote);
      else response.status(404).json({ error: "Campaign not found" });
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/checkout",
    requireAuth,
    requireBrand(db),
    body(z.object({ return_url: z.url(), cancel_url: z.url() })),
    async (request, response) => {
      const campaignId = routeParam(request, "campaignId");
      const quote = campaignQuote(db, campaignId);
      if (!quote)
        return response.status(404).json({ error: "Campaign not found" });
      if (quote.amount <= 0) return response.json({ required: false });
      const paymentId = id("pay");
      if (!config.paypalClientId || !config.paypalClientSecret) {
        const externalId = `local_${randomBytes(12).toString("hex")}`;
        db.prepare(
          "INSERT INTO payments (id,campaign_id,amount,currency,provider,status,external_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ).run(
          paymentId,
          campaignId,
          quote.amount,
          quote.currency,
          "stream",
          "pending",
          externalId,
          nowIso(),
          nowIso(),
        );
        return response
          .status(201)
          .json({
            required: true,
            paymentId,
            externalId,
            approvalUrl: null,
            testMode: true,
          });
      }
      const returnUrl = new URL(request.body.return_url);
      returnUrl.searchParams.set("paymentId", paymentId);
      const order = await createPayPalOrder(config, {
        amount: quote.amount,
        currency: quote.currency,
        campaignId,
        returnUrl: returnUrl.toString(),
        cancelUrl: request.body.cancel_url,
      });
      db.prepare(
        "INSERT INTO payments (id,campaign_id,amount,currency,provider,status,external_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        paymentId,
        campaignId,
        quote.amount,
        quote.currency,
        "paypal",
        order.status.toLowerCase(),
        order.id,
        nowIso(),
        nowIso(),
      );
      response
        .status(201)
        .json({
          required: true,
          paymentId,
          externalId: order.id,
          approvalUrl:
            order.links?.find(
              (link) => link.rel === "payer-action" || link.rel === "approve",
            )?.href ?? null,
          testMode: false,
        });
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/payments/:paymentId/capture",
    requireAuth,
    requireBrand(db),
    async (request, response) => {
      const payment = db
        .prepare("SELECT * FROM payments WHERE id=? AND campaign_id=?")
        .get(
          routeParam(request, "paymentId"),
          routeParam(request, "campaignId"),
        ) as Record<string, unknown> | undefined;
      if (!payment)
        return response.status(404).json({ error: "Payment not found" });
      if (payment.status === "completed")
        return response.json({ completed: true });
      if (payment.provider === "stream") {
        db.prepare(
          "UPDATE payments SET status='completed',updated_at=? WHERE id=?",
        ).run(nowIso(), payment.id);
        return response.json({ completed: true, testMode: true });
      }
      const capture = await capturePayPalOrder(
        config,
        String(payment.external_id),
      );
      const completed = capture.status === "COMPLETED";
      db.prepare("UPDATE payments SET status=?,updated_at=? WHERE id=?").run(
        capture.status.toLowerCase(),
        nowIso(),
        payment.id,
      );
      response
        .status(completed ? 200 : 409)
        .json({ completed, status: capture.status });
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/test",
    requireAuth,
    requireBrand(db),
    body(z.object({ emails: z.array(z.email()).min(1).max(10) })),
    async (request, response) => {
      const campaign = db
        .prepare("SELECT * FROM campaigns WHERE id=? AND brand_id=?")
        .get(
          routeParam(request, "campaignId"),
          routeParam(request, "brandId"),
        ) as Record<string, unknown> | undefined;
      const brand = db
        .prepare("SELECT * FROM brands WHERE id=?")
        .get(routeParam(request, "brandId")) as Record<string, unknown>;
      if (!campaign)
        return response.status(404).json({ error: "Campaign not found" });
      const linkIssues = await campaignLinkIssues(campaign);
      if (linkIssues.length)
        return response
          .status(422)
          .json({ error: "Broken links were found", issues: linkIssues });
      const attachmentIds = JSON.parse(
        String(campaign.attachments ?? "[]"),
      ) as string[];
      const attachments = attachmentIds.length
        ? (db
            .prepare(
              `SELECT name,storage_name FROM files WHERE brand_id=? AND kind='file' AND id IN (${attachmentIds.map(() => "?").join(",")})`,
            )
            .all(routeParam(request, "brandId"), ...attachmentIds) as Array<{
            name: string;
            storage_name: string;
          }>)
        : [];
      const results = [];
      for (const email of request.body.emails)
        results.push(
          await sendMessage(config, brand as never, {
            to: email,
            subject: `${brand.test_prefix} ${campaign.subject}`,
            html: String(campaign.html_text),
            text: String(campaign.plain_text),
            attachments: attachments.map((file) => ({
              filename: file.name,
              path: join(config.uploadDir, basename(file.storage_name)),
            })),
          }),
        );
      response.json({ sent: results.length, results });
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/send",
    requireAuth,
    requireBrand(db),
    async (request, response) => {
      const campaignId = routeParam(request, "campaignId");
      const quote = campaignQuote(db, campaignId);
      if (!quote)
        return response.status(404).json({ error: "Campaign not found" });
      const campaign = db
        .prepare("SELECT * FROM campaigns WHERE id=? AND brand_id=?")
        .get(campaignId, routeParam(request, "brandId")) as Record<
        string,
        unknown
      >;
      const linkIssues = await campaignLinkIssues(campaign);
      if (linkIssues.length)
        return response
          .status(422)
          .json({ error: "Broken links were found", issues: linkIssues });
      const recipients = quote.recipients;
      if (!recipients)
        return response
          .status(409)
          .json({
            error: "Choose at least one audience with active subscribers",
          });
      if (quote.remaining !== null && recipients > quote.remaining)
        return response
          .status(409)
          .json({
            error: `Monthly allowance has ${quote.remaining} messages remaining`,
          });
      if (
        quote.amount > 0 &&
        !db
          .prepare(
            "SELECT id FROM payments WHERE campaign_id=? AND status='completed' AND amount>=? ORDER BY created_at DESC LIMIT 1",
          )
          .get(campaignId, quote.amount)
      )
        return response
          .status(402)
          .json({ error: "Campaign payment is required", quote });
      db.prepare(
        `UPDATE campaigns SET status='queued',scheduled_at=NULL,timezone=NULL,total_recipients=?,updated_at=? WHERE id=? AND brand_id=?`,
      ).run(recipients, nowIso(), campaignId, routeParam(request, "brandId"));
      const jobId = enqueueJob(db, "campaign.send", { campaignId });
      response.status(202).json({ jobId, recipients });
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/schedule",
    requireAuth,
    requireBrand(db),
    body(
      z.object({ scheduled_at: z.iso.datetime(), timezone: z.string().min(1) }),
    ),
    async (request, response) => {
      const quote = campaignQuote(db, routeParam(request, "campaignId"));
      if (!quote)
        return response.status(404).json({ error: "Campaign not found" });
      const recipients = quote.recipients;
      const campaign = db
        .prepare("SELECT * FROM campaigns WHERE id=? AND brand_id=?")
        .get(
          routeParam(request, "campaignId"),
          routeParam(request, "brandId"),
        ) as Record<string, unknown>;
      const linkIssues = await campaignLinkIssues(campaign);
      if (linkIssues.length)
        return response
          .status(422)
          .json({ error: "Broken links were found", issues: linkIssues });
      if (quote.remaining !== null && recipients > quote.remaining)
        return response
          .status(409)
          .json({
            error: `Monthly allowance has ${quote.remaining} messages remaining`,
          });
      if (
        quote.amount > 0 &&
        !db
          .prepare(
            "SELECT id FROM payments WHERE campaign_id=? AND status='completed' AND amount>=? ORDER BY created_at DESC LIMIT 1",
          )
          .get(routeParam(request, "campaignId"), quote.amount)
      )
        return response
          .status(402)
          .json({ error: "Campaign payment is required", quote });
      db.prepare(
        `UPDATE campaigns SET status='scheduled',scheduled_at=?,timezone=?,total_recipients=?,updated_at=? WHERE id=? AND brand_id=?`,
      ).run(
        request.body.scheduled_at,
        request.body.timezone,
        recipients,
        nowIso(),
        routeParam(request, "campaignId"),
        routeParam(request, "brandId"),
      );
      response.json({ scheduledAt: request.body.scheduled_at, recipients });
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/stop",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare(
        `UPDATE campaigns SET status='stopped',stopped_at=?,updated_at=? WHERE id=? AND brand_id=? AND status IN ('queued','sending','scheduled')`,
      ).run(
        nowIso(),
        nowIso(),
        routeParam(request, "campaignId"),
        routeParam(request, "brandId"),
      );
      response.json({ ok: true });
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/resume",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare(
        `UPDATE campaigns SET status='queued',stopped_at=NULL,error=NULL,updated_at=? WHERE id=? AND brand_id=? AND status='stopped'`,
      ).run(
        nowIso(),
        routeParam(request, "campaignId"),
        routeParam(request, "brandId"),
      );
      response
        .status(202)
        .json({
          jobId: enqueueJob(db, "campaign.send", {
            campaignId: routeParam(request, "campaignId"),
          }),
        });
    },
  );
  app.get(
    "/api/brands/:brandId/campaigns/:campaignId/report",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const report = campaignReport(db, routeParam(request, "campaignId"));
      return report
        ? response.json(report)
        : response.status(404).json({ error: "Campaign not found" });
    },
  );
  app.get(
    "/api/brands/:brandId/campaigns/:campaignId/export/:type",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const allowed = new Set([
        "open",
        "click",
        "unsubscribe",
        "bounce",
        "complaint",
        "delivered",
      ]);
      if (!allowed.has(routeParam(request, "type")))
        return response.status(400).json({ error: "Unsupported export type" });
      const rows = db
        .prepare(
          `SELECT s.name,s.email,s.status,ce.country,ce.link_url,ce.occurred_at FROM campaign_events ce LEFT JOIN subscribers s ON s.id=ce.subscriber_id WHERE ce.campaign_id=? AND ce.type=? ORDER BY ce.occurred_at DESC`,
        )
        .all(routeParam(request, "campaignId"), routeParam(request, "type"));
      response
        .type("text/csv")
        .attachment(`${routeParam(request, "type")}-activity.csv`)
        .send(stringifyCsv(rows, { header: true }));
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/import-activity",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        type: z.enum([
          "delivered",
          "open",
          "click",
          "unsubscribe",
          "bounce",
          "complaint",
        ]),
        list_id: z.string(),
      }),
    ),
    (request, response) => {
      const target = db
        .prepare("SELECT id FROM lists WHERE id=? AND brand_id=?")
        .get(request.body.list_id, routeParam(request, "brandId"));
      if (!target)
        return response
          .status(404)
          .json({ error: "Target audience not found" });
      const subscribers = db
        .prepare(
          `SELECT DISTINCT s.* FROM campaign_events ce JOIN subscribers s ON s.id=ce.subscriber_id WHERE ce.campaign_id=? AND ce.type=?`,
        )
        .all(routeParam(request, "campaignId"), request.body.type) as Record<
        string,
        unknown
      >[];
      const insert =
        db.prepare(`INSERT INTO subscribers (id,list_id,name,email,status,custom_values,notes,source,consent,consent_at,confirmed_at,joined_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(list_id,email) DO UPDATE SET name=excluded.name,custom_values=excluded.custom_values,notes=excluded.notes,updated_at=excluded.updated_at`);
      let imported = 0;
      for (const subscriber of subscribers)
        imported += insert.run(
          id("sub"),
          request.body.list_id,
          subscriber.name,
          subscriber.email,
          "active",
          subscriber.custom_values,
          subscriber.notes,
          `campaign_${request.body.type}`,
          subscriber.consent,
          subscriber.consent_at,
          nowIso(),
          nowIso(),
          nowIso(),
        ).changes;
      response.json({ imported });
    },
  );
  app.get(
    "/api/brands/:brandId/campaigns/:campaignId/web",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const campaign = db
        .prepare(
          "SELECT subject,html_text FROM campaigns WHERE id=? AND brand_id=?",
        )
        .get(
          routeParam(request, "campaignId"),
          routeParam(request, "brandId"),
        ) as { subject: string; html_text: string } | undefined;
      if (!campaign) return response.status(404).end();
      response.json(campaign);
    },
  );

  app.get(
    "/api/brands/:brandId/lists",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const brand = db
        .prepare("SELECT list_sort,hide_hidden_lists FROM brands WHERE id=?")
        .get(routeParam(request, "brandId")) as {
        list_sort: string;
        hide_hidden_lists: number;
      };
      const includeHidden =
        request.query.include_hidden === "1" ||
        request.query.surface === "manage";
      const ordering =
        brand.list_sort === "name"
          ? "lower(l.name),l.created_at DESC"
          : "l.created_at DESC";
      const rows = db
        .prepare(
          `SELECT l.*,COUNT(s.id) AS subscribers,SUM(CASE WHEN s.status='active' THEN 1 ELSE 0 END) AS active FROM lists l LEFT JOIN subscribers s ON s.list_id=l.id WHERE l.brand_id=? AND (?=1 OR ?=0 OR l.hidden=0) GROUP BY l.id ORDER BY ${ordering}`,
        )
        .all(
          routeParam(request, "brandId"),
          includeHidden ? 1 : 0,
          brand.hide_hidden_lists,
        );
      response.json(deserializeRows(rows as Record<string, unknown>[]));
    },
  );
  app.get(
    "/api/brands/:brandId/segments",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        deserializeRows(
          db
            .prepare(
              `SELECT s.*,l.name AS list_name FROM segments s JOIN lists l ON l.id=s.list_id WHERE l.brand_id=? ORDER BY l.name,s.name`,
            )
            .all(routeParam(request, "brandId")) as Record<string, unknown>[],
        ),
      ),
  );
  const listSchema = z.object({
    name: z.string().min(1),
    opt_in: z.enum(["single", "double"]).default("double"),
  });
  app.post(
    "/api/brands/:brandId/lists",
    requireAuth,
    requireBrand(db),
    body(listSchema),
    (request, response) => {
      const listId = id("lst");
      db.prepare(
        "INSERT INTO lists (id,brand_id,name,opt_in,preference_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        listId,
        routeParam(request, "brandId"),
        request.body.name,
        request.body.opt_in,
        request.body.name,
        nowIso(),
        nowIso(),
      );
      response
        .status(201)
        .json(
          deserializeRow(
            db.prepare("SELECT * FROM lists WHERE id=?").get(listId) as Record<
              string,
              unknown
            >,
          ),
        );
    },
  );
  app.get(
    "/api/brands/:brandId/lists/:listId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const list = deserializeRow(
        db
          .prepare("SELECT * FROM lists WHERE id=? AND brand_id=?")
          .get(
            routeParam(request, "listId"),
            routeParam(request, "brandId"),
          ) as Record<string, unknown>,
      );
      if (!list) return response.status(404).json({ error: "List not found" });
      const fields = db
        .prepare(
          "SELECT * FROM custom_fields WHERE list_id=? ORDER BY position",
        )
        .all(routeParam(request, "listId"));
      const form_token = signToken(
        {
          listId: routeParam(request, "listId"),
          brandId: routeParam(request, "brandId"),
        },
        config.sessionSecret,
        365 * 86400,
      );
      response.json({ ...list, fields, form_token });
    },
  );
  app.patch(
    "/api/brands/:brandId/lists/:listId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      updateColumns(db, "lists", routeParam(request, "listId"), request.body, [
        "name",
        "opt_in",
        "subscribe_url",
        "confirm_url",
        "already_subscribed_url",
        "reconsent_url",
        "no_consent_url",
        "unsubscribe_url",
        "unsubscribe_scope",
        "unsubscribe_confirmation",
        "thank_you_enabled",
        "thank_you_subject",
        "thank_you_html",
        "confirmation_subject",
        "confirmation_html",
        "goodbye_enabled",
        "goodbye_subject",
        "goodbye_html",
        "consent_enabled",
        "marketing_permission",
        "what_to_expect",
        "form_fields",
        "hidden",
        "preference_visible",
        "preference_name",
        "preference_description",
        "preference_sort",
      ]);
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM lists WHERE id=?")
            .get(routeParam(request, "listId")) as Record<string, unknown>,
        ),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/lists/:listId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM lists WHERE id=? AND brand_id=?").run(
        routeParam(request, "listId"),
        routeParam(request, "brandId"),
      );
      response.status(204).end();
    },
  );
  app.get(
    "/api/brands/:brandId/lists/:listId/subscribers",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const status = String(request.query.status ?? "all");
      const q = `%${String(request.query.q ?? "")}%`;
      const country = String(request.query.country ?? "");
      const source = String(request.query.source ?? "");
      const page = Math.max(1, Number(request.query.page ?? 1));
      const workspace = db
        .prepare(
          `SELECT w.rows_per_page FROM workspaces w JOIN brands b ON b.workspace_id=w.id WHERE b.id=?`,
        )
        .get(routeParam(request, "brandId")) as { rows_per_page: number };
      const limit = Math.min(
        100,
        Math.max(10, Number(request.query.limit ?? workspace.rows_per_page)),
      );
      const filter = `list_id=? AND (name LIKE ? OR email LIKE ?) AND (?='all' OR status=?) AND (?='' OR country=?) AND (?='' OR source=?)`;
      const params = [
        routeParam(request, "listId"),
        q,
        q,
        status,
        status,
        country,
        country,
        source,
        source,
      ];
      const total = (
        db
          .prepare(`SELECT COUNT(*) AS count FROM subscribers WHERE ${filter}`)
          .get(...params) as { count: number }
      ).count;
      const rows = db
        .prepare(
          `SELECT * FROM subscribers WHERE ${filter} ORDER BY joined_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, (page - 1) * limit);
      const statusRows = db
        .prepare(
          "SELECT status,COUNT(*) AS count FROM subscribers WHERE list_id=? GROUP BY status",
        )
        .all(routeParam(request, "listId")) as Array<{
        status: string;
        count: number;
      }>;
      const sources = db
        .prepare(
          "SELECT DISTINCT source FROM subscribers WHERE list_id=? ORDER BY source",
        )
        .all(routeParam(request, "listId")) as Array<{ source: string }>;
      const countries = db
        .prepare(
          "SELECT DISTINCT country FROM subscribers WHERE list_id=? AND country IS NOT NULL AND country<>'' ORDER BY country",
        )
        .all(routeParam(request, "listId")) as Array<{ country: string }>;
      response.json({
        rows: deserializeRows(rows as Record<string, unknown>[]),
        total,
        page,
        limit,
        counts: Object.fromEntries(
          statusRows.map((row) => [row.status, row.count]),
        ),
        sources: sources.map((row) => row.source),
        countries: countries.map((row) => row.country),
      });
    },
  );
  const subscriberSchema = z.object({
    name: z.string().default(""),
    email: z.email(),
    status: z
      .enum(["active", "unconfirmed", "unsubscribed", "bounced", "complaint"])
      .default("active"),
    custom_values: z.record(z.string(), z.unknown()).default({}),
    consent: z.boolean().default(false),
    notes: z.string().default(""),
  });
  app.post(
    "/api/brands/:brandId/lists/:listId/subscribers",
    requireAuth,
    requireBrand(db),
    body(subscriberSchema),
    (request, response) => {
      const blocked = db
        .prepare(
          `SELECT 1 FROM suppressions WHERE brand_id=? AND email=? COLLATE NOCASE UNION SELECT 1 FROM blocked_domains WHERE brand_id=? AND domain=? COLLATE NOCASE`,
        )
        .get(
          routeParam(request, "brandId"),
          request.body.email,
          routeParam(request, "brandId"),
          request.body.email.split("@")[1],
        );
      if (blocked)
        return response
          .status(409)
          .json({ error: "This address is blocked for the brand" });
      const subscriberId = id("sub");
      const confirmationToken =
        request.body.status === "unconfirmed"
          ? randomBytes(24).toString("base64url")
          : null;
      db.prepare(
        `INSERT INTO subscribers (id,list_id,name,email,status,custom_values,notes,source,consent,consent_at,confirmation_token,confirmed_at,joined_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        subscriberId,
        routeParam(request, "listId"),
        request.body.name,
        request.body.email,
        request.body.status,
        JSON.stringify(request.body.custom_values),
        request.body.notes,
        "admin",
        bool(request.body.consent),
        request.body.consent ? nowIso() : null,
        confirmationToken ? tokenHash(confirmationToken) : null,
        request.body.status === "active" ? nowIso() : null,
        nowIso(),
        nowIso(),
      );
      if (request.body.status === "active") {
        scheduleSubscriberAutomations(db, subscriberId);
        enqueueJob(db, "rules.trigger", {
          brandId: routeParam(request, "brandId"),
          trigger: "subscribe",
          subscriberId,
          listId: routeParam(request, "listId"),
        });
      }
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM subscribers WHERE id=?")
              .get(subscriberId) as Record<string, unknown>,
          ),
        );
    },
  );
  app.get(
    "/api/brands/:brandId/lists/:listId/subscribers/export",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const rows = db
        .prepare(
          "SELECT name,email,status,country,source,consent,joined_at,last_activity_at,custom_values,notes FROM subscribers WHERE list_id=? ORDER BY joined_at DESC",
        )
        .all(routeParam(request, "listId"));
      response
        .type("text/csv")
        .attachment("subscribers.csv")
        .send(stringifyCsv(rows, { header: true }));
    },
  );
  app.get(
    "/api/brands/:brandId/lists/:listId/subscribers/:subscriberId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const subscriber = deserializeRow(
        db
          .prepare("SELECT * FROM subscribers WHERE id=? AND list_id=?")
          .get(
            routeParam(request, "subscriberId"),
            routeParam(request, "listId"),
          ) as Record<string, unknown>,
      );
      if (!subscriber)
        return response.status(404).json({ error: "Subscriber not found" });
      const activity = db
        .prepare(
          `SELECT ce.*,c.subject FROM campaign_events ce JOIN campaigns c ON c.id=ce.campaign_id WHERE ce.subscriber_id=? ORDER BY ce.occurred_at DESC LIMIT 100`,
        )
        .all(routeParam(request, "subscriberId"));
      const preferences = db
        .prepare(
          "SELECT * FROM preference_events WHERE email=? ORDER BY occurred_at DESC",
        )
        .all(subscriber.email);
      response.json({ ...subscriber, activity, preferences });
    },
  );
  app.patch(
    "/api/brands/:brandId/lists/:listId/subscribers/:subscriberId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      updateColumns(
        db,
        "subscribers",
        routeParam(request, "subscriberId"),
        request.body,
        [
          "name",
          "email",
          "status",
          "custom_values",
          "notes",
          "country",
          "consent",
          "consent_at",
        ],
      );
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM subscribers WHERE id=?")
            .get(routeParam(request, "subscriberId")) as Record<
            string,
            unknown
          >,
        ),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/lists/:listId/subscribers/:subscriberId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM subscribers WHERE id=? AND list_id=?").run(
        routeParam(request, "subscriberId"),
        routeParam(request, "listId"),
      );
      response.status(204).end();
    },
  );
  app.post(
    "/api/brands/:brandId/lists/:listId/subscribers/import",
    requireAuth,
    requireBrand(db),
    upload.single("file"),
    (request, response) => {
      const raw = request.file
        ? readFileSync(request.file.path, "utf8")
        : String(request.body.csv ?? request.body.lines ?? "");
      if (request.file) unlinkSync(request.file.path);
      const records: Array<Record<string, string>> = request.body.lines
        ? raw
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => {
              const [name, email] = line.includes(",")
                ? line.split(",")
                : ["", line];
              return { name: name?.trim() ?? "", email: email?.trim() ?? "" };
            })
        : (parseCsv(raw, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
          }) as Array<Record<string, string>>);
      const insert = db.prepare(
        `INSERT INTO subscribers (id,list_id,name,email,status,custom_values,source,consent,consent_at,confirmed_at,joined_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(list_id,email) DO UPDATE SET name=excluded.name,custom_values=excluded.custom_values,updated_at=excluded.updated_at`,
      );
      let imported = 0;
      let skipped = 0;
      for (const record of records) {
        const email = String(record.email ?? record.Email ?? "").toLowerCase();
        if (!z.email().safeParse(email).success) {
          skipped += 1;
          continue;
        }
        const blocked = db
          .prepare(
            `SELECT 1 FROM suppressions WHERE brand_id=? AND email=? COLLATE NOCASE UNION SELECT 1 FROM blocked_domains WHERE brand_id=? AND domain=? COLLATE NOCASE`,
          )
          .get(
            routeParam(request, "brandId"),
            email,
            routeParam(request, "brandId"),
            email.split("@")[1],
          );
        if (blocked) {
          skipped += 1;
          continue;
        }
        const subscriberId = id("sub");
        const custom = Object.fromEntries(
          Object.entries(record).filter(
            ([key]) =>
              !["name", "Name", "email", "Email", "gdpr", "consent"].includes(
                key,
              ),
          ),
        );
        insert.run(
          subscriberId,
          routeParam(request, "listId"),
          record.name ?? record.Name ?? "",
          email,
          "active",
          JSON.stringify(custom),
          "import",
          bool(
            ["1", "true", "yes"].includes(
              String(record.gdpr ?? record.consent ?? "").toLowerCase(),
            ),
          ),
          nowIso(),
          nowIso(),
          nowIso(),
          nowIso(),
        );
        scheduleSubscriberAutomations(db, subscriberId);
        imported += 1;
      }
      response.json({ imported, skipped });
    },
  );
  app.post(
    "/api/brands/:brandId/lists/:listId/fields",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        name: z.string().min(1),
        type: z.enum(["text", "date", "number", "boolean"]),
      }),
    ),
    (request, response) => {
      const fieldId = id("fld");
      const position = (
        db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS position FROM custom_fields WHERE list_id=?",
          )
          .get(routeParam(request, "listId")) as { position: number }
      ).position;
      db.prepare(
        "INSERT INTO custom_fields (id,list_id,name,type,position,created_at) VALUES (?,?,?,?,?,?)",
      ).run(
        fieldId,
        routeParam(request, "listId"),
        request.body.name,
        request.body.type,
        position,
        nowIso(),
      );
      response
        .status(201)
        .json(
          db.prepare("SELECT * FROM custom_fields WHERE id=?").get(fieldId),
        );
    },
  );
  app.patch(
    "/api/brands/:brandId/lists/:listId/fields/:fieldId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const entries = Object.entries(request.body).filter(([key]) =>
        ["name", "type", "position"].includes(key),
      );
      if (entries.length)
        db.prepare(
          `UPDATE custom_fields SET ${entries.map(([key]) => `${key}=?`).join(",")} WHERE id=? AND list_id=?`,
        ).run(
          ...entries.map(([, value]) => value),
          request.params.fieldId,
          routeParam(request, "listId"),
        );
      response.json(
        db
          .prepare("SELECT * FROM custom_fields WHERE id=?")
          .get(request.params.fieldId),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/lists/:listId/fields/:fieldId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const used = db
        .prepare("SELECT id FROM automations WHERE date_field_id=?")
        .get(request.params.fieldId);
      if (used)
        return response
          .status(409)
          .json({ error: "This field is used by an automation" });
      db.prepare("DELETE FROM custom_fields WHERE id=? AND list_id=?").run(
        request.params.fieldId,
        routeParam(request, "listId"),
      );
      response.status(204).end();
    },
  );

  app.get(
    "/api/brands/:brandId/lists/:listId/segments",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        deserializeRows(
          db
            .prepare(
              "SELECT * FROM segments WHERE list_id=? ORDER BY created_at DESC",
            )
            .all(routeParam(request, "listId")) as Record<string, unknown>[],
        ),
      ),
  );
  app.post(
    "/api/brands/:brandId/lists/:listId/segments",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        name: z.string().min(1),
        match_mode: z.enum(["all", "any"]).default("all"),
        conditions: z
          .array(
            z.object({
              group_no: z.number().int().min(0),
              field: z.string(),
              operator: z.string(),
              value: z.string().default(""),
            }),
          )
          .min(1),
      }),
    ),
    (request, response) => {
      const segmentId = id("seg");
      db.prepare(
        "INSERT INTO segments (id,list_id,name,match_mode,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      ).run(
        segmentId,
        routeParam(request, "listId"),
        request.body.name,
        request.body.match_mode,
        nowIso(),
        nowIso(),
      );
      request.body.conditions.forEach(
        (
          condition: {
            group_no: number;
            field: string;
            operator: string;
            value: string;
          },
          position: number,
        ) =>
          db
            .prepare(
              "INSERT INTO segment_conditions (id,segment_id,group_no,field,operator,value,position) VALUES (?,?,?,?,?,?,?)",
            )
            .run(
              id("con"),
              segmentId,
              condition.group_no,
              condition.field,
              condition.operator,
              condition.value,
              position,
            ),
      );
      const count = refreshSegmentCount(db, segmentId);
      response
        .status(201)
        .json({
          ...(db
            .prepare("SELECT * FROM segments WHERE id=?")
            .get(segmentId) as object),
          count,
        });
    },
  );
  app.get(
    "/api/brands/:brandId/lists/:listId/segments/:segmentId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const segment = db
        .prepare("SELECT * FROM segments WHERE id=? AND list_id=?")
        .get(routeParam(request, "segmentId"), routeParam(request, "listId"));
      if (!segment)
        return response.status(404).json({ error: "Segment not found" });
      response.json({
        ...(segment as object),
        conditions: db
          .prepare(
            "SELECT * FROM segment_conditions WHERE segment_id=? ORDER BY group_no,position",
          )
          .all(routeParam(request, "segmentId")),
        count: refreshSegmentCount(db, routeParam(request, "segmentId")),
      });
    },
  );
  app.patch(
    "/api/brands/:brandId/lists/:listId/segments/:segmentId",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        name: z.string().min(1),
        match_mode: z.enum(["all", "any"]),
        conditions: z
          .array(
            z.object({
              group_no: z.number().int().min(0),
              field: z.string(),
              operator: z.string(),
              value: z.string().default(""),
            }),
          )
          .min(1),
      }),
    ),
    (request, response) => {
      const segmentId = routeParam(request, "segmentId");
      const exists = db
        .prepare("SELECT id FROM segments WHERE id=? AND list_id=?")
        .get(segmentId, routeParam(request, "listId"));
      if (!exists)
        return response.status(404).json({ error: "Segment not found" });
      db.transaction(() => {
        db.prepare(
          "UPDATE segments SET name=?,match_mode=?,updated_at=? WHERE id=?",
        ).run(request.body.name, request.body.match_mode, nowIso(), segmentId);
        db.prepare("DELETE FROM segment_conditions WHERE segment_id=?").run(
          segmentId,
        );
        request.body.conditions.forEach(
          (
            condition: {
              group_no: number;
              field: string;
              operator: string;
              value: string;
            },
            position: number,
          ) =>
            db
              .prepare(
                "INSERT INTO segment_conditions (id,segment_id,group_no,field,operator,value,position) VALUES (?,?,?,?,?,?,?)",
              )
              .run(
                id("con"),
                segmentId,
                condition.group_no,
                condition.field,
                condition.operator,
                condition.value,
                position,
              ),
        );
      })();
      response.json({
        ...(db
          .prepare("SELECT * FROM segments WHERE id=?")
          .get(segmentId) as object),
        count: refreshSegmentCount(db, segmentId),
      });
    },
  );
  app.delete(
    "/api/brands/:brandId/lists/:listId/segments/:segmentId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM segments WHERE id=? AND list_id=?").run(
        routeParam(request, "segmentId"),
        routeParam(request, "listId"),
      );
      response.status(204).end();
    },
  );

  app.get(
    "/api/brands/:brandId/templates",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const brand = db
        .prepare("SELECT template_sort FROM brands WHERE id=?")
        .get(routeParam(request, "brandId")) as { template_sort: string };
      const ordering =
        brand.template_sort === "name"
          ? "lower(name),updated_at DESC"
          : "updated_at DESC";
      response.json(
        deserializeRows(
          db
            .prepare(
              `SELECT * FROM templates WHERE brand_id=? ORDER BY ${ordering}`,
            )
            .all(routeParam(request, "brandId")) as Record<string, unknown>[],
        ),
      );
    },
  );
  app.post(
    "/api/brands/:brandId/templates",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        name: z.string().min(1),
        subject: z.string().default(""),
        plain_text: z.string().default(""),
        html_text: z.string().default(""),
        editor_mode: z.enum(["blocks", "visual", "html"]).default("blocks"),
        editor_data: z.record(z.string(), z.unknown()).default({}),
      }),
    ),
    (request, response) => {
      const templateId = id("tpl");
      db.prepare(
        "INSERT INTO templates (id,brand_id,name,subject,plain_text,html_text,editor_mode,editor_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(
        templateId,
        routeParam(request, "brandId"),
        request.body.name,
        request.body.subject,
        request.body.plain_text,
        sanitizeEmailHtml(request.body.html_text),
        request.body.editor_mode,
        JSON.stringify(request.body.editor_data),
        nowIso(),
        nowIso(),
      );
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM templates WHERE id=?")
              .get(templateId) as Record<string, unknown>,
          ),
        );
    },
  );
  app.post(
    "/api/brands/:brandId/templates/import-url",
    requireAuth,
    requireBrand(db),
    body(z.object({ url: z.url() })),
    async (request, response) => {
      const parsed = new URL(request.body.url);
      try {
        await assertPublicUrl(parsed);
      } catch (error) {
        return response
          .status(400)
          .json({
            error:
              error instanceof Error ? error.message : "Public URL required",
          });
      }
      const result = await fetch(parsed, {
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!result.ok)
        return response
          .status(422)
          .json({ error: `Import returned ${result.status}` });
      const html = sanitizeEmailHtml((await result.text()).slice(0, 2_000_000));
      const templateId = id("tpl");
      db.prepare(
        "INSERT INTO templates (id,brand_id,name,subject,html_text,editor_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        templateId,
        routeParam(request, "brandId"),
        parsed.hostname,
        "Imported template",
        html,
        "html",
        nowIso(),
        nowIso(),
      );
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM templates WHERE id=?")
              .get(templateId) as Record<string, unknown>,
          ),
        );
    },
  );
  app.patch(
    "/api/brands/:brandId/templates/:templateId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const values = { ...request.body };
      if (typeof values.html_text === "string")
        values.html_text = sanitizeEmailHtml(values.html_text);
      updateColumns(
        db,
        "templates",
        routeParam(request, "templateId"),
        values,
        [
          "name",
          "subject",
          "plain_text",
          "html_text",
          "editor_mode",
          "editor_data",
          "thumbnail_path",
        ],
      );
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM templates WHERE id=?")
            .get(routeParam(request, "templateId")) as Record<string, unknown>,
        ),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/templates/:templateId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM templates WHERE id=? AND brand_id=?").run(
        routeParam(request, "templateId"),
        routeParam(request, "brandId"),
      );
      response.status(204).end();
    },
  );

  app.get(
    "/api/brands/:brandId/automations",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const rows = db
        .prepare(
          `SELECT a.*,l.name AS list_name,COALESCE(SUM(st.sent_count),0) AS sent_count,COUNT(st.id) AS step_count FROM automations a JOIN lists l ON l.id=a.list_id LEFT JOIN automation_steps st ON st.automation_id=a.id WHERE l.brand_id=? GROUP BY a.id ORDER BY a.created_at DESC`,
        )
        .all(routeParam(request, "brandId"));
      response.json(deserializeRows(rows as Record<string, unknown>[]));
    },
  );
  app.post(
    "/api/brands/:brandId/automations",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        list_id: z.string(),
        name: z.string().min(1),
        type: z.enum(["drip", "annual", "date"]),
        date_field_id: z.string().nullable().optional(),
      }),
    ),
    (request, response) => {
      const automationId = id("aut");
      if (
        !db
          .prepare("SELECT id FROM lists WHERE id=? AND brand_id=?")
          .get(request.body.list_id, routeParam(request, "brandId"))
      )
        return response.status(404).json({ error: "Audience not found" });
      if (request.body.type !== "drip" && !request.body.date_field_id)
        return response
          .status(422)
          .json({ error: "A date field is required for this automation type" });
      if (
        request.body.date_field_id &&
        !db
          .prepare(
            "SELECT id FROM custom_fields WHERE id=? AND list_id=? AND type='date'",
          )
          .get(request.body.date_field_id, request.body.list_id)
      )
        return response
          .status(422)
          .json({ error: "Choose a date field from the selected audience" });
      db.prepare(
        "INSERT INTO automations (id,list_id,name,type,date_field_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        automationId,
        request.body.list_id,
        request.body.name,
        request.body.type,
        request.body.date_field_id ?? null,
        nowIso(),
        nowIso(),
      );
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM automations WHERE id=?")
              .get(automationId) as Record<string, unknown>,
          ),
        );
    },
  );
  app.get(
    "/api/brands/:brandId/automations/:automationId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const automation = deserializeRow(
        db
          .prepare(
            `SELECT a.* FROM automations a JOIN lists l ON l.id=a.list_id WHERE a.id=? AND l.brand_id=?`,
          )
          .get(
            routeParam(request, "automationId"),
            routeParam(request, "brandId"),
          ) as Record<string, unknown>,
      );
      if (!automation)
        return response.status(404).json({ error: "Automation not found" });
      response.json({
        ...automation,
        steps: deserializeRows(
          db
            .prepare(
              "SELECT * FROM automation_steps WHERE automation_id=? ORDER BY position",
            )
            .all(routeParam(request, "automationId")) as Record<
            string,
            unknown
          >[],
        ),
      });
    },
  );
  app.patch(
    "/api/brands/:brandId/automations/:automationId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      updateColumns(
        db,
        "automations",
        routeParam(request, "automationId"),
        request.body,
        ["name", "enabled", "date_field_id"],
      );
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM automations WHERE id=?")
            .get(routeParam(request, "automationId")) as Record<
            string,
            unknown
          >,
        ),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/automations/:automationId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM automations WHERE id=?").run(
        routeParam(request, "automationId"),
      );
      response.status(204).end();
    },
  );
  app.post(
    "/api/brands/:brandId/automations/:automationId/steps",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        offset_value: z.number().int().min(0),
        offset_unit: z.enum(["minutes", "hours", "days", "weeks", "months"]),
        offset_direction: z.enum(["before", "after"]).default("after"),
        subject: z.string().min(1),
        from_name: z.string(),
        from_email: z.email(),
        reply_to: z.email(),
        plain_text: z.string().default(""),
        html_text: z.string().default(""),
        editor_mode: z.enum(["blocks", "visual", "html"]).default("blocks"),
        segment_include: z.array(z.string()).default([]),
        segment_exclude: z.array(z.string()).default([]),
        opens_tracking: z
          .enum(["identified", "anonymous", "off"])
          .default("identified"),
        clicks_tracking: z
          .enum(["identified", "anonymous", "off"])
          .default("identified"),
        channel: z.enum(["email", "sms", "whatsapp", "push"]).default("email"),
        sender_identity_id: z.string().nullable().optional(),
        channel_payload: z.record(z.string(), z.unknown()).default({}),
        consent_purpose: z.enum(["marketing", "transactional", "support"]).default("marketing"),
        tracking_policy: z.record(z.string(), z.unknown()).default({}),
      }),
    ),
    (request, response) => {
      const stepId = id("ast");
      const position = (
        db
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS position FROM automation_steps WHERE automation_id=?",
          )
          .get(routeParam(request, "automationId")) as { position: number }
      ).position;
      db.prepare(
        `INSERT INTO automation_steps (id,automation_id,position,offset_value,offset_unit,offset_direction,subject,from_name,from_email,reply_to,plain_text,html_text,editor_mode,segment_include,segment_exclude,opens_tracking,clicks_tracking,channel,sender_identity_id,channel_payload,consent_purpose,tracking_policy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        stepId,
        routeParam(request, "automationId"),
        position,
        request.body.offset_value,
        request.body.offset_unit,
        request.body.offset_direction,
        request.body.subject,
        request.body.from_name,
        request.body.from_email,
        request.body.reply_to,
        request.body.plain_text,
        sanitizeEmailHtml(request.body.html_text),
        request.body.editor_mode,
        JSON.stringify(request.body.segment_include),
        JSON.stringify(request.body.segment_exclude),
        request.body.opens_tracking,
        request.body.clicks_tracking,
        request.body.channel,
        request.body.sender_identity_id ?? null,
        JSON.stringify(request.body.channel_payload),
        request.body.consent_purpose,
        JSON.stringify(request.body.tracking_policy),
        nowIso(),
        nowIso(),
      );
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM automation_steps WHERE id=?")
              .get(stepId) as Record<string, unknown>,
          ),
        );
    },
  );
  app.post(
    "/api/brands/:brandId/automations/:automationId/steps/reorder",
    requireAuth,
    requireBrand(db),
    body(z.object({ step_ids: z.array(z.string()).min(1) })),
    (request, response) => {
      const existing = db
        .prepare(
          "SELECT id FROM automation_steps WHERE automation_id=? ORDER BY position",
        )
        .all(routeParam(request, "automationId")) as Array<{ id: string }>;
      if (
        existing.length !== request.body.step_ids.length ||
        existing.some((step) => !request.body.step_ids.includes(step.id))
      )
        return response
          .status(422)
          .json({ error: "Every automation step must be included once" });
      db.transaction(() => {
        db.prepare(
          "UPDATE automation_steps SET position=-position-1 WHERE automation_id=?",
        ).run(routeParam(request, "automationId"));
        request.body.step_ids.forEach((stepId: string, position: number) =>
          db
            .prepare(
              "UPDATE automation_steps SET position=?,updated_at=? WHERE id=? AND automation_id=?",
            )
            .run(
              position,
              nowIso(),
              stepId,
              routeParam(request, "automationId"),
            ),
        );
      })();
      response.json({ reordered: request.body.step_ids.length });
    },
  );
  app.patch(
    "/api/brands/:brandId/automations/:automationId/steps/:stepId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const values = { ...request.body };
      if (typeof values.html_text === "string")
        values.html_text = sanitizeEmailHtml(values.html_text);
      updateColumns(
        db,
        "automation_steps",
        routeParam(request, "stepId"),
        values,
        [
          "position",
          "offset_value",
          "offset_unit",
          "offset_direction",
          "subject",
          "from_name",
          "from_email",
          "reply_to",
          "plain_text",
          "html_text",
          "editor_mode",
          "editor_data",
          "query_string",
          "opens_tracking",
          "clicks_tracking",
          "segment_include",
          "segment_exclude",
          "enabled",
          "channel",
          "sender_identity_id",
          "channel_payload",
          "consent_purpose",
          "tracking_policy",
        ],
      );
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM automation_steps WHERE id=?")
            .get(routeParam(request, "stepId")) as Record<string, unknown>,
        ),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/automations/:automationId/steps/:stepId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM automation_steps WHERE id=?").run(
        routeParam(request, "stepId"),
      );
      response.status(204).end();
    },
  );
  app.get(
    "/api/brands/:brandId/automations/:automationId/report",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const automationId = routeParam(request, "automationId");
      const steps = db
        .prepare(
          `SELECT st.id,st.subject,st.sent_count,SUM(CASE WHEN d.status='sent' THEN 1 ELSE 0 END) AS delivered,SUM(CASE WHEN d.status='failed' THEN 1 ELSE 0 END) AS failed,(SELECT COUNT(DISTINCT ae.subscriber_id) FROM automation_events ae WHERE ae.step_id=st.id AND ae.type='open') AS unique_opens,(SELECT COUNT(DISTINCT ae.subscriber_id) FROM automation_events ae WHERE ae.step_id=st.id AND ae.type='click') AS unique_clicks FROM automation_steps st LEFT JOIN automation_deliveries d ON d.step_id=st.id WHERE st.automation_id=? GROUP BY st.id ORDER BY st.position`,
        )
        .all(automationId);
      const analysis = deserializeRow(
        db
          .prepare(
            "SELECT * FROM ai_analyses WHERE entity_type='automation' AND entity_id=? ORDER BY updated_at DESC LIMIT 1",
          )
          .get(automationId) as Record<string, unknown>,
      );
      response.json({ steps, analysis });
    },
  );
  app.post(
    "/api/brands/:brandId/automations/:automationId/analyze",
    requireAuth,
    requireBrand(db),
    async (request, response) => {
      const ai = requireEnabledAi(
        db,
        config,
        routeParam(request, "brandId"),
      );
      if (!ai)
        return response
          .status(403)
          .json({ error: "AI features are disabled for this brand" });
      response.json(
        await analyzeAutomationReport(
          ai,
          routeParam(request, "automationId"),
        ),
      );
    },
  );

  app.get(
    "/api/brands/:brandId/rules",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        deserializeRows(
          db
            .prepare(
              "SELECT * FROM rules WHERE brand_id=? ORDER BY created_at DESC",
            )
            .all(routeParam(request, "brandId")) as Record<string, unknown>[],
        ),
      ),
  );
  app.post(
    "/api/brands/:brandId/rules",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        name: z.string().min(1),
        trigger_type: z.enum([
          "subscribe",
          "unsubscribe",
          "campaign_started",
          "campaign_sent",
          "automation_sent",
        ]),
        action_type: z.enum(["webhook", "email", "unsubscribe"]),
        scope: z.record(z.string(), z.unknown()).default({}),
        action_config: z.record(z.string(), z.unknown()),
      }),
    ),
    (request, response) => {
      const ruleId = id("rul");
      db.prepare(
        "INSERT INTO rules (id,brand_id,name,trigger_type,action_type,scope,action_config,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        ruleId,
        routeParam(request, "brandId"),
        request.body.name,
        request.body.trigger_type,
        request.body.action_type,
        JSON.stringify(request.body.scope),
        JSON.stringify(request.body.action_config),
        nowIso(),
        nowIso(),
      );
      response
        .status(201)
        .json(
          deserializeRow(
            db.prepare("SELECT * FROM rules WHERE id=?").get(ruleId) as Record<
              string,
              unknown
            >,
          ),
        );
    },
  );
  app.patch(
    "/api/brands/:brandId/rules/:ruleId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      updateColumns(db, "rules", routeParam(request, "ruleId"), request.body, [
        "name",
        "trigger_type",
        "action_type",
        "scope",
        "action_config",
        "enabled",
      ]);
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM rules WHERE id=?")
            .get(routeParam(request, "ruleId")) as Record<string, unknown>,
        ),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/rules/:ruleId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM rules WHERE id=? AND brand_id=?").run(
        routeParam(request, "ruleId"),
        routeParam(request, "brandId"),
      );
      response.status(204).end();
    },
  );
  app.get(
    "/api/brands/:brandId/webhooks",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        db
          .prepare(
            `SELECT wl.*,r.name AS rule_name FROM webhook_logs wl LEFT JOIN rules r ON r.id=wl.rule_id WHERE r.brand_id=? OR r.brand_id IS NULL ORDER BY attempted_at DESC LIMIT 200`,
          )
          .all(routeParam(request, "brandId")),
      ),
  );

  app.get(
    "/api/brands/:brandId/suppressions",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        db
          .prepare(
            "SELECT * FROM suppressions WHERE brand_id=? ORDER BY created_at DESC",
          )
          .all(routeParam(request, "brandId")),
      ),
  );
  app.post(
    "/api/brands/:brandId/suppressions",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        emails: z.array(z.email()).min(1),
        reason: z.string().default("manual"),
      }),
    ),
    (request, response) => {
      const stmt = db.prepare(
        "INSERT OR IGNORE INTO suppressions (id,brand_id,email,reason,created_at) VALUES (?,?,?,?,?)",
      );
      let added = 0;
      for (const email of request.body.emails) {
        added += stmt.run(
          id("sup"),
          routeParam(request, "brandId"),
          email.toLowerCase(),
          request.body.reason,
          nowIso(),
        ).changes;
        db.prepare(
          `UPDATE subscribers SET status='unsubscribed',updated_at=? WHERE email=? COLLATE NOCASE AND list_id IN (SELECT id FROM lists WHERE brand_id=?)`,
        ).run(nowIso(), email, routeParam(request, "brandId"));
      }
      response.json({ added });
    },
  );
  app.delete(
    "/api/brands/:brandId/suppressions/:suppressionId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM suppressions WHERE id=? AND brand_id=?").run(
        routeParam(request, "suppressionId"),
        routeParam(request, "brandId"),
      );
      response.status(204).end();
    },
  );
  app.get(
    "/api/brands/:brandId/blocked-domains",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        db
          .prepare(
            "SELECT * FROM blocked_domains WHERE brand_id=? ORDER BY created_at DESC",
          )
          .all(routeParam(request, "brandId")),
      ),
  );
  app.post(
    "/api/brands/:brandId/blocked-domains",
    requireAuth,
    requireBrand(db),
    body(z.object({ domains: z.array(z.string().min(1)).min(1) })),
    (request, response) => {
      const stmt = db.prepare(
        "INSERT OR IGNORE INTO blocked_domains (id,brand_id,domain,created_at) VALUES (?,?,?,?)",
      );
      let added = 0;
      for (const domain of request.body.domains) {
        const clean = domain.toLowerCase().replace(/^@/, "");
        added += stmt.run(
          id("dom"),
          routeParam(request, "brandId"),
          clean,
          nowIso(),
        ).changes;
        db.prepare(
          `UPDATE subscribers SET status='unsubscribed',updated_at=? WHERE lower(substr(email,instr(email,'@')+1))=? AND list_id IN (SELECT id FROM lists WHERE brand_id=?)`,
        ).run(nowIso(), clean, routeParam(request, "brandId"));
      }
      response.json({ added });
    },
  );
  app.delete(
    "/api/brands/:brandId/blocked-domains/:domainId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      db.prepare("DELETE FROM blocked_domains WHERE id=? AND brand_id=?").run(
        routeParam(request, "domainId"),
        routeParam(request, "brandId"),
      );
      response.status(204).end();
    },
  );
  app.post(
    "/api/brands/:brandId/housekeeping",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        action: z.enum([
          "unconfirmed_7d",
          "unconfirmed_14d",
          "inactive",
          "never_engaged",
        ]),
        list_id: z.string().optional(),
        before: z.iso.datetime().optional(),
      }),
    ),
    (request, response) => {
      const listClause = request.body.list_id
        ? "AND list_id=?"
        : `AND list_id IN (SELECT id FROM lists WHERE brand_id=?)`;
      const target = request.body.list_id ?? routeParam(request, "brandId");
      let result;
      if (request.body.action.startsWith("unconfirmed"))
        result = db
          .prepare(
            `DELETE FROM subscribers WHERE status='unconfirmed' AND joined_at<? ${listClause}`,
          )
          .run(
            new Date(
              Date.now() -
                (request.body.action === "unconfirmed_14d" ? 14 : 7) * 86400000,
            ).toISOString(),
            target,
          );
      else
        result = db
          .prepare(
            `DELETE FROM subscribers WHERE status='active' AND COALESCE(last_activity_at,joined_at)<? ${listClause}`,
          )
          .run(
            request.body.before ??
              new Date(Date.now() - 180 * 86400000).toISOString(),
            target,
          );
      response.json({ removed: result.changes });
    },
  );

  app.get(
    "/api/brands/:brandId/files",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        db
          .prepare(
            "SELECT * FROM files WHERE brand_id=? AND parent_id IS ? ORDER BY kind DESC,name",
          )
          .all(routeParam(request, "brandId"), request.query.parentId ?? null),
      ),
  );
  app.post(
    "/api/brands/:brandId/files/folder",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        name: z.string().min(1),
        parent_id: z.string().nullable().default(null),
      }),
    ),
    (request, response) => {
      if (
        request.body.parent_id &&
        !db
          .prepare(
            "SELECT id FROM files WHERE id=? AND brand_id=? AND kind='folder'",
          )
          .get(request.body.parent_id, routeParam(request, "brandId"))
      )
        return response.status(404).json({ error: "Parent folder not found" });
      const fileId = id("fil");
      db.prepare(
        "INSERT INTO files (id,brand_id,parent_id,kind,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        fileId,
        routeParam(request, "brandId"),
        request.body.parent_id,
        "folder",
        basename(request.body.name),
        nowIso(),
        nowIso(),
      );
      response
        .status(201)
        .json(db.prepare("SELECT * FROM files WHERE id=?").get(fileId));
    },
  );
  app.post(
    "/api/brands/:brandId/files/upload",
    requireAuth,
    requireBrand(db),
    upload.array("files", 10),
    (request, response) => {
      const brand = db
        .prepare("SELECT allowed_attachments FROM brands WHERE id=?")
        .get(routeParam(request, "brandId")) as { allowed_attachments: string };
      const allowed = new Set(
        (JSON.parse(brand.allowed_attachments) as string[]).map(
          (extension) => `.${extension.toLowerCase().replace(/^\./, "")}`,
        ),
      );
      const files = request.files as Express.Multer.File[];
      const created = [];
      if (
        request.body.parent_id &&
        !db
          .prepare(
            "SELECT id FROM files WHERE id=? AND brand_id=? AND kind='folder'",
          )
          .get(request.body.parent_id, routeParam(request, "brandId"))
      ) {
        for (const file of files) unlinkSync(file.path);
        return response.status(404).json({ error: "Parent folder not found" });
      }
      for (const file of files) {
        if (!allowed.has(extname(file.originalname).toLowerCase())) {
          unlinkSync(file.path);
          continue;
        }
        const fileId = id("fil");
        db.prepare(
          "INSERT INTO files (id,brand_id,parent_id,kind,name,storage_name,mime_type,size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
          fileId,
          routeParam(request, "brandId"),
          request.body.parent_id || null,
          "file",
          basename(file.originalname),
          basename(file.filename),
          file.mimetype,
          file.size,
          nowIso(),
          nowIso(),
        );
        created.push(db.prepare("SELECT * FROM files WHERE id=?").get(fileId));
      }
      response.status(201).json(created);
    },
  );
  app.patch(
    "/api/brands/:brandId/files/:fileId",
    requireAuth,
    requireBrand(db),
    body(z.object({ name: z.string().min(1) })),
    (request, response) => {
      db.prepare(
        "UPDATE files SET name=?,updated_at=? WHERE id=? AND brand_id=?",
      ).run(
        basename(request.body.name),
        nowIso(),
        routeParam(request, "fileId"),
        routeParam(request, "brandId"),
      );
      response.json(
        db
          .prepare("SELECT * FROM files WHERE id=?")
          .get(routeParam(request, "fileId")),
      );
    },
  );
  app.delete(
    "/api/brands/:brandId/files/:fileId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const storedFiles = db
        .prepare(
          `WITH RECURSIVE descendants(id,storage_name) AS (
      SELECT id,storage_name FROM files WHERE id=? AND brand_id=? UNION ALL
      SELECT f.id,f.storage_name FROM files f JOIN descendants d ON f.parent_id=d.id
    ) SELECT storage_name FROM descendants WHERE storage_name IS NOT NULL`,
        )
        .all(
          routeParam(request, "fileId"),
          routeParam(request, "brandId"),
        ) as Array<{ storage_name: string }>;
      for (const file of storedFiles) {
        try {
          unlinkSync(join(config.uploadDir, basename(file.storage_name)));
        } catch {
          /* already absent */
        }
      }
      db.prepare("DELETE FROM files WHERE id=? AND brand_id=?").run(
        routeParam(request, "fileId"),
        routeParam(request, "brandId"),
      );
      response.status(204).end();
    },
  );

  app.post(
    "/api/brands/:brandId/ai/email",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        task: z.string().min(1),
        design: z.string().optional(),
        requirements: z.string().optional(),
      }),
    ),
    async (request, response) => {
      const ai = requireEnabledAi(
        db,
        config,
        routeParam(request, "brandId"),
      );
      if (!ai)
        return response
          .status(403)
          .json({ error: "AI features are disabled for this brand" });
      response.json(await generateEmail(ai, request.body));
    },
  );
  app.post(
    "/api/brands/:brandId/ai/subject",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        content: z.string().min(1),
        current: z.string().optional(),
        mode: z.enum(["concise", "curiosity", "value", "personal"]).optional(),
      }),
    ),
    async (request, response) => {
      const ai = requireEnabledAi(
        db,
        config,
        routeParam(request, "brandId"),
      );
      if (!ai)
        return response
          .status(403)
          .json({ error: "AI features are disabled for this brand" });
      response.json(await generateSubject(ai, request.body));
    },
  );
  app.post(
    "/api/brands/:brandId/ai/improve",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        content: z.string().min(1),
        instruction: z.string().optional(),
      }),
    ),
    async (request, response) => {
      const ai = requireEnabledAi(
        db,
        config,
        routeParam(request, "brandId"),
      );
      if (!ai)
        return response
          .status(403)
          .json({ error: "AI features are disabled for this brand" });
      response.json(await improveContent(ai, request.body));
    },
  );
  app.post(
    "/api/brands/:brandId/ai/analyze-content",
    requireAuth,
    requireBrand(db),
    body(
      z.object({
        content: z.string().min(1),
        entityType: z.enum(["campaign", "template", "automation"]),
        entityId: z.string(),
        parentId: z.string().optional(),
      }),
    ),
    async (request, response) => {
      const ai = requireEnabledAi(
        db,
        config,
        routeParam(request, "brandId"),
      );
      if (!ai)
        return response
          .status(403)
          .json({ error: "AI features are disabled for this brand" });
      response.json(await analyzeContent(ai, request.body));
    },
  );
  app.post(
    "/api/brands/:brandId/campaigns/:campaignId/analyze",
    requireAuth,
    requireBrand(db),
    async (request, response) => {
      const ai = requireEnabledAi(
        db,
        config,
        routeParam(request, "brandId"),
      );
      if (!ai)
        return response
          .status(403)
          .json({ error: "AI features are disabled for this brand" });
      response.json(
        await analyzeReport(
          ai,
          routeParam(request, "campaignId"),
        ),
      );
    },
  );
  app.patch(
    "/api/brands/:brandId/ai/analyses/:analysisId",
    requireAuth,
    requireBrand(db),
    body(z.object({ is_open: z.boolean() })),
    (request, response) => {
      db.prepare(
        "UPDATE ai_analyses SET is_open=?,updated_at=? WHERE id=? AND brand_id=?",
      ).run(
        bool(request.body.is_open),
        nowIso(),
        routeParam(request, "analysisId"),
        routeParam(request, "brandId"),
      );
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM ai_analyses WHERE id=?")
            .get(routeParam(request, "analysisId")) as Record<string, unknown>,
        ),
      );
    },
  );

  app.patch("/api/settings/profile", requireAuth, body(z.object({
    name: z.string().min(1).optional(),
    email: z.email().optional(),
    language: z.enum(["en", "fr", "es", "ar"]).optional(),
    timezone: z.string().min(1).optional(),
    theme: z.enum(["system", "light", "dark"]).optional(),
    sidebar_shortcut: z.boolean().optional(),
  })), (request, response) => {
    if (!request.authUser)
      return response.status(403).json({ error: "A user session is required" });
    updateColumns(db, "users", request.authUser.id, request.body, [
      "name",
      "email",
      "language",
      "timezone",
      "theme",
      "sidebar_shortcut",
    ]);
    response.json(
      deserializeRow(
        db
          .prepare(
            "SELECT id,name,email,language,timezone,theme,sidebar_shortcut,totp_enabled,created_at,updated_at FROM users WHERE id=?",
          )
          .get(request.authUser.id) as Record<string, unknown>,
      ),
    );
  });
  app.patch(
    "/api/settings/workspaces/:workspaceId",
    requireAuth,
    body(
      z.object({
        name: z.string().min(1).optional(),
        company: z.string().min(1).optional(),
        default_timezone: z.string().min(1).optional(),
        default_language: z
          .enum(["en", "fr", "de", "es", "it", "nl", "ar"])
          .optional(),
        rows_per_page: z.number().int().min(10).max(100).optional(),
        strict_delete: z.boolean().optional(),
        api_enabled: z.boolean().optional(),
      }),
    ),
    (request, response) => {
      const workspaceId = routeParam(request, "workspaceId");
      if (
        !db
          .prepare("SELECT id FROM workspaces WHERE id=? AND owner_id=?")
          .get(workspaceId, request.authUser?.id)
      )
        return response.status(403).json({ error: "Workspace access denied" });
      updateColumns(db, "workspaces", workspaceId, request.body, [
        "name",
        "company",
        "default_timezone",
        "default_language",
        "rows_per_page",
        "strict_delete",
        "api_enabled",
      ]);
      response.json(
        deserializeRow(
          db
            .prepare("SELECT * FROM workspaces WHERE id=?")
            .get(workspaceId) as Record<string, unknown>,
        ),
      );
    },
  );
  app.post(
    "/api/settings/password",
    requireAuth,
    body(
      z.object({ current: z.string().min(8), password: z.string().min(12) }),
    ),
    async (request, response) => {
      const user = db
        .prepare("SELECT password_hash FROM users WHERE id=?")
        .get(request.authUser?.id) as { password_hash: string } | undefined;
      if (!user || !(await compare(request.body.current, user.password_hash)))
        return response
          .status(401)
          .json({ error: "Current password is incorrect" });
      db.prepare(
        "UPDATE users SET password_hash=?,updated_at=? WHERE id=?",
      ).run(
        await hash(request.body.password, 12),
        nowIso(),
        request.authUser?.id,
      );
      response.json({ ok: true });
    },
  );
  app.post("/api/settings/totp/setup", requireAuth, (_request, response) => {
    const secret = generateSecret();
    const recoveryCodes = Array.from(
      { length: 8 },
      () =>
        `${randomBytes(3).toString("hex")}-${randomBytes(3).toString("hex")}`,
    );
    const uri = generateURI({
      issuer: "Sendry",
      label: String(_request.authUser?.email),
      secret,
    });
    response.json({ secret, uri, recoveryCodes });
  });
  app.post(
    "/api/settings/totp/verify",
    requireAuth,
    body(
      z.object({
        secret: z.string().min(16),
        code: z.string().length(6),
        recoveryCodes: z.array(z.string()).length(8),
      }),
    ),
    async (request, response) => {
      const verification = await verifyTotp({
        secret: request.body.secret,
        token: request.body.code,
        epochTolerance: 30,
      });
      if (!verification.valid)
        return response
          .status(422)
          .json({ error: "The authenticator code is not valid" });
      const recoveryHashes = (request.body.recoveryCodes as string[]).map(
        (code: string) =>
          createHash("sha256").update(code.toLowerCase()).digest("hex"),
      );
      db.prepare(
        "UPDATE users SET totp_enabled=1,totp_secret=?,totp_recovery_codes=?,updated_at=? WHERE id=?",
      ).run(
        request.body.secret,
        JSON.stringify(recoveryHashes),
        nowIso(),
        request.authUser?.id,
      );
      response.json({ enabled: true });
    },
  );
  app.delete("/api/settings/totp", requireAuth, (request, response) => {
    db.prepare(
      "UPDATE users SET totp_enabled=0,totp_secret=NULL,totp_recovery_codes='[]',updated_at=? WHERE id=?",
    ).run(nowIso(), request.authUser?.id);
    response.status(204).end();
  });
  app.get("/api/settings/passkeys", requireAuth, (request, response) =>
    response.json(
      db
        .prepare(
          "SELECT id,name,transports,created_at FROM passkeys WHERE user_id=? ORDER BY created_at DESC",
        )
        .all(request.authUser?.id),
    ),
  );
  app.post(
    "/api/settings/passkeys/options",
    requireAuth,
    body(z.object({ name: z.string().min(1).max(80) })),
    async (request, response) => {
      if (!request.authUser)
        return response
          .status(403)
          .json({ error: "A user session is required" });
      const existing = db
        .prepare(
          "SELECT credential_id,transports FROM passkeys WHERE user_id=?",
        )
        .all(request.authUser.id) as Array<{
        credential_id: string;
        transports: string;
      }>;
      const options = await generateRegistrationOptions({
        rpName: "Sendry",
        rpID: new URL(config.appUrl).hostname,
        userName: request.authUser.email,
        userDisplayName: request.authUser.name,
        userID: new TextEncoder().encode(request.authUser.id),
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
        excludeCredentials: existing.map((item) => ({
          id: item.credential_id,
          transports: JSON.parse(item.transports),
        })),
      });
      const challengeId = id("chl");
      db.prepare(
        "DELETE FROM auth_challenges WHERE expires_at<=? OR (user_id=? AND kind='registration')",
      ).run(nowIso(), request.authUser.id);
      db.prepare(
        "INSERT INTO auth_challenges (id,user_id,kind,challenge,name,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        challengeId,
        request.authUser.id,
        "registration",
        options.challenge,
        request.body.name,
        new Date(Date.now() + 5 * 60000).toISOString(),
        nowIso(),
      );
      response.json({ challengeId, options });
    },
  );
  app.post(
    "/api/settings/passkeys/verify",
    requireAuth,
    body(
      z.object({
        challengeId: z.string(),
        response: z.record(z.string(), z.unknown()),
      }),
    ),
    async (request, response) => {
      if (!request.authUser)
        return response
          .status(403)
          .json({ error: "A user session is required" });
      const challenge = db
        .prepare(
          "SELECT * FROM auth_challenges WHERE id=? AND user_id=? AND kind='registration' AND expires_at>?",
        )
        .get(request.body.challengeId, request.authUser.id, nowIso()) as
        | { id: string; challenge: string; name: string }
        | undefined;
      if (!challenge)
        return response
          .status(400)
          .json({ error: "Passkey challenge expired" });
      const verification = await verifyRegistrationResponse({
        response: request.body.response as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.appUrl,
        expectedRPID: new URL(config.appUrl).hostname,
        requireUserVerification: true,
      });
      if (!verification.verified)
        return response
          .status(422)
          .json({ error: "Passkey registration failed" });
      const credential = verification.registrationInfo.credential;
      const transports =
        (
          request.body.response.response as
            | { transports?: string[] }
            | undefined
        )?.transports ??
        credential.transports ??
        [];
      const passkeyId = id("psk");
      db.prepare(
        "INSERT INTO passkeys (id,user_id,name,credential_id,public_key,counter,transports,created_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        passkeyId,
        request.authUser.id,
        challenge.name,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        JSON.stringify(transports),
        nowIso(),
      );
      db.prepare("DELETE FROM auth_challenges WHERE id=?").run(challenge.id);
      response
        .status(201)
        .json({
          id: passkeyId,
          name: challenge.name,
          transports,
          created_at: nowIso(),
        });
    },
  );
  app.delete(
    "/api/settings/passkeys/:passkeyId",
    requireAuth,
    (request, response) => {
      db.prepare("DELETE FROM passkeys WHERE id=? AND user_id=?").run(
        routeParam(request, "passkeyId"),
        request.authUser?.id,
      );
      response.status(204).end();
    },
  );
  app.post(
    "/api/settings/api-token",
    requireAuth,
    body(z.object({ workspace_id: z.string(), name: z.string().min(1) })),
    (request, response) => {
      const workspace = db
        .prepare("SELECT id FROM workspaces WHERE id=? AND owner_id=?")
        .get(request.body.workspace_id, request.authUser?.id);
      if (!workspace)
        return response.status(403).json({ error: "Workspace access denied" });
      const token = `snd_${randomBytes(24).toString("base64url")}`;
      db.prepare(
        "INSERT INTO api_tokens (id,workspace_id,name,token_prefix,token_hash,scopes,created_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        id("tok"),
        request.body.workspace_id,
        request.body.name,
        token.slice(0, 10),
        tokenHash(token),
        JSON.stringify(["*"]),
        nowIso(),
      );
      response.status(201).json({ token });
    },
  );
  app.get("/api/settings/api-tokens", requireAuth, (request, response) =>
    response.json(
      db
        .prepare(
          `SELECT t.id,t.name,t.token_prefix,t.last_used_at,t.created_at FROM api_tokens t JOIN workspaces w ON w.id=t.workspace_id WHERE w.owner_id=? ORDER BY t.created_at DESC`,
        )
        .all(request.authUser?.id),
    ),
  );
  app.delete(
    "/api/settings/api-tokens/:tokenId",
    requireAuth,
    (request, response) => {
      db.prepare(
        `DELETE FROM api_tokens WHERE id=? AND workspace_id IN (SELECT id FROM workspaces WHERE owner_id=?)`,
      ).run(routeParam(request, "tokenId"), request.authUser?.id);
      response.status(204).end();
    },
  );
  app.get("/api/settings/jobs", requireAuth, (request, response) =>
    response.json(
      deserializeRows(
        db
          .prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200")
          .all() as Record<string, unknown>[],
      ),
    ),
  );

  app.use("/api/v1", requireAuth, (request, response, next) => {
    if (request.authKind !== "api") return next();
    const workspace = db
      .prepare("SELECT api_enabled FROM workspaces WHERE id=?")
      .get(request.apiWorkspaceId) as { api_enabled: number } | undefined;
    return workspace?.api_enabled
      ? next()
      : response
          .status(403)
          .json({ error: "Public API access is disabled for this workspace" });
  });
  app.get("/api/v1/brands", requireAuth, (request, response) => {
    const rows =
      request.authKind === "api"
        ? db
            .prepare(
              "SELECT id,name,from_name,from_email,reply_to,provider FROM brands WHERE workspace_id=?",
            )
            .all(request.apiWorkspaceId)
        : db
            .prepare(
              `SELECT b.id,b.name,b.from_name,b.from_email,b.reply_to,b.provider FROM brands b JOIN brand_members bm ON bm.brand_id=b.id WHERE bm.user_id=?`,
            )
            .all(request.authUser?.id);
    response.json(rows);
  });
  app.get(
    "/api/v1/brands/:brandId/lists",
    requireAuth,
    requireBrand(db),
    (request, response) =>
      response.json(
        db
          .prepare(
            "SELECT id,name,opt_in,hidden FROM lists WHERE brand_id=? AND (?=1 OR hidden=0)",
          )
          .all(
            routeParam(request, "brandId"),
            request.query.include_hidden === "1" ? 1 : 0,
          ),
      ),
  );
  app.post(
    "/api/v1/lists/:listId/subscribers",
    requireAuth,
    body(subscriberSchema),
    (request, response) => {
      const listId = routeParam(request, "listId");
      if (!listAccess(db, request, listId))
        return response.status(403).json({ error: "Audience access denied" });
      const brand = db
        .prepare("SELECT brand_id FROM lists WHERE id=?")
        .get(listId) as { brand_id: string };
      const blocked = db
        .prepare(
          `SELECT 1 FROM suppressions WHERE brand_id=? AND email=? COLLATE NOCASE UNION SELECT 1 FROM blocked_domains WHERE brand_id=? AND domain=? COLLATE NOCASE`,
        )
        .get(
          brand.brand_id,
          request.body.email,
          brand.brand_id,
          request.body.email.split("@")[1],
        );
      if (blocked)
        return response
          .status(409)
          .json({ error: "This address is blocked for the brand" });
      const subscriberId = id("sub");
      db.prepare(
        `INSERT INTO subscribers (id,list_id,name,email,status,custom_values,notes,source,consent,consent_at,joined_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(list_id,email) DO UPDATE SET name=excluded.name,status=excluded.status,custom_values=excluded.custom_values,notes=excluded.notes,consent=excluded.consent,consent_at=excluded.consent_at,updated_at=excluded.updated_at`,
      ).run(
        subscriberId,
        listId,
        request.body.name,
        request.body.email,
        request.body.status,
        JSON.stringify(request.body.custom_values),
        request.body.notes,
        "api",
        bool(request.body.consent),
        request.body.consent ? nowIso() : null,
        nowIso(),
        nowIso(),
      );
      const subscriber = deserializeRow(
        db
          .prepare(
            "SELECT * FROM subscribers WHERE list_id=? AND email=? COLLATE NOCASE",
          )
          .get(listId, request.body.email) as Record<string, unknown>,
      );
      if (subscriber) scheduleSubscriberAutomations(db, String(subscriber.id));
      response.status(201).json(subscriber);
    },
  );
  app.get(
    "/api/v1/lists/:listId/subscribers/count",
    requireAuth,
    (request, response) => {
      if (!listAccess(db, request, routeParam(request, "listId")))
        return response.status(403).json({ error: "Audience access denied" });
      response.json(
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM subscribers WHERE list_id=? AND status='active'`,
          )
          .get(routeParam(request, "listId")),
      );
    },
  );
  app.get(
    "/api/v1/lists/:listId/subscribers/status",
    requireAuth,
    (request, response) => {
      if (!listAccess(db, request, routeParam(request, "listId")))
        return response.status(403).json({ error: "Audience access denied" });
      response.json(
        db
          .prepare(
            "SELECT status FROM subscribers WHERE list_id=? AND email=? COLLATE NOCASE",
          )
          .get(routeParam(request, "listId"), request.query.email) ?? {
          status: "not_found",
        },
      );
    },
  );
  app.delete(
    "/api/v1/lists/:listId/subscribers",
    requireAuth,
    (request, response) => {
      if (!listAccess(db, request, routeParam(request, "listId")))
        return response.status(403).json({ error: "Audience access denied" });
      db.prepare(
        "DELETE FROM subscribers WHERE list_id=? AND email=? COLLATE NOCASE",
      ).run(routeParam(request, "listId"), request.query.email);
      response.status(204).end();
    },
  );
  app.post(
    "/api/v1/brands/:brandId/campaigns",
    requireAuth,
    requireBrand(db),
    body(campaignSchema),
    (request, response) => {
      const campaignId = id("cmp");
      const { targets, ...campaign } = request.body;
      if (
        !campaignTargetsBelongToBrand(
          db,
          routeParam(request, "brandId"),
          targets,
        )
      )
        return response
          .status(422)
          .json({ error: "Every campaign target must belong to this brand" });
      db.prepare(
        `INSERT INTO campaigns (id,brand_id,label,subject,from_name,from_email,reply_to,plain_text,html_text,editor_mode,editor_data,attachments,query_string,web_language,opens_tracking,clicks_tracking,check_links,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        campaignId,
        routeParam(request, "brandId"),
        campaign.label,
        campaign.subject,
        campaign.from_name,
        campaign.from_email,
        campaign.reply_to,
        campaign.plain_text,
        sanitizeEmailHtml(campaign.html_text),
        campaign.editor_mode,
        JSON.stringify(campaign.editor_data),
        JSON.stringify(campaign.attachments),
        campaign.query_string,
        campaign.web_language,
        campaign.opens_tracking,
        campaign.clicks_tracking,
        bool(campaign.check_links),
        nowIso(),
        nowIso(),
      );
      for (const target of targets)
        db.prepare(
          "INSERT INTO campaign_targets (id,campaign_id,kind,target_id,mode) VALUES (?,?,?,?,?)",
        ).run(
          id("tgt"),
          campaignId,
          target.kind,
          target.target_id,
          target.mode,
        );
      response
        .status(201)
        .json(
          deserializeRow(
            db
              .prepare("SELECT * FROM campaigns WHERE id=?")
              .get(campaignId) as Record<string, unknown>,
          ),
        );
    },
  );
  app.get(
    "/api/v1/brands/:brandId/campaigns/:campaignId",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const campaign = deserializeRow(
        db
          .prepare("SELECT * FROM campaigns WHERE id=? AND brand_id=?")
          .get(
            routeParam(request, "campaignId"),
            routeParam(request, "brandId"),
          ) as Record<string, unknown>,
      );
      if (campaign) response.json(campaign);
      else response.status(404).json({ error: "Campaign not found" });
    },
  );
  app.post(
    "/api/v1/brands/:brandId/campaigns/:campaignId/send",
    requireAuth,
    requireBrand(db),
    async (request, response) => {
      const campaignId = routeParam(request, "campaignId");
      const quote = campaignQuote(db, campaignId);
      if (!quote)
        return response.status(404).json({ error: "Campaign not found" });
      const recipients = quote.recipients;
      const campaign = db
        .prepare("SELECT * FROM campaigns WHERE id=? AND brand_id=?")
        .get(campaignId, routeParam(request, "brandId")) as Record<
        string,
        unknown
      >;
      const linkIssues = await campaignLinkIssues(campaign);
      if (linkIssues.length)
        return response
          .status(422)
          .json({ error: "Broken links were found", issues: linkIssues });
      if (!recipients)
        return response
          .status(409)
          .json({
            error: "Choose at least one audience with active subscribers",
          });
      if (quote.remaining !== null && recipients > quote.remaining)
        return response
          .status(409)
          .json({
            error: `Monthly allowance has ${quote.remaining} messages remaining`,
          });
      if (
        quote.amount > 0 &&
        !db
          .prepare(
            "SELECT id FROM payments WHERE campaign_id=? AND status='completed' AND amount>=? ORDER BY created_at DESC LIMIT 1",
          )
          .get(campaignId, quote.amount)
      )
        return response
          .status(402)
          .json({ error: "Campaign payment is required", quote });
      db.prepare(
        "UPDATE campaigns SET status='queued',total_recipients=?,updated_at=? WHERE id=? AND brand_id=?",
      ).run(recipients, nowIso(), campaignId, routeParam(request, "brandId"));
      response
        .status(202)
        .json({
          jobId: enqueueJob(db, "campaign.send", { campaignId }),
          recipients,
        });
    },
  );

  app.get("/public/form/:listId", (request, response) => {
    const list = db
      .prepare(
        "SELECT l.*,b.name AS brand_name,b.logo_path,b.recaptcha_site_key FROM lists l JOIN brands b ON b.id=l.brand_id WHERE l.id=?",
      )
      .get(routeParam(request, "listId")) as
      | Record<string, unknown>
      | undefined;
    if (!list) return response.status(404).send("Form not found");
    const visibleFields = new Set(
      JSON.parse(String(list.form_fields ?? '["name","email"]')) as string[],
    );
    const fields = (
      db
        .prepare(
          "SELECT * FROM custom_fields WHERE list_id=? ORDER BY position",
        )
        .all(routeParam(request, "listId")) as Array<{
        name: string;
        type: string;
      }>
    ).filter((field) => visibleFields.has(field.name.toLowerCase()));
    const token = signToken(
      { listId: routeParam(request, "listId"), brandId: list.brand_id },
      config.sessionSecret,
      365 * 86400,
    );
    const logo = list.logo_path
      ? `<img src="${escapeHtml(String(list.logo_path))}" alt="${escapeHtml(String(list.brand_name))}" style="display:block;max-width:180px;max-height:72px;margin-bottom:28px">`
      : "";
    response
      .type("html")
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(String(list.brand_name))} subscription</title>${list.recaptcha_site_key ? `<script src="https://www.google.com/recaptcha/api.js" async defer></script>` : ""}<style>body{font:16px system-ui;background:#f6f6f3;color:#17191f;margin:0}.card{max-width:520px;margin:7vh auto;background:white;border:1px solid #ddd;padding:32px}label{display:block;margin:16px 0 6px}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #bbb}button{margin-top:22px;background:#1458e6;color:#fff;border:0;padding:12px 18px}</style></head><body><main class="card">${logo}<h1>${escapeHtml(String(list.name))}</h1><form method="post" action="/public/subscribe"><input type="hidden" name="t" value="${token}">${visibleFields.has("name") ? `<label>Name</label><input name="name" autocomplete="name">` : ""}<label>Email</label><input name="email" type="email" required autocomplete="email">${fields.map((field) => `<label>${escapeHtml(field.name)}</label><input name="field_${escapeHtml(field.name)}" type="${field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}">`).join("")}${list.consent_enabled ? `<label><input style="width:auto" type="checkbox" name="consent" value="1" required> ${escapeHtml(String(list.marketing_permission))}</label><p>${escapeHtml(String(list.what_to_expect))}</p>` : ""}${list.recaptcha_site_key ? `<div class="g-recaptcha" data-sitekey="${escapeHtml(String(list.recaptcha_site_key))}"></div>` : ""}<button type="submit">Subscribe</button></form></main></body></html>`,
      );
  });
  app.post("/public/subscribe", async (request, response) => {
    const token = verifyToken<{ listId: string; brandId: string }>(
      String(request.body.t ?? ""),
      config.sessionSecret,
    );
    if (!token || !z.email().safeParse(request.body.email).success)
      return response.status(400).send("Invalid subscription request");
    const list = db
      .prepare(
        "SELECT l.*,b.recaptcha_secret_key,b.custom_domain,b.custom_domain_protocol,b.custom_domain_enabled FROM lists l JOIN brands b ON b.id=l.brand_id WHERE l.id=? AND l.brand_id=?",
      )
      .get(token.listId, token.brandId) as Record<string, unknown> | undefined;
    if (!list) return response.status(404).send("List not found");
    if (
      list.recaptcha_secret_key &&
      !(await verifyRecaptcha(
        String(list.recaptcha_secret_key),
        String(request.body["g-recaptcha-response"] ?? ""),
        request.ip,
      ))
    )
      return response.status(422).send("Bot verification failed");
    if (list.consent_enabled && request.body.consent !== "1")
      return response.redirect(
        String(list.no_consent_url || `/public/result?status=consent`),
      );
    const email = String(request.body.email).toLowerCase();
    const domain = email.split("@")[1];
    const blocked = db
      .prepare(
        "SELECT 1 FROM suppressions WHERE brand_id=? AND email=? COLLATE NOCASE UNION SELECT 1 FROM blocked_domains WHERE brand_id=? AND domain=? COLLATE NOCASE",
      )
      .get(token.brandId, email, token.brandId, domain);
    if (blocked)
      return response.status(409).send("This address cannot be subscribed");
    const existing = db
      .prepare(
        "SELECT * FROM subscribers WHERE list_id=? AND email=? COLLATE NOCASE",
      )
      .get(token.listId, email) as Record<string, unknown> | undefined;
    if (existing && existing.status === "active")
      return response.redirect(
        String(list.already_subscribed_url || "/public/result?status=already"),
      );
    if (
      existing &&
      ["unsubscribed", "bounced", "complaint"].includes(
        String(existing.status),
      ) &&
      list.reconsent_url
    )
      return response.redirect(String(list.reconsent_url));
    const subscriberId = existing ? String(existing.id) : id("sub");
    const confirmation = randomBytes(24).toString("base64url");
    const custom = Object.fromEntries(
      Object.entries(request.body)
        .filter(([key]) => key.startsWith("field_"))
        .map(([key, value]) => [key.slice(6), value]),
    );
    const status = list.opt_in === "double" ? "unconfirmed" : "active";
    db.prepare(
      `INSERT INTO subscribers (id,list_id,name,email,status,custom_values,source,ip,referrer,consent,consent_at,confirmation_token,confirmed_at,joined_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(list_id,email) DO UPDATE SET name=excluded.name,status=excluded.status,custom_values=excluded.custom_values,source=excluded.source,ip=excluded.ip,referrer=excluded.referrer,consent=excluded.consent,consent_at=excluded.consent_at,confirmation_token=excluded.confirmation_token,updated_at=excluded.updated_at`,
    ).run(
      subscriberId,
      token.listId,
      request.body.name ?? "",
      email,
      status,
      JSON.stringify(custom),
      "web_form",
      request.ip,
      request.get("referer") ?? "",
      bool(request.body.consent),
      request.body.consent ? nowIso() : null,
      tokenHash(confirmation),
      status === "active" ? nowIso() : null,
      nowIso(),
      nowIso(),
    );
    const recipient = { name: String(request.body.name ?? ""), email };
    if (status === "active") {
      scheduleSubscriberAutomations(db, subscriberId);
      enqueueJob(db, "rules.trigger", {
        brandId: token.brandId,
        trigger: "subscribe",
        subscriberId,
        listId: token.listId,
      });
      await sendLifecycleEmail(config, db, list, recipient, "thank_you");
    } else {
      const confirmationLink = `${publicBrandUrl(config, list)}/public/confirm?t=${encodeURIComponent(confirmation)}`;
      await sendLifecycleEmail(
        config,
        db,
        list,
        recipient,
        "confirmation",
        confirmationLink,
      );
    }
    response.redirect(
      String(
        list.subscribe_url ||
          `/public/result?status=${status === "active" ? "subscribed" : "confirm"}`,
      ),
    );
  });
  app.get("/public/confirm", async (request, response) => {
    const subscriber = db
      .prepare(
        `SELECT s.*,l.confirm_url,l.brand_id,l.thank_you_enabled,l.thank_you_subject,l.thank_you_html
      FROM subscribers s JOIN lists l ON l.id=s.list_id WHERE s.confirmation_token=? AND s.status='unconfirmed'`,
      )
      .get(tokenHash(String(request.query.t ?? ""))) as
      | Record<string, unknown>
      | undefined;
    if (!subscriber)
      return response
        .status(400)
        .send("Confirmation link is invalid or expired");
    db.prepare(
      `UPDATE subscribers SET status='active',confirmed_at=?,confirmation_token=NULL,updated_at=? WHERE id=?`,
    ).run(nowIso(), nowIso(), subscriber.id);
    scheduleSubscriberAutomations(db, String(subscriber.id));
    enqueueJob(db, "rules.trigger", {
      brandId: subscriber.brand_id,
      trigger: "subscribe",
      subscriberId: subscriber.id,
      listId: subscriber.list_id,
    });
    await sendLifecycleEmail(
      config,
      db,
      subscriber,
      { name: String(subscriber.name), email: String(subscriber.email) },
      "thank_you",
    );
    response.redirect(
      String(subscriber.confirm_url || "/public/result?status=confirmed"),
    );
  });
  app.all("/public/unsubscribe", async (request, response) => {
    const token = verifyToken<{
      subscriberId: string;
      listId: string;
      brandId: string;
    }>(String(request.query.t ?? request.body.t ?? ""), config.sessionSecret);
    if (!token)
      return response
        .status(400)
        .send("Unsubscribe link is invalid or expired");
    const list = db
      .prepare("SELECT * FROM lists WHERE id=?")
      .get(token.listId) as Record<string, unknown> | undefined;
    if (!list) return response.status(404).send("List not found");
    const subscriber = db
      .prepare("SELECT email FROM subscribers WHERE id=? AND list_id=?")
      .get(token.subscriberId, token.listId) as { email: string } | undefined;
    if (!subscriber) return response.status(404).send("Subscriber not found");
    if (
      list.unsubscribe_confirmation &&
      request.method === "GET" &&
      request.query.confirm !== "1"
    )
      return response
        .type("html")
        .send(
          `<main style="max-width:520px;margin:10vh auto;font:16px system-ui"><h1>Confirm unsubscribe</h1><p>Stop receiving ${escapeHtml(String(list.name))}?</p><a href="/public/unsubscribe?t=${encodeURIComponent(String(request.query.t))}&confirm=1">Yes, unsubscribe me</a></main>`,
        );
    if (list.unsubscribe_scope === "brand")
      db.prepare(
        `UPDATE subscribers SET status='unsubscribed',updated_at=? WHERE email=? COLLATE NOCASE AND list_id IN (SELECT id FROM lists WHERE brand_id=?)`,
      ).run(nowIso(), subscriber.email, token.brandId);
    else
      db.prepare(
        `UPDATE subscribers SET status='unsubscribed',updated_at=? WHERE id=?`,
      ).run(nowIso(), token.subscriberId);
    db.prepare(
      "INSERT INTO preference_events (id,brand_id,list_id,email,action,ip,user_agent,occurred_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      id("pre"),
      token.brandId,
      token.listId,
      subscriber.email,
      "unsubscribed",
      request.ip,
      request.headers["user-agent"] ?? "",
      nowIso(),
    );
    enqueueJob(db, "rules.trigger", {
      brandId: token.brandId,
      trigger: "unsubscribe",
      subscriberId: token.subscriberId,
      listId: token.listId,
    });
    await sendLifecycleEmail(
      config,
      db,
      list,
      { email: subscriber.email },
      "goodbye",
    );
    response.redirect(
      String(list.unsubscribe_url || "/public/result?status=unsubscribed"),
    );
  });
  app.get("/public/preferences", (request, response) => {
    const token = verifyToken<{ subscriberId: string; brandId: string }>(
      String(request.query.t ?? ""),
      config.sessionSecret,
    );
    if (!token)
      return response.status(400).send("Preference link is invalid or expired");
    const subscriber = db
      .prepare("SELECT email,name FROM subscribers WHERE id=?")
      .get(token.subscriberId) as { email: string; name: string } | undefined;
    if (!subscriber) return response.status(404).send("Subscriber not found");
    const lists = db
      .prepare(
        `SELECT l.*,s.status FROM lists l LEFT JOIN subscribers s ON s.list_id=l.id AND s.email=? COLLATE NOCASE WHERE l.brand_id=? AND l.preference_visible=1 AND l.hidden=0 ORDER BY l.preference_sort,l.name`,
      )
      .all(subscriber.email, token.brandId) as Record<string, unknown>[];
    response
      .type("html")
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Email preferences</title><style>body{font:16px system-ui;background:#f6f6f3;color:#17191f}.card{max-width:600px;margin:7vh auto;background:white;border:1px solid #ddd;padding:32px}.topic{display:grid;grid-template-columns:24px 1fr;padding:18px 0;border-top:1px solid #eee}.topic small{grid-column:2;color:#667085}button{background:#1458e6;color:#fff;border:0;padding:12px 18px}</style></head><body><main class="card"><h1>Manage subscription</h1><p>${escapeHtml(subscriber.email)}</p><form method="post" action="/public/preferences"><input type="hidden" name="t" value="${escapeHtml(String(request.query.t))}">${lists.map((list) => `<label class="topic"><input type="checkbox" name="lists" value="${list.id}" ${list.status === "active" ? "checked" : ""}><strong>${escapeHtml(String(list.preference_name || list.name))}</strong><small>${escapeHtml(String(list.preference_description || ""))}</small></label>`).join("")}<label class="topic"><input type="checkbox" name="unsubscribe_all" value="1"><strong>Unsubscribe me from all emails</strong></label><button type="submit">Update subscription</button></form></main></body></html>`,
      );
  });
  app.post("/public/preferences", (request, response) => {
    const token = verifyToken<{ subscriberId: string; brandId: string }>(
      String(request.body.t ?? ""),
      config.sessionSecret,
    );
    if (!token)
      return response.status(400).send("Preference link is invalid or expired");
    const subscriber = db
      .prepare("SELECT email,name FROM subscribers WHERE id=?")
      .get(token.subscriberId) as { email: string; name: string } | undefined;
    if (!subscriber) return response.status(404).send("Subscriber not found");
    const selected = new Set(
      Array.isArray(request.body.lists)
        ? request.body.lists
        : request.body.lists
          ? [request.body.lists]
          : [],
    );
    const lists = db
      .prepare("SELECT id FROM lists WHERE brand_id=? AND preference_visible=1")
      .all(token.brandId) as Array<{ id: string }>;
    for (const list of lists) {
      const status = request.body.unsubscribe_all
        ? "unsubscribed"
        : selected.has(list.id)
          ? "active"
          : "unsubscribed";
      db.prepare(
        `INSERT INTO subscribers (id,list_id,name,email,status,source,consent,consent_at,confirmed_at,joined_at,updated_at) VALUES (?,?,?,?,?,'preferences',1,?,?,?,?) ON CONFLICT(list_id,email) DO UPDATE SET status=excluded.status,consent=1,consent_at=excluded.consent_at,updated_at=excluded.updated_at`,
      ).run(
        id("sub"),
        list.id,
        subscriber.name,
        subscriber.email,
        status,
        nowIso(),
        nowIso(),
        nowIso(),
        nowIso(),
      );
      db.prepare(
        "INSERT INTO preference_events (id,brand_id,list_id,email,action,ip,user_agent,occurred_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        id("pre"),
        token.brandId,
        list.id,
        subscriber.email,
        status === "active" ? "subscribed" : "unsubscribed",
        request.ip,
        request.headers["user-agent"] ?? "",
        nowIso(),
      );
    }
    response
      .type("html")
      .send(
        '<main style="max-width:520px;margin:10vh auto;font:16px system-ui"><h1>Preferences saved</h1><p>Your email choices have been updated.</p></main>',
      );
  });
  app.get("/public/result", (request, response) =>
    response
      .type("html")
      .send(
        `<main style="max-width:520px;margin:10vh auto;font:16px system-ui"><h1>${({ subscribed: "You are subscribed", confirm: "Check your email", confirmed: "Subscription confirmed", already: "Already subscribed", unsubscribed: "You are unsubscribed", consent: "Consent is required" } as Record<string, string>)[String(request.query.status)] ?? "Request complete"}</h1><p>You can close this page.</p></main>`,
      ),
  );
  app.get("/public/campaign/:campaignId", (request, response) => {
    const campaign = db
      .prepare(
        `SELECT subject,html_text FROM campaigns WHERE id=? AND status='sent'`,
      )
      .get(routeParam(request, "campaignId")) as
      | { subject: string; html_text: string }
      | undefined;
    if (!campaign) return response.status(404).end();
    response
      .type("html")
      .send(
        `<!doctype html><title>${escapeHtml(campaign.subject)}</title>${campaign.html_text}`,
      );
  });

  const pixel = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64");
  app.get("/track/open/:token.gif", (request, response) => {
    const token = verifyToken<{
      campaignId: string;
      subscriberId?: string;
      anonymous?: boolean;
      brandId: string;
    }>(routeParam(request, "token"), config.sessionSecret);
    if (token)
      db.prepare(
        "INSERT INTO campaign_events (id,campaign_id,subscriber_id,type,country,user_agent,ip,occurred_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        id("evt"),
        token.campaignId,
        token.anonymous ? null : (token.subscriberId ?? null),
        "open",
        String(request.headers["cf-ipcountry"] ?? ""),
        request.headers["user-agent"] ?? "",
        request.ip,
        nowIso(),
      );
    response
      .set({ "content-type": "image/gif", "cache-control": "no-store" })
      .send(pixel);
  });
  app.get("/track/click/:token", (request, response) => {
    const token = verifyToken<{
      campaignId: string;
      subscriberId?: string;
      anonymous?: boolean;
      url: string;
    }>(routeParam(request, "token"), config.sessionSecret);
    if (!token || !z.url().safeParse(token.url).success)
      return response.status(400).send("Invalid tracking link");
    db.prepare(
      "INSERT INTO campaign_events (id,campaign_id,subscriber_id,type,link_url,country,user_agent,ip,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      id("evt"),
      token.campaignId,
      token.anonymous ? null : (token.subscriberId ?? null),
      "click",
      token.url,
      String(request.headers["cf-ipcountry"] ?? ""),
      request.headers["user-agent"] ?? "",
      request.ip,
      nowIso(),
    );
    response.redirect(token.url);
  });
  app.get("/track/automation/open/:token.gif", (request, response) => {
    const token = verifyToken<{
      stepId: string;
      deliveryId?: string;
      subscriberId?: string;
      anonymous?: boolean;
    }>(routeParam(request, "token"), config.sessionSecret);
    if (token)
      db.prepare(
        "INSERT INTO automation_events (id,step_id,delivery_id,subscriber_id,type,country,user_agent,ip,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        id("aev"),
        token.stepId,
        token.deliveryId ?? null,
        token.anonymous ? null : (token.subscriberId ?? null),
        "open",
        String(request.headers["cf-ipcountry"] ?? ""),
        request.headers["user-agent"] ?? "",
        request.ip,
        nowIso(),
      );
    response
      .set({ "content-type": "image/gif", "cache-control": "no-store" })
      .send(pixel);
  });
  app.get("/track/automation/click/:token", (request, response) => {
    const token = verifyToken<{
      stepId: string;
      deliveryId?: string;
      subscriberId?: string;
      anonymous?: boolean;
      url: string;
    }>(routeParam(request, "token"), config.sessionSecret);
    if (!token || !z.url().safeParse(token.url).success)
      return response.status(400).send("Invalid tracking link");
    db.prepare(
      "INSERT INTO automation_events (id,step_id,delivery_id,subscriber_id,type,link_url,country,user_agent,ip,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id("aev"),
      token.stepId,
      token.deliveryId ?? null,
      token.anonymous ? null : (token.subscriberId ?? null),
      "click",
      token.url,
      String(request.headers["cf-ipcountry"] ?? ""),
      request.headers["user-agent"] ?? "",
      request.ip,
      nowIso(),
    );
    response.redirect(token.url);
  });
  app.post("/api/provider-events/:provider", (request, response) => {
    if (
      config.providerEventSecret &&
      request.headers["x-provider-event-secret"] !== config.providerEventSecret
    )
      return response
        .status(401)
        .json({ error: "Provider event authentication failed" });
    const externalId = String(
      request.body.id ??
        request.body.mail?.messageId ??
        createHash("sha256").update(JSON.stringify(request.body)).digest("hex"),
    );
    const eventType = String(
      request.body.type ??
        request.body.notificationType ??
        request.body.eventType ??
        "unknown",
    ).toLowerCase();
    const email = String(
      request.body.email ?? request.body.mail?.destination?.[0] ?? "",
    );
    const campaignId = String(
      request.body.campaignId ?? request.headers["x-sendry-campaign"] ?? "",
    );
    const subscriberId = String(
      request.body.subscriberId ?? request.headers["x-sendry-subscriber"] ?? "",
    );
    const campaign = campaignId
      ? (db
          .prepare("SELECT brand_id FROM campaigns WHERE id=?")
          .get(campaignId) as { brand_id: string } | undefined)
      : undefined;
    db.prepare(
      "INSERT OR IGNORE INTO provider_events (id,brand_id,provider,external_id,event_type,email,payload,received_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      id("pev"),
      campaign?.brand_id ?? null,
      routeParam(request, "provider"),
      externalId,
      eventType,
      email,
      JSON.stringify(request.body),
      nowIso(),
    );
    const normalized = eventType.includes("complaint")
      ? "complaint"
      : eventType.includes("bounce")
        ? "bounce"
        : eventType.includes("delivery")
          ? "delivered"
          : null;
    if (normalized && subscriberId && campaignId) {
      db.prepare(
        "INSERT INTO campaign_events (id,campaign_id,subscriber_id,type,occurred_at,metadata) VALUES (?,?,?,?,?,?)",
      ).run(
        id("evt"),
        campaignId,
        subscriberId,
        normalized,
        nowIso(),
        JSON.stringify({
          provider: routeParam(request, "provider"),
          externalId,
        }),
      );
      if (normalized === "bounce" || normalized === "complaint")
        db.prepare(
          "UPDATE subscribers SET status=?,updated_at=? WHERE id=?",
        ).run(
          normalized === "bounce" ? "bounced" : "complaint",
          nowIso(),
          subscriberId,
        );
    }
    response.status(202).json({ accepted: true });
  });

  app.get(
    "/api/brands/:brandId/rss",
    requireAuth,
    requireBrand(db),
    (request, response) => {
      const brand = db
        .prepare("SELECT name,rss_enabled FROM brands WHERE id=?")
        .get(routeParam(request, "brandId")) as {
        name: string;
        rss_enabled: number;
      };
      if (!brand.rss_enabled)
        return response
          .status(404)
          .json({ error: "RSS is disabled for this brand" });
      const campaigns = db
        .prepare(
          `SELECT id,subject,html_text,sent_at FROM campaigns WHERE brand_id=? AND status='sent' ORDER BY sent_at DESC LIMIT 100`,
        )
        .all(routeParam(request, "brandId")) as Array<{
        id: string;
        subject: string;
        html_text: string;
        sent_at: string;
      }>;
      response
        .type("application/rss+xml")
        .send(
          `<?xml version="1.0"?><rss version="2.0"><channel><title>${escapeHtml(brand.name)}</title><link>${config.appUrl}</link>${campaigns.map((campaign) => `<item><title>${escapeHtml(campaign.subject)}</title><link>${config.appUrl}/public/campaign/${campaign.id}</link><pubDate>${new Date(campaign.sent_at).toUTCString()}</pubDate><description><![CDATA[${campaign.html_text}]]></description></item>`).join("")}</channel></rss>`,
        );
    },
  );

  const webRoot = resolve("dist");
  if (
    process.env.NODE_ENV === "production" &&
    existsSync(join(webRoot, "index.html"))
  ) {
    app.use(express.static(webRoot, { index: false, maxAge: "1d" }));
    app.use((request, response, next) =>
      request.accepts("html") &&
      !request.path.startsWith("/api/") &&
      !request.path.startsWith("/public/") &&
      !request.path.startsWith("/track/")
        ? response.sendFile(join(webRoot, "index.html"))
        : next(),
    );
  }

  let stopWorker: (() => void) | undefined;
  let stopMultiChannelWorker: (() => void) | undefined;
  if (options.worker !== false) {
    stopWorker = startWorker(db, config, multiChannel);
    stopMultiChannelWorker = multiChannel.startWorkers();
  }
  app.locals.db = db;
  app.locals.config = config;
  app.locals.stopWorker = stopWorker;
  app.locals.stopMultiChannelWorker = stopMultiChannelWorker;
  app.locals.multiChannel = multiChannel;

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const message =
        error instanceof Error ? error.message : "Unexpected server error";
      if (process.env.NODE_ENV !== "test") console.error(error);
      response.status(500).json({ error: message });
    },
  );
  return app;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] ?? character,
  );
}

const emailStyleProperties = [
  "-ms-text-size-adjust",
  "-webkit-text-size-adjust",
  "background",
  "background-color",
  "border",
  "border-bottom",
  "border-left",
  "border-radius",
  "border-right",
  "border-top",
  "box-sizing",
  "color",
  "display",
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "height",
  "letter-spacing",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "object-fit",
  "opacity",
  "outline",
  "overflow",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "text-size-adjust",
  "vertical-align",
  "width",
] as const;

const emailStylePropertySet = new Set<string>(emailStyleProperties);
const safeInlineStyleValue = /^(?![\s\S]*(?:url\s*\(|expression\s*\(|javascript\s*:|data\s*:|-moz-binding|behavior\s*:))[\s\S]*$/i;
const allowedEmailStyles = Object.fromEntries(
  emailStyleProperties.map((property) => [property, [safeInlineStyleValue]]),
);

function sanitizeEmailCss(value: string) {
  if (!value.trim() || value.length > 20_000) return "";
  const css = value.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (/(?:@(?:import|charset|namespace|supports|document|font-face|keyframes)|url\s*\(|expression\s*\(|javascript\s*:|data\s*:|-moz-binding|behavior\s*:|<)/i.test(css)) return "";
  const atRules = css.match(/@[a-z-]+/gi) ?? [];
  if (atRules.some((rule) => rule.toLowerCase() !== "@media")) return "";
  let depth = 0;
  for (const character of css) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) return "";
  }
  if (depth !== 0) return "";
  const properties = [...css.matchAll(/(?:^|[;{])\s*(-?[a-z][\w-]*)\s*:/gi)].map((match) => match[1].toLowerCase());
  if (!properties.length || properties.some((property) => !emailStylePropertySet.has(property))) return "";
  return css;
}

function sanitizeEmailHtml(value: string) {
  const safeStyles: string[] = [];
  const withoutStyleTags = value.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_match, css: string) => {
    const safeCss = sanitizeEmailCss(css);
    if (safeCss) safeStyles.push(safeCss);
    return "";
  });
  const sanitized = sanitizeHtml(withoutStyleTags, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "html",
      "head",
      "body",
      "meta",
      "img",
    ],
    allowedAttributes: {
      "*": [
        "class",
        "id",
        "title",
        "style",
        "role",
        "aria-label",
        "aria-hidden",
      ],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      meta: ["name", "content", "charset"],
      table: [
        "width",
        "height",
        "border",
        "cellpadding",
        "cellspacing",
        "align",
        "bgcolor",
      ],
      td: [
        "width",
        "height",
        "colspan",
        "rowspan",
        "align",
        "valign",
        "bgcolor",
      ],
      th: [
        "width",
        "height",
        "colspan",
        "rowspan",
        "align",
        "valign",
        "bgcolor",
      ],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "cid"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    allowProtocolRelative: false,
    allowedStyles: { "*": allowedEmailStyles },
  });
  if (!safeStyles.length) return sanitized;
  const styleTags = safeStyles.map((css) => `<style>${css}</style>`).join("");
  return /<\/head\s*>/i.test(sanitized)
    ? sanitized.replace(/<\/head\s*>/i, `${styleTags}</head>`)
    : `${styleTags}${sanitized}`;
}
