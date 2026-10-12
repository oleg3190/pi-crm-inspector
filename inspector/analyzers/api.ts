import type { Page } from "playwright";
import type {
  ApiPayloadSummary,
  InspectNetworkRequest,
  PageDataAnalysis,
  PageTableSummary,
} from "../../shared/protocol.ts";

const MAX_API_ANALYSIS_BYTES = 256 * 1024;
const MAX_API_ANALYSIS_NODES = 2_000;
const MAX_API_FIELD_PATHS = 40;
const MAX_API_COLLECTIONS = 12;
const MAX_VISIBLE_TABLES = 20;

type JsonRootType = "object" | "array" | "string" | "number" | "boolean" | "null";

function rootTypeOf(value: unknown): JsonRootType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

function safeKey(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$.-]/gu, "_").slice(0, 64);
  return cleaned || "[field]";
}

/**
 * Produces a schema-only view of a response. No response values are copied into
 * the summary; parsing occurs on the diagnostic copy and is bounded by bytes,
 * depth, node count, path count, and collection count.
 */
export function summarizeApiPayload(
  body: Buffer,
  contentType?: string,
): ApiPayloadSummary {
  const byteLength = body.byteLength;
  const mediaType = contentType?.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  if (!mediaType.includes("json")) {
    return { status: "not_json", byteLength, topLevelKeys: [], fieldPaths: [], collections: [] };
  }
  if (byteLength > MAX_API_ANALYSIS_BYTES) {
    return { status: "truncated", byteLength, topLevelKeys: [], fieldPaths: [], collections: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return { status: "invalid_json", byteLength, topLevelKeys: [], fieldPaths: [], collections: [] };
  }

  const topLevelKeys = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.keys(parsed as Record<string, unknown>).slice(0, 32).map(safeKey)
    : [];
  const fieldPaths: string[] = [];
  const collections: ApiPayloadSummary["collections"] = [];
  let visitedNodes = 0;
  let omittedFieldPaths = false;
  let omittedCollections = false;
  let scanTruncated = false;

  const addPath = (path: string) => {
    if (fieldPaths.length < MAX_API_FIELD_PATHS) fieldPaths.push(path);
    else omittedFieldPaths = true;
  };

  const visit = (value: unknown, path: string, depth: number) => {
    if (visitedNodes++ >= MAX_API_ANALYSIS_NODES || depth > 8) {
      scanTruncated = true;
      return;
    }
    if (value === null || typeof value !== "object") return;

    if (Array.isArray(value)) {
      if (collections.length < MAX_API_COLLECTIONS) {
        const sample = value.slice(0, 20);
        collections.push({
          path,
          itemCount: value.length,
          objectItemsSampled: sample.filter((item) =>
            item !== null && typeof item === "object" && !Array.isArray(item),
          ).length,
          sampleSize: sample.length,
        });
      } else {
        omittedCollections = true;
      }
      for (const item of value.slice(0, 8)) visit(item, path + "[*]", depth + 1);
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      const childPath = path === "$" ? "$." + safeKey(key) : path + "." + safeKey(key);
      addPath(childPath);
      visit(child, childPath, depth + 1);
      if (visitedNodes >= MAX_API_ANALYSIS_NODES) {
        scanTruncated = true;
        break;
      }
    }
  };

  if (parsed !== null && typeof parsed === "object") visit(parsed, "$", 0);

  return {
    status: "analyzed",
    byteLength,
    rootType: rootTypeOf(parsed),
    topLevelKeys,
    fieldPaths,
    collections,
    ...(omittedFieldPaths ? { fieldPathsTruncated: true } : {}),
    ...(omittedCollections ? { collectionsTruncated: true } : {}),
    ...(scanTruncated ? { scanTruncated: true } : {}),
  };
}

/** Reads only table dimensions from the rendered DOM; never reads cell contents. */
export async function captureVisibleTableSummary(page: Page): Promise<PageTableSummary[]> {
  return page.evaluate(() => {
    const isVisible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity || "1") !== 0 && rect.width > 0 && rect.height > 0;
    };

    const result: PageTableSummary[] = [];
    const candidates = Array.from(document.querySelectorAll("table, [role='grid'], [role='table']"));
    for (const element of candidates) {
      if (result.length >= 20) break;
      if (!isVisible(element)) continue;
      const isNativeTable = element.tagName.toLowerCase() === "table";
      const rows = isNativeTable
        ? Array.from(element.querySelectorAll("tbody tr")).filter(isVisible)
        : Array.from(element.querySelectorAll("[role='row']")).filter(isVisible)
            .filter((row) => row.getAttribute("aria-rowindex") !== "1");
      const firstRow = isNativeTable
        ? element.querySelector("thead tr, tbody tr")
        : element.querySelector("[role='row']");
      const columns = firstRow
        ? firstRow.querySelectorAll(isNativeTable ? "th, td" : "[role='columnheader'], [role='gridcell'], [role='cell']").length
        : 0;
      result.push({
        index: result.length,
        kind: isNativeTable ? "table" : "aria_grid",
        rowCount: rows.length,
        columnCount: columns,
      });
    }
    return result;
  });
}

export function buildPageDataAnalysis(
  requests: readonly InspectNetworkRequest[],
  visibleTables: readonly PageTableSummary[],
): PageDataAnalysis {
  const jsonResponses = requests.filter((request) =>
    request.apiDataSummary && request.apiDataSummary.status !== "not_json",
  );
  const collections = jsonResponses.flatMap((request) =>
    (request.apiDataSummary?.collections ?? []).map((collection) => ({
      requestId: request.id,
      status: request.status,
      path: collection.path,
      itemCount: collection.itemCount,
      objectItemsSampled: collection.objectItemsSampled,
      sampleSize: collection.sampleSize,
    })),
  ).slice(0, 40);

  return {
    jsonResponses: jsonResponses.length,
    analyzedResponses: jsonResponses.filter((request) => request.apiDataSummary?.status === "analyzed").length,
    invalidJsonResponses: jsonResponses.filter((request) => request.apiDataSummary?.status === "invalid_json").length,
    truncatedResponses: jsonResponses.filter((request) => request.apiDataSummary?.status === "truncated" || request.responseBodyTruncated).length,
    collections,
    visibleTables: [...visibleTables].slice(0, MAX_VISIBLE_TABLES),
    note: "API collection counts and rendered row counts are structural clues only; pagination, filtering, and client-side transformations can make them differ.",
  };
}
