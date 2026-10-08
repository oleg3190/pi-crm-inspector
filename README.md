[![CI](https://github.com/oleg3190/pi-crm-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/oleg3190/pi-crm-inspector/actions/workflows/ci.yml)

# pi-crm-inspector

## Purpose

This package runs CRM browser inspection in an isolated child pi process. The child exposes only inspect_crm_page; the parent receives bounded, sanitized, machine-readable diagnostics.

## Inspector contract

Actions: click, fill, select, check, press, wait.
wait is a standalone time delay with durationMs up to 60 seconds.
waitFor remains an action property and waits for visible, hidden, attached, or detached DOM state.
The child inspection budget is 120 seconds.

## Selectors

Prefer semantic targets: role, label, placeholder, text, testId.
Text-like targets support match=exact or match=contains. CSS targets use Playwright CSS grammar, including :visible. role+name, label, placeholder, and text are exact by default; match=contains relaxes the text/name match.
Repeated controls support a scoped target, for example text=4 scoped to [data-calendar='main']. This is preferred over nth-child selectors.

## Assertions

Final assertions run after all actions.
Per-action assertions run immediately after the action's waitFor/DOM-stability phase.
Supported assertions: expectText, expectVisible, expectCount, expectAttribute, expectUrl, expectElementState, expectStyle, expectGeometry.
Assertion diagnostics return actualText, actualUrl, actualValue, computed style, and computed geometry where applicable.

## Failure checkpoints

diagnostics supports captureAfterEachAction, captureOnAssertionFailure, elementsMode, maxElements, and domSelector.
An action-local assertion failure automatically captures a checkpoint by default.

## Network diagnostics

The inspector records the latest 100 authenticated requests with method, sanitized URL, resource type, status, duration, bounded request body, bounded response body, and failure text.
Request bodies are capped at 8 KiB; response bodies at about 1 KiB.
Sensitive query parameters, credentials, authorization tokens, cookies, and common secret fields are redacted before the result is emitted. Binary response bodies are not decoded.

## Output compaction

Successful inspections default to visible interactive elements only, up to 40.
diagnostics can switch to all elements and can request a focused DOM subtree.

## Authentication and concurrency

Inspections using the same CRM username are serialized. Different usernames may run concurrently.
An authenticated HTTP 401 triggers exactly one fresh child/browser/login retry. A second authentication failure remains a structured failure.

## Security boundary

The browser is a bounded inspection capability, not an OS/kernel sandbox.
The child environment is explicitly allowlisted; dangerous runtime injection variables are rejected.
The child model cannot use arbitrary JavaScript, shell commands, cookies, headers, credentials, or network utilities.

## Development

npm install
npx playwright install chromium
npm run check

The canonical action/assertion schemas live in shared/schema.ts.

## AI-oriented diagnostics

Successful results include a compact `diagnosticsSummary` with action/assertion counts, failed network requests, console/page errors, and checkpoints. Network entries mark failed responses and expose only a bounded response content type; headers, cookies, and credentials remain excluded.

## CRM API tool

The main agent can call `crm_api_request` for allowlisted CRM services without receiving their API secrets. Configure one JSON service registry in `PI_CRM_API_SERVICES_JSON`; each service has its own HTTPS `baseUrl` and `auth.secretRef`. Secrets themselves stay only in the runtime environment.

Example:

```json
{
  "customers": { "baseUrl": "https://customers.example.test", "auth": { "type": "apiKey", "header": "X-API-Key", "secretRef": "CUSTOMERS_API_KEY" } },
  "orders": { "baseUrl": "https://orders.example.test", "auth": { "type": "bearer", "secretRef": "ORDERS_API_TOKEN" } }
}
```

The agent supplies only `service`, relative `path`, HTTP method, and optional body. The runtime resolves the service, injects API-key or Bearer authentication, rejects cross-origin/absolute paths, uses `redirect: "error"`, bounds the response at 256 KiB, and anonymizes the response before it reaches the agent. If a response exceeds the limit and is marked `truncated`, the agent must use the CRM service's pagination mechanism (page/pageSize, limit/offset, cursor, or documented equivalent) instead of requesting the entire dataset. Request bodies are sent to the CRM **verbatim** and are never anonymized by the API runtime; callers are responsible for supplying the intended request payload.\n\nOperational URLs in anonymized API responses are represented by short-lived, session-local opaque URL tokens (`https://example.invalid/__pi_crm_url/<token>`). When the agent reuses such a token as the next API path, the runtime resolves it back to the original URL and still enforces the configured service origin. This prevents anonymization from turning pagination, links, or follow-up GETs into 404s without exposing the real URL to the agent.

### API response anonymization

CRM API responses are anonymized **before they are returned to the agent**. The runtime does not require a list of field names: it recursively walks every JSON value and preserves the response structure and value types while replacing the data.

- object keys and nesting stay unchanged;
- strings become other strings of the same general shape; emails, phones, UUIDs, URLs, and ISO dates remain valid in their respective formats;
- integers remain integers, numbers remain numbers, booleans remain booleans, null remains null;
- arrays keep their length and recursively preserve element types;
- the same source value maps deterministically to the same replacement for the same configured service, so repeated API calls remain coherent for the agent;
- plain-text responses are replaced as strings rather than passed through raw;
- API secrets are scrubbed before anonymization and never appear in the returned body or URL;
- the anonymization key is derived inside the runtime from the service secret and is never exposed to the agent.

There is intentionally no field allowlist: unknown CRM schemas are anonymized automatically. This is a privacy boundary for agent context, not merely log redaction.


### API response field selection

For large JSON responses, the agent can request only the fields it needs in the same `crm_api_request` call. The runtime still anonymizes and bounds the full response internally, but only the selected compact data is returned to the agent.

```json
{
  "service": "customers",
  "method": "GET",
  "path": "/v1/customers",
  "select": ["id", "email", "status"],
  "limit": 20
}
```

`select` accepts field names or business concepts (for example `email`, `customer id`, `status`, `created date`, or `total`). The runtime resolves them against the response schema and returns compact items plus the matched paths. This is the normal agent workflow; the response-handle/schema helpers remain internal implementation details rather than separate agent tools.

Selection is bounded to 32 requested fields, 100 returned items, and 32 KiB of extracted JSON. If the API response itself exceeds 256 KiB, the agent must use the CRM API's pagination mechanism instead of reconstructing the full dataset.
