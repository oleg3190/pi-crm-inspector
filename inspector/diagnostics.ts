import { randomUUID } from "node:crypto";
import type { Request, Response } from "playwright";
import type { InspectNetworkRequest } from "../shared/protocol.ts";
import { scrubSecrets, sanitizedUrl } from "./security.ts";

const MAX_NETWORK_REQUESTS = 100;
const MAX_REQUEST_BODY_CHARS = 8_192;
const MAX_RESPONSE_BODY_CHARS = 1_024;
const BODY_READ_TIMEOUT_MS = 2_000;

function truncateBody(value: string, max: number): { value: string; truncated: boolean } {
  if (value.length <= max) return { value, truncated: false };
  return { value: value.slice(0, max - 12) + "\n[truncated]", truncated: true };
}

function isTextContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  return value.startsWith("text/")
    || value.includes("json")
    || value.includes("xml")
    || value.includes("javascript")
    || value.includes("x-www-form-urlencoded")
    || value.includes("graphql");
}

async function readResponseBody(response: Response): Promise<{ body?: string; truncated?: boolean }> {
  const contentType = response.headers()["content-type"];
  if (!isTextContentType(contentType)) return { body: "[binary body omitted]" };
  try {
    const buffer = await Promise.race([
      response.body(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("response body read timeout")), BODY_READ_TIMEOUT_MS),
      ),
    ]);
    const text = scrubSecrets(buffer.toString("utf8"), []);
    const clipped = truncateBody(text, MAX_RESPONSE_BODY_CHARS);
    return {
      body: clipped.value,
      ...(clipped.truncated ? { truncated: true } : {}),
    };
  } catch {
    return { body: "[response body unavailable]" };
  }
}

export class NetworkRecorder {
  private readonly entries: InspectNetworkRequest[] = [];
  private readonly byRequest = new Map<Request, InspectNetworkRequest>();
  private readonly startedAt = new Map<Request, number>();
  private droppedEvents = 0;
  private readonly pendingResponses = new Set<Promise<void>>();

  onRequest(request: Request): void {
    const entry: InspectNetworkRequest = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      method: request.method(),
      url: sanitizedUrl(request.url()),
      resourceType: request.resourceType(),
    };
    const postData = request.postData();
    if (postData) {
      const clipped = truncateBody(scrubSecrets(postData, []), MAX_REQUEST_BODY_CHARS);
      entry.requestBody = clipped.value;
      if (clipped.truncated) entry.requestBodyTruncated = true;
    }

    this.entries.push(entry);
    this.byRequest.set(request, entry);
    this.startedAt.set(request, Date.now());

    while (this.entries.length > MAX_NETWORK_REQUESTS) {
      const removed = this.entries.shift();
      if (!removed) break;
      for (const [request, candidate] of this.byRequest.entries()) {
        if (candidate.id === removed.id) {
          this.byRequest.delete(request);
          this.startedAt.delete(request);
          break;
        }
      }
      this.droppedEvents++;
    }
  }

  onResponse(response: Response): void {
    const pending = this.recordResponse(response);
    this.pendingResponses.add(pending);
    void pending.finally(() => this.pendingResponses.delete(pending));
  }

  private async recordResponse(response: Response): Promise<void> {
    const request = response.request();
    const entry = this.byRequest.get(request);
    if (!entry) return;
    entry.status = response.status();
    entry.statusText = response.statusText();
    const startedAt = this.startedAt.get(request);
    if (startedAt !== undefined) entry.durationMs = Math.max(0, Date.now() - startedAt);
    const body = await readResponseBody(response);
    if (body.body !== undefined) entry.responseBody = body.body;
    if (body.truncated) entry.responseBodyTruncated = true;
  }

  onRequestFailed(request: Request, errorText: string): void {
    const entry = this.byRequest.get(request);
    if (!entry) return;
    const startedAt = this.startedAt.get(request);
    if (startedAt !== undefined) entry.durationMs = Math.max(0, Date.now() - startedAt);
    entry.error = scrubSecrets(errorText || "unknown_failure", []);
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pendingResponses]);
  }

  get entriesSnapshot(): InspectNetworkRequest[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  get dropped(): number {
    return this.droppedEvents;
  }
}
