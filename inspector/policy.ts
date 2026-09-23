/**
 * Trusted static policy. Local config for ESS dev CRM.
 * New upstream semantics: URL/origin/path/method restrictions disabled; this file
 * still declares the pages the inspector may open and the login selectors.
 */
import type { PageId } from "../shared/protocol.ts";

export type { BlockReason, ErrorCode, PageId } from "../shared/protocol.ts";

export type QueryPolicy = Readonly<{
  allowedKeys: readonly string[];
  anyKeys?: boolean;
}>;

export type PageConfig = Readonly<{
  url: string;
  allowedDocuments: readonly string[];
  allowedRequestPaths: readonly string[];
  query: QueryPolicy;
}>;

export const APP_ORIGIN = "https://statserv-swarm-dev-batuev-od.profintel.ru";
const AUTH_ORIGIN = "https://auth-statserv-swarm-dev-batuev-od.profintel.ru";
export const REPORT_URL = `${APP_ORIGIN}/v7/marketing/source-report`;
const V5_PAGE = `${APP_ORIGIN}/v5/app/#/page/L3Y0L2NsaWVudHMvc2hvdy8xLzg1MTgv`;

// Login SPA is opened at the bare auth root (no redirect_uri injected).
const LOGIN_URL = `${AUTH_ORIGIN}/`;

const BASE_PATHS = [
  "/",
  "/login",
  "/v4/**",
  "/assets/**",
  "/static/**",
  "/favicon.ico",
] as string[];

export const CRM_POLICY = Object.freeze({
  login: Object.freeze({
    url: LOGIN_URL,
    usernameSelector: "#username",
    passwordSelector: "#password",
    submitSelector: "#submitbutton",
    // successSelector: "" => wait for URL change (login origin left) instead of a DOM marker.
    successSelector: "",
    query: Object.freeze({ allowedKeys: [] as string[] }),
  }),

  pages: Object.freeze({
    dashboard: Object.freeze({
      url: REPORT_URL,
      allowedDocuments: Object.freeze([`${AUTH_ORIGIN}/`, REPORT_URL]),
      allowedRequestPaths: Object.freeze(["/v7/**", ...BASE_PATHS]),
      query: Object.freeze({ allowedKeys: [] as string[], anyKeys: true }),
    }),
    billing_logs: Object.freeze({
      url: REPORT_URL,
      allowedDocuments: Object.freeze([`${AUTH_ORIGIN}/`, REPORT_URL]),
      allowedRequestPaths: Object.freeze(["/v7/**", ...BASE_PATHS]),
      query: Object.freeze({ allowedKeys: [] as string[], anyKeys: true }),
    }),
    auth_logs: Object.freeze({
      url: V5_PAGE,
      allowedDocuments: Object.freeze([`${AUTH_ORIGIN}/`, `${APP_ORIGIN}/v5/app/`]),
      allowedRequestPaths: Object.freeze(["/v5/**", ...BASE_PATHS]),
      query: Object.freeze({ allowedKeys: [] as string[], anyKeys: true }),
    }),
  }),

  browser: Object.freeze({
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

export function customPageConfig(path: string): PageConfig {
  const pathname = (path.split("?", 1)[0] ?? "/").replace(/\/+$/u, "") || "/";
  const extraRules = pathname === "/" ? [] : [`${pathname}/**`];
  const url = `${APP_ORIGIN}${path}`;
  return Object.freeze({
    url,
    allowedDocuments: Object.freeze([`${AUTH_ORIGIN}/`, url]),
    allowedRequestPaths: Object.freeze([...extraRules, ...BASE_PATHS]),
    query: Object.freeze({ allowedKeys: [] as string[], anyKeys: true }),
  });
}

export const PAGE_IDS = ["dashboard", "billing_logs", "auth_logs", "custom"] as const;

export function getPageConfig(pageId: PageId): PageConfig {
  if (pageId === "custom") {
    throw new Error("Custom page requires a path; use customPageConfig(path).");
  }

  return CRM_POLICY.pages[pageId];
}