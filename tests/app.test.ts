import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import type { Express } from "express";
import { createApp } from "../server/app";
import { openDatabase, seedDatabase, type AppDatabase } from "../server/db";
import {
  effectiveTracking,
  processNextJob,
  resetMonthlyUsage,
  scheduleDueWork,
} from "../server/worker";
import { signToken } from "../server/tokens";
import { decryptCredentials } from "../server/multichannel/crypto";

const config = {
  appUrl: "http://localhost:5173",
  uploadDir: "/tmp/sendry-tests-uploads",
  sessionSecret: "sendry-test-session-secret-at-least-thirty-two-characters",
  mailTransport: "stream" as const,
  databasePath: ":memory:",
};

describe("Sendry API", () => {
  let db: AppDatabase;
  let app: Express;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    seedDatabase(db);
    app = createApp({ db, config, worker: false });
    agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: "qa@sendry.local", password: "TestPass123!" })
      .expect(200);
  });

  afterEach(() => db.close());

  it("authenticates, exposes only accessible brands, and rejects invalid credentials", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ email: "qa@sendry.local", password: "wrong-password" })
      .expect(401);
    await agent
      .patch("/api/brands/brd_atlas")
      .send({
        ai_provider: "openai",
        ai_provider_config: { model: "gpt-5-mini" },
        ai_api_key: "sk-private-test",
        provider_config: {
          host: "smtp.example.test",
          password: "smtp-private-test",
        },
      })
      .expect(200);
    const bootstrap = await agent.get("/api/bootstrap").expect(200);
    expect(bootstrap.body.user.email).toBe("qa@sendry.local");
    expect(bootstrap.body.brands).toHaveLength(1);
    expect(bootstrap.body.brands[0].permissions).toContain("*");
    expect(bootstrap.body.brands[0].ai_api_key).toBeUndefined();
    expect(bootstrap.body.brands[0].ai_encrypted_api_key).toBeUndefined();
    expect(bootstrap.body.brands[0].ai_api_key_configured).toBe(true);
    expect(bootstrap.body.brands[0].provider_config.password).toBe("");
    expect(bootstrap.body.brands[0].provider_config.passwordConfigured).toBe(
      true,
    );
    expect(
      (
        db
          .prepare(
            "SELECT ai_encrypted_api_key FROM brands WHERE id='brd_atlas'",
          )
          .get() as { ai_encrypted_api_key: string }
      ).ai_encrypted_api_key,
    ).not.toContain("sk-private-test");
    const encrypted = (
      db
        .prepare(
          "SELECT ai_encrypted_api_key FROM brands WHERE id='brd_atlas'",
        )
        .get() as { ai_encrypted_api_key: string }
    ).ai_encrypted_api_key;
    expect(
      decryptCredentials(encrypted, config.sessionSecret).apiKey,
    ).toBe("sk-private-test");
  });

  it("searches workspace resources across product areas", async () => {
    const august = await agent
      .get("/api/brands/brd_atlas/search?q=August")
      .expect(200);
    expect(august.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "campaign",
          title: "August product notes",
          path: "/campaigns/cmp_august_notes/report",
        }),
      ]),
    );

    const people = await agent
      .get("/api/brands/brd_atlas/search?q=Sofia")
      .expect(200);
    expect(people.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "contact", title: "Sofia Martin" }),
        expect.objectContaining({
          kind: "conversation",
          path: "/inbox?conversation=cnv_sofia",
        }),
      ]),
    );

    const mixed = await agent
      .get("/api/brands/brd_atlas/search?q=Basic")
      .expect(200);
    expect(mixed.body.results[0]).toEqual(
      expect.objectContaining({
        kind: "template",
        title: "Basic",
        path: "/templates/tpl_basic/builder",
      }),
    );

    await agent.get("/api/brands/brd_atlas/search?q=a").expect(422);

    await agent
      .post("/api/brands/brd_atlas/members")
      .send({
        name: "Template Reviewer",
        email: "reviewer@sendry.local",
        password: "ReviewerPass123!",
        role: "client",
        permissions: ["templates"],
      })
      .expect(201);
    await agent.post("/api/auth/logout").expect(204);
    await agent
      .post("/api/auth/login")
      .send({ email: "reviewer@sendry.local", password: "ReviewerPass123!" })
      .expect(200);

    const restricted = await agent
      .get("/api/brands/brd_atlas/search?q=August")
      .expect(200);
    expect(restricted.body.results).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "campaign" })]),
    );
    const allowed = await agent
      .get("/api/brands/brd_atlas/search?q=Basic")
      .expect(200);
    expect(allowed.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "template" })]),
    );
  });

  it("does not reuse an AI key when the provider changes", async () => {
    await agent
      .patch("/api/brands/brd_atlas")
      .send({
        ai_provider: "openai",
        ai_provider_config: { model: "gpt-5-mini" },
        ai_api_key: "sk-private-test",
      })
      .expect(200);
    const switched = await agent
      .patch("/api/brands/brd_atlas")
      .send({
        ai_provider: "anthropic",
        ai_provider_config: { model: "claude-sonnet-4-5" },
      })
      .expect(200);
    expect(switched.body.ai_api_key_configured).toBe(false);
    expect(
      (
        db
          .prepare(
            "SELECT ai_encrypted_api_key,openai_api_key FROM brands WHERE id='brd_atlas'",
          )
          .get() as {
          ai_encrypted_api_key: string | null;
          openai_api_key: string | null;
        }
      ).ai_encrypted_api_key,
    ).toBeNull();
  });

  it("preserves masked provider credentials, clears them explicitly, and tests local delivery", async () => {
    await agent
      .patch("/api/brands/brd_atlas")
      .send({
        provider: "smtp",
        provider_config: {
          preset: "sendgrid",
          host: "smtp.sendgrid.net",
          port: 587,
          secure: false,
          requireTLS: true,
          user: "apikey",
          password: "sendgrid-api-key",
        },
      })
      .expect(200);

    const preserved = await agent
      .patch("/api/brands/brd_atlas")
      .send({
        provider: "smtp",
        provider_config: {
          preset: "sendgrid",
          host: "smtp.sendgrid.net",
          port: 587,
        },
      })
      .expect(200);
    expect(preserved.body.provider_config.password).toBe("");
    expect(preserved.body.provider_config.passwordConfigured).toBe(true);

    const cleared = await agent
      .patch("/api/brands/brd_atlas")
      .send({
        provider: "smtp",
        provider_config: {
          preset: "mailjet",
          host: "in-v3.mailjet.com",
          port: 465,
          secure: true,
        },
        clear_provider_secret: true,
      })
      .expect(200);
    expect(cleared.body.provider_config).toMatchObject({
      preset: "mailjet",
      host: "in-v3.mailjet.com",
      port: 465,
    });
    expect(cleared.body.provider_config.passwordConfigured).toBe(false);

    const stored = JSON.parse(
      (
        db
          .prepare("SELECT provider_config FROM brands WHERE id='brd_atlas'")
          .get() as { provider_config: string }
      ).provider_config,
    ) as Record<string, unknown>;
    expect(stored.password).toBeUndefined();

    const tested = await agent
      .post("/api/brands/brd_atlas/provider-test")
      .send({ provider: "stream", provider_config: {} })
      .expect(200);
    expect(tested.body).toMatchObject({ ok: true, mode: "stream" });
  });

  it("supports first-run setup on an empty database", async () => {
    const empty = openDatabase(":memory:");
    const setupApp = createApp({ db: empty, config, worker: false });
    await request(setupApp)
      .get("/api/setup/status")
      .expect(200, { required: true });
    const result = await request(setupApp)
      .post("/api/setup")
      .send({
        name: "Owner",
        email: "owner@example.test",
        password: "LongPassword123!",
        company: "Northstar",
        brand: "Northstar",
        from_name: "Northstar Team",
        from_email: "hello@example.test",
        reply_to: "support@example.test",
        timezone: "UTC",
      })
      .expect(201);
    expect(result.headers["set-cookie"]?.[0]).toContain("sendry_session=");
    await request(setupApp)
      .post("/api/setup")
      .send({
        name: "Owner",
        email: "owner@example.test",
        password: "LongPassword123!",
        company: "Northstar",
        brand: "Northstar",
        from_name: "Northstar Team",
        from_email: "hello@example.test",
        reply_to: "support@example.test",
        timezone: "UTC",
      })
      .expect(409);
    empty.close();
  });

  it("persists structured email template designs and responsive CSS safely", async () => {
    const created = await agent
      .post("/api/brands/brd_atlas/templates")
      .send({
        name: "Builder test",
        subject: "Hello [Name]",
        plain_text: "Hello [Name]",
        html_text: '<style>@media(max-width:430px){.column{display:block}}</style><style>@import "https://evil.test/tracking.css";.column{position:fixed;background:url(javascript:alert(1))}</style><table><tr><td style="color:#1458e6;position:fixed;background-image:url(javascript:alert(1))">Hello [Name]</td></tr></table><script>alert(1)</script>',
        editor_mode: "blocks",
        editor_data: { version: 1, settings: { width: 640 }, blocks: [{ id: "block_test", type: "text" }] },
      })
      .expect(201);
    expect(created.body.editor_data).toMatchObject({ version: 1, settings: { width: 640 } });
    expect(created.body.html_text).toContain("@media(max-width:430px)");
    expect(created.body.html_text).toContain('style="color:#1458e6"');
    expect(created.body.html_text).not.toContain("<script");
    expect(created.body.html_text).not.toContain("@import");
    expect(created.body.html_text).not.toContain("position:fixed");
    expect(created.body.html_text).not.toContain("javascript:");

    const updated = await agent
      .patch(`/api/brands/brd_atlas/templates/${created.body.id}`)
      .send({ editor_data: { version: 1, settings: { width: 700 }, blocks: [] } })
      .expect(200);
    expect(updated.body.editor_data.settings.width).toBe(700);
  });

  it("creates, filters, edits, segments, and exports subscribers", async () => {
    const created = await agent
      .post("/api/brands/brd_atlas/lists/lst_product_updates/subscribers")
      .send({
        name: "Marie Curie",
        email: "marie@science.test",
        status: "active",
        custom_values: { Company: "Radium Lab" },
        consent: true,
        notes: "Requested product notes",
      })
      .expect(201);
    await agent
      .patch(
        `/api/brands/brd_atlas/lists/lst_product_updates/subscribers/${created.body.id}`,
      )
      .send({ country: "FR", notes: "Prefers monthly updates" })
      .expect(200);
    const filtered = await agent
      .get(
        "/api/brands/brd_atlas/lists/lst_product_updates/subscribers?status=active&country=FR&source=admin",
      )
      .expect(200);
    expect(
      filtered.body.rows.map((row: { email: string }) => row.email),
    ).toContain("marie@science.test");
    expect(filtered.body.counts.active).toBeGreaterThan(0);

    const segment = await agent
      .post("/api/brands/brd_atlas/lists/lst_product_updates/segments")
      .send({
        name: "French subscribers",
        match_mode: "all",
        conditions: [
          { group_no: 0, field: "country", operator: "is", value: "FR" },
        ],
      })
      .expect(201);
    expect(segment.body.count).toBe(1);
    const exported = await agent
      .get("/api/brands/brd_atlas/lists/lst_product_updates/subscribers/export")
      .expect(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.text).toContain("marie@science.test");
  });

  it("completes double opt-in, preference, and unsubscribe flows", async () => {
    const form = await request(app)
      .get("/public/form/lst_product_updates")
      .expect(200);
    const formToken = form.text.match(/name="t" value="([^"]+)"/)?.[1];
    expect(formToken).toBeTruthy();
    await request(app)
      .post("/public/subscribe")
      .type("form")
      .send({ t: formToken, name: "New Reader", email: "reader@example.test" })
      .expect(302);
    const subscriber = db
      .prepare("SELECT * FROM subscribers WHERE email='reader@example.test'")
      .get() as { id: string; status: string };
    expect(subscriber.status).toBe("unconfirmed");
    const confirmation = "known-confirmation-token";
    db.prepare("UPDATE subscribers SET confirmation_token=? WHERE id=?").run(
      createHash("sha256").update(confirmation).digest("hex"),
      subscriber.id,
    );
    await request(app).get(`/public/confirm?t=${confirmation}`).expect(302);
    expect(
      (
        db
          .prepare("SELECT status FROM subscribers WHERE id=?")
          .get(subscriber.id) as { status: string }
      ).status,
    ).toBe("active");

    const unsubscribeToken = signToken(
      {
        subscriberId: subscriber.id,
        listId: "lst_product_updates",
        brandId: "brd_atlas",
      },
      config.sessionSecret,
    );
    await request(app)
      .get(`/public/unsubscribe?t=${encodeURIComponent(unsubscribeToken)}`)
      .expect(302);
    expect(
      (
        db
          .prepare("SELECT status FROM subscribers WHERE id=?")
          .get(subscriber.id) as { status: string }
      ).status,
    ).toBe("unsubscribed");
  });

  it("generates and stores deterministic AI assistance without provider credentials", async () => {
    const email = await agent
      .post("/api/brands/brd_atlas/ai/email")
      .send({
        task: "Announce the autumn release",
        requirements: "Include one clear action",
      })
      .expect(200);
    expect(email.body.source).toBe("local");
    expect(email.body.html).toContain("[unsubscribe]");
    const subject = await agent
      .post("/api/brands/brd_atlas/ai/subject")
      .send({ content: email.body.html, mode: "curiosity" })
      .expect(200);
    expect(subject.body.subject).toBeTruthy();
    const analysis = await agent
      .post("/api/brands/brd_atlas/ai/analyze-content")
      .send({
        content: email.body.html,
        entityType: "template",
        entityId: "test_template",
      })
      .expect(200);
    expect(analysis.body.score).toBeGreaterThan(0);
    expect(
      db
        .prepare("SELECT id FROM ai_analyses WHERE entity_id='test_template'")
        .get(),
    ).toBeTruthy();
  });

  it("delivers a campaign through the local transport and records reports", async () => {
    db.prepare(
      "UPDATE brands SET current_usage=0,usage_reset_at=? WHERE id=?",
    ).run(new Date().toISOString(), "brd_atlas");
    const campaign = await createCampaign(agent, "Worker integration");
    const estimate = await agent
      .get(`/api/brands/brd_atlas/campaigns/${campaign.id}/estimate`)
      .expect(200);
    expect(estimate.body.recipients).toBe(5);
    await agent
      .post(`/api/brands/brd_atlas/campaigns/${campaign.id}/send`)
      .expect(202);
    while (await processNextJob(db, app.locals.config)) {
      /* drain the queue */
    }
    const stored = db
      .prepare("SELECT status,delivered,failed FROM campaigns WHERE id=?")
      .get(campaign.id) as {
      status: string;
      delivered: number;
      failed: number;
    };
    expect(stored).toEqual({ status: "sent", delivered: 5, failed: 0 });
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM campaign_links WHERE campaign_id=?",
          )
          .get(campaign.id) as { count: number }
      ).count,
    ).toBe(1);
    const report = await agent
      .get(`/api/brands/brd_atlas/campaigns/${campaign.id}/report`)
      .expect(200);
    expect(report.body.metrics.delivered).toBe(5);
  });

  it("runs segmented automations, tracks usage, and exposes step reports", async () => {
    db.prepare(
      "UPDATE brands SET current_usage=0,usage_reset_at=? WHERE id=?",
    ).run(new Date().toISOString(), "brd_atlas");
    const automation = await agent
      .post("/api/brands/brd_atlas/automations")
      .send({
        list_id: "lst_product_updates",
        name: "New reader welcome",
        type: "drip",
      })
      .expect(201);
    const step = await agent
      .post(`/api/brands/brd_atlas/automations/${automation.body.id}/steps`)
      .send({
        offset_value: 0,
        offset_unit: "minutes",
        offset_direction: "after",
        subject: "Welcome [Name]",
        from_name: "Atlas Team",
        from_email: "hello@atlas.test",
        reply_to: "support@atlas.test",
        plain_text: "Welcome [Name] [unsubscribe]",
        html_text:
          '<p>Welcome [Name]</p><p><a href="https://example.test/start">Start</a></p><p>[unsubscribe]</p>',
        editor_mode: "blocks",
        segment_include: [],
        segment_exclude: [],
        opens_tracking: "identified",
        clicks_tracking: "identified",
      })
      .expect(201);
    const subscriber = await agent
      .post("/api/brands/brd_atlas/lists/lst_product_updates/subscribers")
      .send({
        name: "Automation Reader",
        email: "automation@example.test",
        status: "active",
        custom_values: {},
        consent: true,
        notes: "",
      })
      .expect(201);
    expect(subscriber.body.status).toBe("active");
    scheduleDueWork(db);
    while (await processNextJob(db, app.locals.config)) {
      /* drain the queue */
    }
    const delivery = db
      .prepare(
        "SELECT status FROM automation_deliveries WHERE step_id=? AND subscriber_id=?",
      )
      .get(step.body.id, subscriber.body.id) as { status: string };
    expect(delivery.status).toBe("sent");
    const report = await agent
      .get(`/api/brands/brd_atlas/automations/${automation.body.id}/report`)
      .expect(200);
    expect(report.body.steps[0].delivered).toBe(1);
    const analysis = await agent
      .post(`/api/brands/brd_atlas/automations/${automation.body.id}/analyze`)
      .expect(200);
    expect(analysis.body.score).toBeGreaterThan(0);
    expect(
      (
        await agent
          .get(`/api/brands/brd_atlas/automations/${automation.body.id}/report`)
          .expect(200)
      ).body.analysis.entity_type,
    ).toBe("automation");
    const sent = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM automation_deliveries WHERE status='sent'",
        )
        .get() as { count: number }
    ).count;
    expect(
      (
        db
          .prepare("SELECT current_usage FROM brands WHERE id=?")
          .get("brd_atlas") as { current_usage: number }
      ).current_usage,
    ).toBe(sent);
  });

  it("recurs annual automations while retaining delivery history", async () => {
    db.prepare(
      "UPDATE brands SET current_usage=0,usage_reset_at=? WHERE id=?",
    ).run(new Date().toISOString(), "brd_atlas");
    const automation = await agent
      .post("/api/brands/brd_atlas/automations")
      .send({
        list_id: "lst_product_updates",
        name: "Birthday greeting",
        type: "annual",
        date_field_id: "fld_birthday",
      })
      .expect(201);
    const step = await agent
      .post(`/api/brands/brd_atlas/automations/${automation.body.id}/steps`)
      .send({
        offset_value: 0,
        offset_unit: "days",
        offset_direction: "after",
        subject: "Happy birthday [Name]",
        from_name: "Atlas Team",
        from_email: "hello@atlas.test",
        reply_to: "support@atlas.test",
        plain_text: "Happy birthday [Name] [unsubscribe]",
        html_text: "<p>Happy birthday [Name]</p><p>[unsubscribe]</p>",
        editor_mode: "blocks",
        segment_include: [],
        segment_exclude: [],
        opens_tracking: "identified",
        clicks_tracking: "identified",
      })
      .expect(201);
    const subscriber = await agent
      .post("/api/brands/brd_atlas/lists/lst_product_updates/subscribers")
      .send({
        name: "Annual Reader",
        email: "annual@example.test",
        status: "active",
        custom_values: { Birthday: "1990-08-08" },
        consent: true,
        notes: "",
      })
      .expect(201);
    db.prepare(
      "UPDATE automation_deliveries SET scheduled_at=? WHERE step_id=? AND subscriber_id=?",
    ).run(
      new Date(Date.now() - 1000).toISOString(),
      step.body.id,
      subscriber.body.id,
    );
    scheduleDueWork(db);
    while (await processNextJob(db, app.locals.config)) {
      /* drain the queue */
    }
    const deliveries = db
      .prepare(
        "SELECT status,scheduled_at FROM automation_deliveries WHERE step_id=? AND subscriber_id=? ORDER BY scheduled_at",
      )
      .all(step.body.id, subscriber.body.id) as Array<{
      status: string;
      scheduled_at: string;
    }>;
    expect(deliveries.map((delivery) => delivery.status)).toEqual([
      "sent",
      "queued",
    ]);
    expect(new Date(deliveries[1].scheduled_at).getTime()).toBeGreaterThan(
      Date.now() + 300 * 86400000,
    );
  });

  it("applies workspace controls and rejects malformed campaign links", async () => {
    const token = await agent
      .post("/api/settings/api-token")
      .send({ workspace_id: "wsp_atlas", name: "Integration test" })
      .expect(201);
    await agent
      .patch("/api/settings/workspaces/wsp_atlas")
      .send({ rows_per_page: 10, strict_delete: true, api_enabled: false })
      .expect(200);
    const subscribers = await agent
      .get("/api/brands/brd_atlas/lists/lst_product_updates/subscribers")
      .expect(200);
    expect(subscribers.body.limit).toBe(10);
    await request(app)
      .get("/api/v1/brands")
      .set("authorization", `Bearer ${token.body.token}`)
      .expect(403);
    await agent
      .patch("/api/settings/workspaces/wsp_atlas")
      .send({ api_enabled: true })
      .expect(200);
    await request(app)
      .get("/api/v1/brands")
      .set("authorization", `Bearer ${token.body.token}`)
      .expect(200);

    const payload = campaignPayload("Link preflight");
    payload.html_text =
      '<p><a href="not-a-url">Broken</a></p><p>[unsubscribe]</p>';
    const campaign = await agent
      .post("/api/brands/brd_atlas/campaigns")
      .send(payload)
      .expect(201);
    const result = await agent
      .post(`/api/brands/brd_atlas/campaigns/${campaign.body.id}/send`)
      .expect(422);
    expect(result.body.issues[0].reason).toBe("Invalid URL");
  });

  it("supports test-mode checkout and enforces tenant boundaries", async () => {
    db.prepare(
      "UPDATE brands SET delivery_fee=2,recipient_fee=0.1,current_usage=0,usage_reset_at=? WHERE id=?",
    ).run(new Date().toISOString(), "brd_atlas");
    const campaign = await createCampaign(agent, "Paid delivery");
    await agent
      .post(`/api/brands/brd_atlas/campaigns/${campaign.id}/send`)
      .expect(402);
    const checkout = await agent
      .post(`/api/brands/brd_atlas/campaigns/${campaign.id}/checkout`)
      .send({
        return_url: "http://localhost:5173/campaigns",
        cancel_url: "http://localhost:5173/campaigns",
      })
      .expect(201);
    expect(checkout.body.testMode).toBe(true);
    await agent
      .post(
        `/api/brands/brd_atlas/campaigns/${campaign.id}/payments/${checkout.body.paymentId}/capture`,
      )
      .expect(200);
    await agent
      .post(`/api/brands/brd_atlas/campaigns/${campaign.id}/send`)
      .expect(202);

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO brands (id,workspace_id,name,from_name,from_email,reply_to,created_at,updated_at) VALUES ('brd_other','wsp_atlas','Other','Other','other@example.test','other@example.test',?,?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO lists (id,brand_id,name,preference_name,created_at,updated_at) VALUES ('lst_other','brd_other','Other list','Other list',?,?)",
    ).run(now, now);
    await agent.get("/api/brands/brd_atlas/lists/lst_other").expect(404);
    await agent
      .post("/api/brands/brd_atlas/campaigns")
      .send(campaignPayload("Cross brand", "lst_other"))
      .expect(422);
  });

  it("resets monthly usage on the configured day unless carry-over is enabled", () => {
    db.prepare(
      "UPDATE brands SET current_usage=42,reset_day=5,limit_never_expires=0,usage_reset_at='2026-06-05T00:00:00.000Z' WHERE id='brd_atlas'",
    ).run();
    expect(resetMonthlyUsage(db, new Date("2026-08-08T12:00:00.000Z"))).toBe(1);
    expect(
      (
        db
          .prepare("SELECT current_usage FROM brands WHERE id='brd_atlas'")
          .get() as { current_usage: number }
      ).current_usage,
    ).toBe(0);
    db.prepare(
      "UPDATE brands SET current_usage=9,limit_never_expires=1 WHERE id='brd_atlas'",
    ).run();
    expect(resetMonthlyUsage(db, new Date("2026-09-08T12:00:00.000Z"))).toBe(0);
  });

  it("enforces anonymous brand privacy without enabling disabled tracking", () => {
    expect(
      effectiveTracking(
        { opens_tracking: "identified", clicks_tracking: "identified" },
        "anonymous",
      ),
    ).toMatchObject({
      opens_tracking: "anonymous",
      clicks_tracking: "anonymous",
    });
    expect(
      effectiveTracking(
        { opens_tracking: "off", clicks_tracking: "identified" },
        "anonymous",
      ),
    ).toMatchObject({ opens_tracking: "off", clicks_tracking: "anonymous" });
    expect(
      effectiveTracking(
        { opens_tracking: "identified", clicks_tracking: "off" },
        "identified",
      ),
    ).toMatchObject({ opens_tracking: "identified", clicks_tracking: "off" });
  });
});

function campaignPayload(subject: string, listId = "lst_product_updates") {
  return {
    subject,
    label: subject,
    from_name: "Atlas Team",
    from_email: "hello@atlas.test",
    reply_to: "support@atlas.test",
    plain_text: "Read the update [unsubscribe]",
    html_text:
      '<h1>Update</h1><p><a href="https://example.test/update">Read more</a></p><p>[unsubscribe]</p>',
    editor_mode: "blocks",
    editor_data: {},
    attachments: [],
    query_string: "utm_source=sendry",
    web_language: "en",
    opens_tracking: "identified",
    clicks_tracking: "identified",
    check_links: true,
    targets: [{ kind: "list", target_id: listId, mode: "include" }],
  };
}

async function createCampaign(
  agent: ReturnType<typeof request.agent>,
  subject: string,
) {
  const response = await agent
    .post("/api/brands/brd_atlas/campaigns")
    .send(campaignPayload(subject))
    .expect(201);
  return response.body as { id: string };
}
