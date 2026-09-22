/**
 * Trusted static policy. Keep this package outside any agent-writable workspace.
 * Replace the example CRM values before deployment.
 */
import type { PageId } from "../shared/protocol.ts";

export type { BlockReason, ErrorCode, PageId } from "../shared/protocol.ts";

export type QueryPolicy = Readonly<{
  allowedKeys: readonly string[];
}>;

export type PageConfig = Readonly<{
  url: string;
  allowedDocuments: readonly string[];
  allowedRequestPaths: readonly string[];
  query: QueryPolicy;
}>;


export const CRM_POLICY = Object.freeze({
  login: Object.freeze({
    url: "https://crm.example.internal/login",
    usernameSelector: "input[name='username']",
    passwordSelector: "input[name='password']",
    submitSelector: "button[type='submit']",
    successSelector: "[data-authenticated='true']",
    query: Object.freeze({ allowedKeys: [] as string[] }),
  }),

  pages: Object.freeze({
    dashboard: Object.freeze({
      url: "https://crm.example.internal/dashboard",
      allowedDocuments: Object.freeze([
        "https://crm.example.internal/login",
        "https://crm.example.internal/dashboard",
      ]),
      allowedRequestPaths: Object.freeze([
        "/login",
        "/dashboard",
        "/assets/**",
        "/static/**",
        "/api/dashboard/summary",
        "/api/dashboard/errors",
      ]),
      query: Object.freeze({ allowedKeys: [] as string[] }),
    }),
    billing_logs: Object.freeze({
      url: "https://crm.example.internal/billing/logs",
      allowedDocuments: Object.freeze([
        "https://crm.example.internal/login",
        "https://crm.example.internal/billing/logs",
      ]),
      allowedRequestPaths: Object.freeze([
        "/login",
        "/billing/logs",
        "/assets/**",
        "/static/**",
        "/api/billing/logs",
        "/api/billing/logs/summary",
      ]),
      query: Object.freeze({ allowedKeys: [] as string[] }),
    }),
    auth_logs: Object.freeze({
      url: "https://crm.example.internal/auth/logs",
      allowedDocuments: Object.freeze([
        "https://crm.example.internal/login",
        "https://crm.example.internal/auth/logs",
      ]),
      allowedRequestPaths: Object.freeze([
        "/login",
        "/auth/logs",
        "/assets/**",
        "/static/**",
        "/api/auth/logs",
        "/api/auth/logs/summary",
      ]),
      query: Object.freeze({ allowedKeys: [] as string[] }),
    }),
  }),

  browser: Object.freeze({
    disableProxy: true,
    allowWebSocket: true,
    allowDownloads: false,
    serviceWorkers: "block" as const,
  }),

  limits: Object.freeze({
    operationTimeoutMs: 30_000,
    postLoginSettleMs: 1_500,
    maxConsoleLogs: 500,
    maxPageErrors: 200,
    maxRequestFailures: 200,
    maxLogChars: 4_000,
    maxTotalEventChars: 128_000,
    maxSecurityEvents: 200,
    maxUrlQueryChars: 2_048,
  }),


} as const);

export const PAGE_IDS = ["dashboard", "billing_logs", "auth_logs"] as const;

export function getPageConfig(pageId: PageId): PageConfig {
  return CRM_POLICY.pages[pageId];
}
