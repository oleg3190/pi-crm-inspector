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
Text-like targets support match=exact or match=contains.
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