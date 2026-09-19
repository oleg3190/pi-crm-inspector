# pi-crm-inspector v3.1.0

## Architecture

```text
MAIN PI
  |
  +-- normal tools/extensions remain unchanged
  |
  +-- crm_inspector_subagent(page_id)
          |
          +-- separate pi process
          |     +-- --no-extensions + explicit inspector extension
          |     +-- --no-builtin-tools
          |     +-- --tools inspect_crm_page
          |     +-- --no-skills
          |     +-- --no-prompt-templates
          |     +-- --no-context-files
          |     +-- --no-themes
          |     +-- --no-session
          |     +-- temporary empty cwd
          |     +-- explicit child model
          |
          +-- inspect_crm_page
                +-- exact origin/document/path allowlist
                +-- exact query-key allowlist
                +-- GET/HEAD only; exact login POST during login phase
                +-- DNS pinning + fail-closed server IP verification
                +-- no proxy / QUIC disabled
                +-- Service Worker / WebSocket / download / popup blocking
                +-- bounded/scrubbed output
                +-- no login telemetry collection
```

## Requirements

- Node.js `>=22.19.0`.
- pi `0.85.1` compatible runtime.
- Playwright `1.63.0`.
- Chromium installed for Playwright.

## Install

```bash
npm install
npx playwright install chromium
npm run typecheck
npm test
```

The package manifest auto-loads only `dispatcher/index.ts`. The inspector extension is never auto-loaded by the main session; it is explicitly loaded only inside the child process.

Keep the installed package outside any agent-writable workspace.

## Required environment

```bash
export PI_CRM_USERNAME='...'
export PI_CRM_PASSWORD='...'
export PI_CRM_INSPECTOR_MODEL='anthropic/claude-sonnet-4-5'
```

`PI_CRM_INSPECTOR_MODEL` is mandatory. The child runs with `--no-extensions`, so provider extensions from the parent session are unavailable. Choose a built-in provider/model that the child can resolve without loading another extension.

Optional:

```bash
export PI_BIN='pi'
export PI_CRM_CHILD_ENV_ALLOWLIST='EXTRA_NON_RUNTIME_ENV_NAME'
```

Unsafe runtime variables such as `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `DYLD_*`, `BASH_ENV`, and `ENV` are rejected from the extra child-environment allowlist.

## CRM policy

Edit `inspector/policy.ts` before deployment:

- `origin`
- `pinnedIp`
- login URL/selectors
- page URLs
- allowed document URLs
- exact request paths
- allowed query parameter names

The default policy is intentionally narrow and contains example API paths. Replace them with the real read-only endpoints before deployment. Do not use `/**` or `/*`; the validator rejects those root-level rules.

## Security boundary

This extension isolates the browser capability in a child pi process. It is not an OS/kernel sandbox for the main pi process. In ordinary pi mode, the main agent still has its normal tools. Use an OS/container egress policy if you need a hard guarantee that the main process cannot reach arbitrary networks.

## Result transport

The parent never trusts child final prose. It parses pi JSON events and extracts the authoritative `tool_execution_end.result.details` payload for `inspect_crm_page`, then validates it against the shared runtime result guard.

## Hardening details

- Login console/pageerror/requestfailure collection starts only after successful authentication.
- Missing `response.serverAddr()` is a block, not an allow.
- All pending server-address checks are awaited before success.
- Browser/context launch races have late cleanup handlers to prevent orphan resources.
- The child tool returns `terminate: true` so the child does not take another LLM turn after inspection.
- The child environment is explicitly allowlisted instead of inheriting arbitrary process variables.
# pi-crm-inspector
