import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { PAGE_IDS } from "./protocol.ts";

export const MAX_INSPECT_ACTIONS = 8;
export const MAX_INSPECT_ASSERTIONS = 8;
export const MAX_ACTION_ASSERTIONS = 8;
export const MAX_WAIT_MS = 60_000;
export const MAX_ELEMENTS = 100;

export const PageIdSchema = StringEnum(PAGE_IDS, {
  description: "Fixed CRM page identifier.",
});

const MatchSchema = Type.Optional(
  Type.Union([Type.Literal("exact"), Type.Literal("contains")]),
);

const ScopeSchema = Type.Union([
  Type.Object({
    by: Type.Literal("css"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
  }),
  Type.Object({
    by: Type.Literal("id"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
  }),
  Type.Object({
    by: Type.Literal("role"),
    role: Type.String({ minLength: 1, maxLength: 64 }),
    name: Type.Optional(Type.String({ maxLength: 512 })),
    match: MatchSchema,
  }),
  Type.Object({
    by: Type.Literal("label"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
    match: MatchSchema,
  }),
  Type.Object({
    by: Type.Literal("placeholder"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
    match: MatchSchema,
  }),
  Type.Object({
    by: Type.Literal("text"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
    match: MatchSchema,
  }),
  Type.Object({
    by: Type.Literal("testId"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
  }),
]);

export const InspectTargetSchema = Type.Union([
  Type.Object({
    by: Type.Literal("css"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
  }),
  Type.Object({
    by: Type.Literal("id"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
  }),
  Type.Object({
    by: Type.Literal("role"),
    role: Type.String({ minLength: 1, maxLength: 64 }),
    name: Type.Optional(Type.String({ maxLength: 512 })),
    match: MatchSchema,
    scope: Type.Optional(ScopeSchema),
  }),
  Type.Object({
    by: Type.Literal("label"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
    match: MatchSchema,
    scope: Type.Optional(ScopeSchema),
  }),
  Type.Object({
    by: Type.Literal("placeholder"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
    match: MatchSchema,
    scope: Type.Optional(ScopeSchema),
  }),
  Type.Object({
    by: Type.Literal("text"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
    match: MatchSchema,
    scope: Type.Optional(ScopeSchema),
  }),
  Type.Object({
    by: Type.Literal("testId"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
  }),
]);

export const InspectWaitForSchema = Type.Object({
  selector: Type.String({ minLength: 1, maxLength: 512 }),
  state: Type.Union([
    Type.Literal("visible"),
    Type.Literal("hidden"),
    Type.Literal("attached"),
    Type.Literal("detached"),
  ]),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_WAIT_MS })),
});

export const InspectAssertionSchema = Type.Union([
  Type.Object({
    type: Type.Literal("expectText"),
    target: InspectTargetSchema,
    text: Type.String({ minLength: 1, maxLength: 4096 }),
    exact: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ type: Type.Literal("expectVisible"), target: InspectTargetSchema }),
  Type.Object({
    type: Type.Literal("expectCount"),
    target: InspectTargetSchema,
    count: Type.Integer({ minimum: 0, maximum: MAX_ELEMENTS }),
  }),
  Type.Object({
    type: Type.Literal("expectAttribute"),
    target: InspectTargetSchema,
    name: Type.String({
      pattern: "^[A-Za-z_:][A-Za-z0-9_.:-]{0,63}$",
      maxLength: 64,
    }),
    value: Type.Optional(Type.String({ maxLength: 4096 })),
    present: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    type: Type.Literal("expectUrl"),
    value: Type.String({ minLength: 1, maxLength: 512 }),
    mode: Type.Optional(
      Type.Union([
        Type.Literal("exact"),
        Type.Literal("contains"),
        Type.Literal("startsWith"),
      ]),
    ),
  }),
  Type.Object({
    type: Type.Literal("expectElementState"),
    target: InspectTargetSchema,
    state: Type.Union([
      Type.Literal("visible"),
      Type.Literal("hidden"),
      Type.Literal("enabled"),
      Type.Literal("disabled"),
      Type.Literal("checked"),
      Type.Literal("unchecked"),
      Type.Literal("expanded"),
      Type.Literal("collapsed"),
    ]),
  }),
  Type.Object({
    type: Type.Literal("expectStyle"),
    target: InspectTargetSchema,
    property: Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z-]+$" }),
    value: Type.String({ maxLength: 1024 }),
    mode: Type.Optional(
      Type.Union([Type.Literal("exact"), Type.Literal("contains"), Type.Literal("startsWith")]),
    ),
  }),
  Type.Object({
    type: Type.Literal("expectGeometry"),
    target: InspectTargetSchema,
    width: Type.Optional(Type.Object({
      min: Type.Optional(Type.Number({ minimum: 0, maximum: 4096 })),
      max: Type.Optional(Type.Number({ minimum: 0, maximum: 4096 })),
      exact: Type.Optional(Type.Number({ minimum: 0, maximum: 4096 })),
    })),
    height: Type.Optional(Type.Object({
      min: Type.Optional(Type.Number({ minimum: 0, maximum: 4096 })),
      max: Type.Optional(Type.Number({ minimum: 0, maximum: 4096 })),
      exact: Type.Optional(Type.Number({ minimum: 0, maximum: 4096 })),
    })),
    x: Type.Optional(Type.Object({
      min: Type.Optional(Type.Number({ minimum: -100_000, maximum: 100_000 })),
      max: Type.Optional(Type.Number({ minimum: -100_000, maximum: 100_000 })),
    })),
    y: Type.Optional(Type.Object({
      min: Type.Optional(Type.Number({ minimum: -100_000, maximum: 100_000 })),
      max: Type.Optional(Type.Number({ minimum: -100_000, maximum: 100_000 })),
    })),
    visible: Type.Optional(Type.Boolean()),
  }),
]);

export const InspectActionSchema = Type.Union([
  Type.Object({
    type: Type.Literal("click"),
    target: Type.Optional(InspectTargetSchema),
    selector: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    waitFor: Type.Optional(InspectWaitForSchema),
    assertions: Type.Optional(Type.Array(InspectAssertionSchema, { maxItems: MAX_ACTION_ASSERTIONS })),
  }),
  Type.Object({
    type: Type.Literal("fill"),
    target: InspectTargetSchema,
    value: Type.String({ maxLength: 4096 }),
    sensitive: Type.Optional(Type.Boolean()),
    waitFor: Type.Optional(InspectWaitForSchema),
    assertions: Type.Optional(Type.Array(InspectAssertionSchema, { maxItems: MAX_ACTION_ASSERTIONS })),
  }),
  Type.Object({
    type: Type.Literal("select"),
    target: InspectTargetSchema,
    option: Type.Object({
      value: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      label: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    }),
    waitFor: Type.Optional(InspectWaitForSchema),
    assertions: Type.Optional(Type.Array(InspectAssertionSchema, { maxItems: MAX_ACTION_ASSERTIONS })),
  }),
  Type.Object({
    type: Type.Literal("check"),
    target: InspectTargetSchema,
    checked: Type.Boolean(),
    waitFor: Type.Optional(InspectWaitForSchema),
    assertions: Type.Optional(Type.Array(InspectAssertionSchema, { maxItems: MAX_ACTION_ASSERTIONS })),
  }),
  Type.Object({
    type: Type.Literal("press"),
    target: InspectTargetSchema,
    key: Type.Union([
      Type.Literal("Enter"),
      Type.Literal("Escape"),
      Type.Literal("Tab"),
      Type.Literal("ArrowDown"),
      Type.Literal("ArrowUp"),
      Type.Literal("ArrowLeft"),
      Type.Literal("ArrowRight"),
      Type.Literal("Home"),
      Type.Literal("End"),
      Type.Literal("Space"),
      Type.Literal("Backspace"),
      Type.Literal("Delete"),
    ]),
    waitFor: Type.Optional(InspectWaitForSchema),
    assertions: Type.Optional(Type.Array(InspectAssertionSchema, { maxItems: MAX_ACTION_ASSERTIONS })),
  }),
  Type.Object({
    type: Type.Literal("wait"),
    durationMs: Type.Integer({ minimum: 1, maximum: MAX_WAIT_MS }),
    assertions: Type.Optional(Type.Array(InspectAssertionSchema, { maxItems: MAX_ACTION_ASSERTIONS })),
  }),
]);

export const InspectDiagnosticsSchema = Type.Object({
  captureAfterEachAction: Type.Optional(Type.Boolean()),
  captureOnAssertionFailure: Type.Optional(Type.Boolean()),
  elementsMode: Type.Optional(
    Type.Union([Type.Literal("interactive"), Type.Literal("all")]),
  ),
  maxElements: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_ELEMENTS })),
  domSelector: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
});

export const InspectSubagentParametersSchema = Type.Object({
  page_id: PageIdSchema,
  path: Type.Optional(
    Type.String({ description: "Relative path on the CRM app origin; required when page_id='custom'." }),
  ),
  screenshot: Type.Optional(
    Type.Boolean({ description: "Capture a viewport screenshot after actions and DOM stabilization." }),
  ),
  actions: Type.Optional(
    Type.Array(InspectActionSchema, {
      maxItems: MAX_INSPECT_ACTIONS,
      description: "Bounded deterministic UI actions.",
    }),
  ),
  assertions: Type.Optional(
    Type.Array(InspectAssertionSchema, {
      maxItems: MAX_INSPECT_ASSERTIONS,
      description: "Bounded final assertions.",
    }),
  ),
  diagnostics: Type.Optional(InspectDiagnosticsSchema),
});
