import { createHash } from "node:crypto";
import { extname } from "node:path";
import { load } from "cheerio";
import JSZip from "jszip";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";

export const KNOWLEDGE_PARSER_VERSION = "sendry-knowledge-v1";
export const KNOWLEDGE_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".csv",
  ".ods",
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
] as const;

export type ChunkLocation = {
  kind: "page" | "section" | "slide" | "sheet" | "text";
  page?: number;
  slide?: number;
  sheet?: string;
  row_start?: number;
  row_end?: number;
  section?: string;
};

export type ParsedChunk = {
  ordinal: number;
  content: string;
  location: ChunkLocation;
  token_estimate: number;
  content_hash: string;
};

type Segment = { text: string; location: ChunkLocation };

function normalize(value: string) {
  return value
    .split(String.fromCharCode(0)).join("")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkSegments(
  segments: Segment[],
  maxCharacters = 3_200,
  overlapCharacters = 480,
) {
  const chunks: ParsedChunk[] = [];
  for (const segment of segments) {
    const source = normalize(segment.text);
    if (!source) continue;
    let cursor = 0;
    while (cursor < source.length) {
      let end = Math.min(source.length, cursor + maxCharacters);
      if (end < source.length) {
        const boundary = Math.max(
          source.lastIndexOf("\n", end),
          source.lastIndexOf(". ", end),
          source.lastIndexOf(" ", end),
        );
        if (boundary > cursor + maxCharacters / 2) end = boundary + 1;
      }
      const content = normalize(source.slice(cursor, end));
      if (content)
        chunks.push({
          ordinal: chunks.length,
          content,
          location: segment.location,
          token_estimate: Math.ceil(content.length / 4),
          content_hash: createHash("sha256").update(content).digest("hex"),
        });
      if (end >= source.length) break;
      cursor = Math.max(cursor + 1, end - overlapCharacters);
    }
  }
  return chunks;
}

async function parsePdf(data: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false });
  const document = await task.promise;
  const segments: Segment[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      segments.push({ text, location: { kind: "page", page: pageNumber } });
    }
  } finally { await task.destroy(); }
  if (!segments.some((segment) => normalize(segment.text)))
    throw Object.assign(
      new Error("Scanned or image-only PDFs are not supported in v1"),
      { code: "SCANNED_PDF_UNSUPPORTED" },
    );
  return segments;
}

async function parseDocx(data: Buffer) {
  const result = await mammoth.extractRawText({ buffer: data });
  return normalize(result.value)
    .split(/\n\s*\n/)
    .map((text, index) => ({
      text,
      location: { kind: "section" as const, section: `Paragraph ${index + 1}` },
    }));
}

async function parsePptx(data: Buffer) {
  const zip = await JSZip.loadAsync(data, {
    checkCRC32: true,
    createFolders: false,
  });
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const segments: Segment[] = [];
  for (const [index, name] of names.entries()) {
    const xml = await zip.file(name)?.async("text");
    const text = xml
      ? load(xml, { xmlMode: true })("a\\:t, t")
          .map((_item, element) => load(element).text())
          .get()
          .join(" ")
      : "";
    segments.push({ text, location: { kind: "slide", slide: index + 1 } });
  }
  return segments;
}

function parseWorkbook(data: Buffer, extension: string) {
  const workbook = XLSX.read(data, {
    type: "buffer",
    dense: true,
    codepage: extension === ".csv" ? 65001 : undefined,
  });
  const segments: Segment[] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<
      Array<string | number | boolean | null>
    >(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
    const header = rows[0]?.map(String).join(" | ") ?? "";
    for (let index = 1; index < Math.max(rows.length, 2); index += 20) {
      const group = rows
        .slice(index, index + 20)
        .map((row) => row.map(String).join(" | "))
        .join("\n");
      segments.push({
        text: [header, group].filter(Boolean).join("\n"),
        location: {
          kind: "sheet",
          sheet: sheetName,
          row_start: index + 1,
          row_end: Math.min(rows.length, index + 20),
        },
      });
    }
  }
  return segments;
}

function parseText(data: Buffer, extension: string) {
  let text = data.toString("utf8");
  if (extension === ".html" || extension === ".htm") {
    const document = load(text);
    document("script,style,noscript,iframe,object,embed").remove();
    text = document("body").text();
  }
  return [{ text, location: { kind: "text" as const } }];
}

export async function parseKnowledgeDocument(input: {
  data: Buffer;
  name: string;
}) {
  if (input.data.length > 25 * 1024 * 1024)
    throw Object.assign(new Error("Knowledge files are limited to 25 MB"), {
      code: "FILE_TOO_LARGE",
    });
  const extension = extname(input.name).toLowerCase();
  if ([".doc", ".ppt", ".xls"].includes(extension))
    throw Object.assign(
      new Error("Legacy Office files are not supported in v1"),
      { code: "LEGACY_OFFICE_UNSUPPORTED" },
    );
  if (
    !KNOWLEDGE_EXTENSIONS.includes(
      extension as (typeof KNOWLEDGE_EXTENSIONS)[number],
    )
  )
    throw Object.assign(
      new Error("This document type is not supported for chatbot knowledge"),
      { code: "DOCUMENT_TYPE_UNSUPPORTED" },
    );
  let segments: Segment[];
  if (extension === ".pdf") segments = await parsePdf(input.data);
  else if (extension === ".docx") segments = await parseDocx(input.data);
  else if (extension === ".pptx") segments = await parsePptx(input.data);
  else if ([".xlsx", ".csv", ".ods"].includes(extension))
    segments = parseWorkbook(input.data, extension);
  else segments = parseText(input.data, extension);
  const chunks = chunkSegments(segments);
  if (!chunks.length)
    throw Object.assign(new Error("The document contains no indexable text"), {
      code: "DOCUMENT_EMPTY",
    });
  return chunks;
}
