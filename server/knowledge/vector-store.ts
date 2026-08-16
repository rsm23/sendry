import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { AppConfig } from "../config";

export type VectorPoint = {
  chunkId: string;
  documentId: string;
  brandId: string;
  widgetId: string;
  vector: number[];
};
export type VectorMatch = { chunkId: string; score: number };

export interface KnowledgeVectorStore {
  upsert(profile: string, points: VectorPoint[]): Promise<void>;
  query(
    profile: string,
    brandId: string,
    widgetId: string,
    vector: number[],
    limit: number,
  ): Promise<VectorMatch[]>;
  removeDocument(
    profile: string,
    brandId: string,
    widgetId: string,
    documentId: string,
  ): Promise<void>;
  healthy(): Promise<boolean>;
}

function collectionName(config: AppConfig, profile: string) {
  return `${config.qdrantCollectionPrefix}_${profile}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 200);
}

function pointId(value: string) {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

export class QdrantKnowledgeVectorStore implements KnowledgeVectorStore {
  private readonly reader: QdrantClient;
  private readonly writer: QdrantClient;
  private readonly dimensions = new Map<string, number>();

  constructor(private readonly config: AppConfig) {
    if (!config.qdrantUrl) throw new Error("QDRANT_URL is required");
    this.reader = new QdrantClient({
      url: config.qdrantUrl,
      apiKey: config.qdrantReadKey || config.qdrantWriteKey,
    });
    this.writer = new QdrantClient({
      url: config.qdrantUrl,
      apiKey: config.qdrantWriteKey,
    });
  }

  private async ensure(profile: string, dimension: number) {
    const name = collectionName(this.config, profile);
    if (this.dimensions.get(name) === dimension) return name;
    const collections = await this.writer.getCollections();
    if (!collections.collections.some((item) => item.name === name)) {
      await this.writer.createCollection(name, {
        vectors: { size: dimension, distance: "Cosine" },
        shard_number: 4,
      });
      for (const field of ["brand_id", "widget_id", "document_id"])
        await this.writer.createPayloadIndex(name, {
          field_name: field,
          field_schema: "keyword",
          wait: true,
        });
    }
    this.dimensions.set(name, dimension);
    return name;
  }

  async upsert(profile: string, points: VectorPoint[]) {
    if (!points.length) return;
    const name = await this.ensure(profile, points[0].vector.length);
    for (let start = 0; start < points.length; start += 64) {
      await this.writer.upsert(name, {
        wait: true,
        points: points
          .slice(start, start + 64)
          .map((point) => ({
            id: pointId(point.chunkId),
            vector: point.vector,
            payload: {
              chunk_id: point.chunkId,
              document_id: point.documentId,
              brand_id: point.brandId,
              widget_id: point.widgetId,
            },
          })),
      });
    }
  }

  async query(
    profile: string,
    brandId: string,
    widgetId: string,
    vector: number[],
    limit: number,
  ) {
    const name = collectionName(this.config, profile);
    try {
      const result = await this.reader.query(name, {
        query: vector,
        filter: {
          must: [
            { key: "brand_id", match: { value: brandId } },
            { key: "widget_id", match: { value: widgetId } },
          ],
        },
        limit,
        with_payload: true,
        with_vector: false,
      });
      return result.points.flatMap((point) =>
        typeof point.payload?.chunk_id === "string"
          ? [{ chunkId: point.payload.chunk_id, score: point.score }]
          : [],
      );
    } catch (error) {
      if (String(error).includes("Not found")) return [];
      throw error;
    }
  }

  async removeDocument(
    profile: string,
    brandId: string,
    widgetId: string,
    documentId: string,
  ) {
    const name = collectionName(this.config, profile);
    try {
      await this.writer.delete(name, {
        wait: true,
        filter: {
          must: [
            { key: "brand_id", match: { value: brandId } },
            { key: "widget_id", match: { value: widgetId } },
            { key: "document_id", match: { value: documentId } },
          ],
        },
      });
    } catch (error) {
      if (!String(error).includes("Not found")) throw error;
    }
  }

  async healthy() {
    try {
      await this.reader.getCollections();
      return true;
    } catch {
      return false;
    }
  }
}

export class MemoryKnowledgeVectorStore implements KnowledgeVectorStore {
  private readonly points = new Map<string, VectorPoint>();
  async upsert(profile: string, points: VectorPoint[]) {
    for (const point of points)
      this.points.set(`${profile}:${point.chunkId}`, point);
  }
  async query(
    profile: string,
    brandId: string,
    widgetId: string,
    vector: number[],
    limit: number,
  ) {
    const magnitude =
      Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0)) || 1;
    return [...this.points.entries()]
      .filter(
        ([key, point]) =>
          key.startsWith(`${profile}:`) &&
          point.brandId === brandId &&
          point.widgetId === widgetId,
      )
      .map(([, point]) => {
        const divisor =
          magnitude *
          (Math.sqrt(
            point.vector.reduce((sum, item) => sum + item * item, 0),
          ) || 1);
        return {
          chunkId: point.chunkId,
          score:
            point.vector.reduce(
              (sum, item, index) => sum + item * (vector[index] ?? 0),
              0,
            ) / divisor,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  async removeDocument(
    profile: string,
    brandId: string,
    widgetId: string,
    documentId: string,
  ) {
    for (const [key, point] of this.points)
      if (
        key.startsWith(`${profile}:`) &&
        point.brandId === brandId &&
        point.widgetId === widgetId &&
        point.documentId === documentId
      )
        this.points.delete(key);
  }
  async healthy() {
    return true;
  }
}
