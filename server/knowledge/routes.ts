import { randomUUID } from "node:crypto";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import type { AppDatabase } from "../db";
import { audit } from "../db";
import type { KnowledgeAgent } from "./agent";
import { nowIso } from "../serialize";

const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const param = (request: Request, key: string) => String(request.params[key] ?? "");
const asyncRoute =
  (
    handler: (
      request: Request,
      response: Response,
      next: NextFunction,
    ) => Promise<unknown>,
  ) =>
  (request: Request, response: Response, next: NextFunction) =>
    void handler(request, response, next).catch(next);
const fail = (
  response: Response,
  status: number,
  error: string,
  code: string,
  details?: unknown,
) =>
  response
    .status(status)
    .json({ error, code, ...(details === undefined ? {} : { details }) });

function permissions(value: string) {
  try {
    return new Set(JSON.parse(value) as string[]);
  } catch {
    return new Set<string>();
  }
}

function scopeAllows(scopes: string[] | undefined, required: string) {
  if (!scopes || scopes.includes("*") || scopes.includes(required)) return true;
  const [resource, operation] = required.split(":");
  return scopes.includes(`${resource}:*`) || scopes.includes(`*:${operation}`);
}

function requireChatbotAccess(db: AppDatabase, operation: "read" | "write") {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.authKind)
      return fail(
        response,
        401,
        "Authentication required",
        "AUTHENTICATION_REQUIRED",
      );
    const brandId = param(request, "brandId");
    if (request.authKind === "api") {
      if (!scopeAllows(request.apiScopes, `chatbots:${operation}`))
        return fail(
          response,
          403,
          `Bearer token lacks chatbots:${operation}`,
          "SCOPE_REQUIRED",
          { required: `chatbots:${operation}` },
        );
      if (
        operation === "write" &&
        !scopeAllows(request.apiScopes, "files:write") &&
        !scopeAllows(request.apiScopes, "files")
      )
        return fail(
          response,
          403,
          "Bearer token lacks Files manager access",
          "SCOPE_REQUIRED",
          { required: "files:write" },
        );
      if (
        !db
          .prepare("SELECT id FROM brands WHERE id=? AND workspace_id=?")
          .get(brandId, request.apiWorkspaceId)
      )
        return fail(
          response,
          403,
          "Brand access denied",
          "BRAND_ACCESS_DENIED",
        );
      return next();
    }
    const member = db
      .prepare(
        "SELECT role,permissions FROM brand_members WHERE brand_id=? AND user_id=?",
      )
      .get(brandId, request.authUser?.id) as
      | { role: string; permissions: string }
      | undefined;
    if (!member)
      return fail(response, 403, "Brand access denied", "BRAND_ACCESS_DENIED");
    const allowed = permissions(member.permissions);
    if (
      operation === "write" &&
      member.role !== "owner" &&
      !(allowed.has("*") || (allowed.has("settings") && allowed.has("files")))
    )
      return fail(
        response,
        403,
        "Brand settings and Files manager access are required",
        "CHATBOT_PUBLISH_FORBIDDEN",
      );
    next();
  };
}

function widgetForBrand(db: AppDatabase, brandId: string, widgetId: string) {
  return db
    .prepare("SELECT * FROM chat_widgets WHERE id=? AND brand_id=?")
    .get(widgetId, brandId) as Record<string, unknown> | undefined;
}

