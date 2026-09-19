# Security acceptance matrix v3.1

| ID | Test | Expected |
|---|---|---|
| SEC-001 | Main pi startup | Only dispatcher auto-loads from package manifest |
| SEC-002 | Main tool inventory | `inspect_crm_page` absent; `crm_inspector_subagent` present |
| SEC-003 | Child tool inventory | `inspect_crm_page` only |
| SEC-004 | Arbitrary URL | Impossible through schema |
| SEC-005 | Unknown page_id | Rejected |
| SEC-006 | External origin | Block |
| SEC-007 | Evil subdomain | Block |
| SEC-008 | External redirect | Block + abort |
| SEC-009 | Non-HTTPS | Block |
| SEC-010 | URL credentials | Block |
| SEC-011 | Request path outside allowlist | Block |
| SEC-012 | Query key outside allowlist | Block |
| SEC-013 | DELETE/PUT/PATCH/POST | Block; exact login POST only before auth |
| SEC-014 | Login POST after auth | Block |
| SEC-015 | External WebSocket | Block + abort |
| SEC-016 | Download | Cancel + abort |
| SEC-017 | Popup | Close + abort |
| SEC-018 | Service Worker | Block + abort |
| SEC-019 | Unexpected server IP | Block + abort |
| SEC-020 | Missing server IP | Block + abort |
| SEC-021 | Proxy | Disabled |
| SEC-022 | Login telemetry | Not collected |
| SEC-023 | Secret in post-login log | Redacted |
| SEC-024 | Oversized logs | Truncated |
| SEC-025 | Child final prose | Ignored for machine result |
| SEC-026 | Zero inspector calls | Protocol failure |
| SEC-027 | Two inspector calls | Protocol failure |
| SEC-028 | Invalid child details | Protocol failure |
| SEC-029 | Child stdout overflow | Protocol failure |
| SEC-030 | Child timeout | Whole process tree terminated |
| SEC-031 | Parent abort | Whole process tree terminated |
| SEC-032 | Browser launch timeout | Late browser is closed when promise resolves |
| SEC-033 | Browser context timeout | Late context is closed when promise resolves |
| SEC-034 | Main toolset mutation | None |
| SEC-035 | Root wildcard `/**` or `/*` | Startup configuration error |
| SEC-036 | Custom-provider child dependency | Explicit child model required |
| SEC-037 | Child environment | Explicit allowlist; dangerous runtime vars excluded |
| SEC-038 | Read-only network | GET/HEAD only except exact login POST |