export function createKnowledgeRouter(db: AppDatabase, agent: KnowledgeAgent) {
  const router = Router();

  router.get(
    "/brands/:brandId/chatbots",
    requireChatbotAccess(db, "read"),
    (request, response) => {
      const items = db
        .prepare(
          `SELECT cw.*,(SELECT COUNT(*) FROM knowledge_documents kd WHERE kd.widget_id=cw.id AND kd.status='ready') AS ready_sources,(SELECT COUNT(*) FROM knowledge_documents kd WHERE kd.widget_id=cw.id AND kd.status IN ('queued','processing')) AS indexing_sources,(SELECT COUNT(*) FROM knowledge_documents kd WHERE kd.widget_id=cw.id AND kd.status='failed') AS failed_sources FROM chat_widgets cw WHERE cw.brand_id=? ORDER BY cw.created_at`,
        )
        .all(param(request, "brandId"));
      response.json({ data: items });
    },
  );

  router.post(
    "/brands/:brandId/chatbots",
    requireChatbotAccess(db, "write"),
    (request, response) => {
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(160),
          allowed_origins: z
            .array(z.string().trim().min(1))
            .max(100)
            .default([]),
          greeting: z
            .string()
            .trim()
            .min(1)
            .max(1000)
            .default("How can we help?"),
        })
        .safeParse(request.body);
      if (!parsed.success)
        return fail(
          response,
          422,
          "Validation failed",
          "VALIDATION_ERROR",
          z.treeifyError(parsed.error),
        );
      const widgetId = id("wdg"),
        now = nowIso(),
        publicKey = `${id("chat").slice(0, 24)}`;
      db.prepare(
        `INSERT INTO chat_widgets (id,brand_id,public_key,name,greeting,allowed_origins,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        widgetId,
        param(request, "brandId"),
        publicKey,
        parsed.data.name,
        parsed.data.greeting,
        JSON.stringify(parsed.data.allowed_origins),
        now,
        now,
      );
      audit(
        db,
        "chatbot.create",
        "chat_widget",
        widgetId,
        request.authUser?.id,
        param(request, "brandId"),
        { publicKey },
      );
      response
        .status(201)
        .json({ data: widgetForBrand(db, param(request, "brandId"), widgetId) });
    },
  );

  router.patch(
    "/brands/:brandId/chatbots/:widgetId",
    requireChatbotAccess(db, "write"),
    (request, response) => {
      if (!widgetForBrand(db, param(request, "brandId"), param(request, "widgetId")))
        return fail(response, 404, "Chat widget not found", "WIDGET_NOT_FOUND");
      const parsed = z
        .object({
          name: z.string().trim().min(1).max(160).optional(),
          allowed_origins: z
            .array(z.string().trim().min(1))
            .max(100)
            .optional(),
          greeting: z.string().trim().min(1).max(1000).optional(),
          enabled: z.boolean().optional(),
          agent_enabled: z.boolean().optional(),
          agent_instructions: z.string().max(8000).optional(),
          handoff_message: z.string().trim().min(1).max(2000).optional(),
          min_similarity: z.number().min(0).max(1).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success)
        return fail(
          response,
          422,
          "Validation failed",
          "VALIDATION_ERROR",
          z.treeifyError(parsed.error),
        );
      const entries = Object.entries(parsed.data);
      if (entries.length)
        db.prepare(
          `UPDATE chat_widgets SET ${entries.map(([key]) => `${key}=?`).join(",")},updated_at=? WHERE id=? AND brand_id=?`,
        ).run(
          ...entries.map(([key, value]) =>
            key === "allowed_origins"
              ? JSON.stringify(value)
              : typeof value === "boolean"
                ? Number(value)
                : value,
          ),
          nowIso(),
          param(request, "widgetId"),
          param(request, "brandId"),
        );
      audit(
        db,
        "chatbot.update",
        "chat_widget",
        param(request, "widgetId"),
        request.authUser?.id,
        param(request, "brandId"),
        { fields: entries.map(([key]) => key) },
      );
      response.json({
        data: widgetForBrand(
          db,
          param(request, "brandId"),
          param(request, "widgetId"),
        ),
      });
    },
  );

  router.get(
    "/brands/:brandId/chatbots/:widgetId/knowledge",
    requireChatbotAccess(db, "read"),
    (request, response) => {
      if (!widgetForBrand(db, param(request, "brandId"), param(request, "widgetId")))
        return fail(response, 404, "Chat widget not found", "WIDGET_NOT_FOUND");
      const items = db
        .prepare(
          `SELECT kd.*,f.name AS filename,f.mime_type,f.size FROM knowledge_documents kd JOIN files f ON f.id=kd.file_id WHERE kd.brand_id=? AND kd.widget_id=? AND kd.status<>'removed' ORDER BY kd.created_at DESC`,
        )
        .all(param(request, "brandId"), param(request, "widgetId"));
      response.json({ data: items });
    },
  );

  router.post(
    "/brands/:brandId/chatbots/:widgetId/knowledge",
    requireChatbotAccess(db, "write"),
    asyncRoute(async (request, response) => {
      const parsed = z
        .object({ file_ids: z.array(z.string()).min(1).max(100) })
        .safeParse(request.body);
      if (!parsed.success)
        return fail(
          response,
          422,
          "Validation failed",
          "VALIDATION_ERROR",
          z.treeifyError(parsed.error),
        );
      if (!widgetForBrand(db, param(request, "brandId"), param(request, "widgetId")))
        return fail(response, 404, "Chat widget not found", "WIDGET_NOT_FOUND");
      const results = [];
      for (const fileId of parsed.data.file_ids)
        results.push(
          await agent.indexDocument({
            brandId: param(request, "brandId"),
            widgetId: param(request, "widgetId"),
            fileId,
            actorId: request.authUser?.id,
          }),
        );
      audit(
        db,
        "chatbot.knowledge.attach",
        "chat_widget",
        param(request, "widgetId"),
        request.authUser?.id,
        param(request, "brandId"),
        { fileIds: parsed.data.file_ids },
      );
      response.status(202).json({ data: results });
    }),
  );

  router.post(
    "/brands/:brandId/chatbots/:widgetId/knowledge/:documentId/retry",
    requireChatbotAccess(db, "write"),
    asyncRoute(async (request, response) => {
      const document = db
        .prepare(
          "SELECT file_id FROM knowledge_documents WHERE id=? AND brand_id=? AND widget_id=?",
        )
        .get(
          param(request, "documentId"),
          param(request, "brandId"),
          param(request, "widgetId"),
        ) as { file_id: string } | undefined;
      if (!document)
        return fail(
          response,
          404,
          "Knowledge document not found",
          "KNOWLEDGE_DOCUMENT_NOT_FOUND",
        );
      const result = await agent.indexDocument({
        brandId: param(request, "brandId"),
        widgetId: param(request, "widgetId"),
        fileId: document.file_id,
        actorId: request.authUser?.id,
      });
      response.status(202).json({ data: result });
    }),
  );

  router.delete(
    "/brands/:brandId/chatbots/:widgetId/knowledge/:documentId",
    requireChatbotAccess(db, "write"),
    asyncRoute(async (request, response) => {
      if (
        !(await agent.removeDocument({
          brandId: param(request, "brandId"),
          widgetId: param(request, "widgetId"),
          documentId: param(request, "documentId"),
        }))
      )
        return fail(
          response,
          404,
          "Knowledge document not found",
          "KNOWLEDGE_DOCUMENT_NOT_FOUND",
        );
      audit(
        db,
        "chatbot.knowledge.unlink",
        "knowledge_document",
        param(request, "documentId"),
        request.authUser?.id,
        param(request, "brandId"),
      );
      response.status(204).end();
    }),
  );

  router.post(
    "/brands/:brandId/chatbots/:widgetId/test",
    requireChatbotAccess(db, "read"),
    asyncRoute(async (request, response) => {
      const parsed = z
        .object({ question: z.string().trim().min(1).max(4000) })
        .safeParse(request.body);
      if (!parsed.success)
        return fail(
          response,
          422,
          "Validation failed",
          "VALIDATION_ERROR",
          z.treeifyError(parsed.error),
        );
      if (!widgetForBrand(db, param(request, "brandId"), param(request, "widgetId")))
        return fail(response, 404, "Chat widget not found", "WIDGET_NOT_FOUND");
      response.json({
        data: await agent.answer({
          brandId: param(request, "brandId"),
          widgetId: param(request, "widgetId"),
          question: parsed.data.question,
        }),
      });
    }),
  );

  router.post(
    "/brands/:brandId/chatbots/reindex",
    requireChatbotAccess(db, "write"),
    asyncRoute(async (request, response) =>
      response
        .status(202)
        .json({
          data: await agent.reindexProfile({ brandId: param(request, "brandId") }),
        }),
    ),
  );

  router.post(
    "/brands/:brandId/conversations/:conversationId/agent/resume",
    requireChatbotAccess(db, "write"),
    (request, response) => {
      const widgetId = z
        .object({ widget_id: z.string() })
        .parse(request.body).widget_id;
      if (!widgetForBrand(db, param(request, "brandId"), widgetId))
        return fail(response, 404, "Chat widget not found", "WIDGET_NOT_FOUND");
      db.prepare(
        `INSERT INTO conversation_agent_states (conversation_id,brand_id,widget_id,state,reason,updated_by,updated_at) VALUES (?,?,?,'active',NULL,?,?) ON CONFLICT(conversation_id) DO UPDATE SET state='active',reason=NULL,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      ).run(
        param(request, "conversationId"),
        param(request, "brandId"),
        widgetId,
        request.authUser?.id ?? null,
        nowIso(),
      );
      audit(
        db,
        "chatbot.agent.resume",
        "conversation",
        param(request, "conversationId"),
        request.authUser?.id,
        param(request, "brandId"),
        { widgetId },
      );
      response.json({ data: { state: "active" } });
    },
  );

  router.get(
    "/brands/:brandId/chatbots/knowledge/health",
    requireChatbotAccess(db, "read"),
    asyncRoute(async (_request, response) =>
      response.json({ data: await agent.health() }),
    ),
  );

  return router;
}
