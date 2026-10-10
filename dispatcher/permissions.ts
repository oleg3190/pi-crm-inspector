import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { Type } from "typebox";

const ENABLED_ENV = "PI_CRM_INSPECTOR_PERMISSIONS_ENABLED";
const DATABASE_URL_ENV = "PI_CRM_INSPECTOR_TEST_DATABASE_URL";
const CONFIG_PATH_ENV = "PI_CRM_INSPECTOR_PERMISSIONS_CONFIG";
const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("../config/inspector-permissions.json", import.meta.url));

export const InspectorPermissionsParametersSchema = Type.Object({}, {
  additionalProperties: false,
  description: "No inputs; execute only the local, preconfigured permissions query.",
});

export type InspectorPermissionsResult =
  | { status: "success"; operation: "grant"; anonymized: true }
  | {
      status: "error";
      code: "disabled" | "configuration_error" | "database_mismatch" | "execution_failed";
      message: string;
      anonymized: true;
    };

type PermissionsConfig = {
  databaseName: string;
  role: string;
  query: string;
};

type PermissionsSqlClient = {
  <T extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  unsafe(query: string): Promise<unknown>;
  end(options?: { timeout?: number }): Promise<void>;
};

type ExecuteDependencies = {
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  createClient?: (connectionString: string) => PermissionsSqlClient;
};

class PermissionsSetupError extends Error {
  readonly code: "disabled" | "configuration_error" | "database_mismatch";

  constructor(
    code: "disabled" | "configuration_error" | "database_mismatch",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

function configError(message: string): never {
  throw new PermissionsSetupError("configuration_error", message);
}

async function loadConfig(configPath: string): Promise<PermissionsConfig> {
  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch {
    configError("Permissions config is missing or unreadable. Copy config/inspector-permissions.example.json to config/inspector-permissions.json and configure it.");
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    configError("Permissions config must contain valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    configError("Permissions config must be a JSON object.");
  }

  const config = value as Record<string, unknown>;
  const databaseName = config.databaseName;
  const role = config.role;
  const query = config.query;

  // Use simple unquoted PostgreSQL identifiers to keep the target checks exact.
  const identifierPattern = /^[a-z_][a-z0-9_$]{0,62}$/u;
  if (typeof databaseName !== "string" || !identifierPattern.test(databaseName)) {
    configError("Permissions config databaseName must be a simple PostgreSQL identifier in lowercase.");
  }
  if (typeof role !== "string" || !identifierPattern.test(role)) {
    configError("Permissions config role must be a simple PostgreSQL identifier in lowercase.");
  }
  if (typeof query !== "string" || query.trim().length === 0 || query.length > 10_000) {
    configError("Permissions config query must contain one SQL statement up to 10000 characters.");
  }

  validateGrantQuery(query, role, databaseName);
  return { databaseName, role, query };
}

function validateGrantQuery(query: string, role: string, databaseName: string): string {
  const trimmed = query.trim();
  const statement = trimmed.replace(/;\s*$/u, "").trim();

  // Keep the configured operation to one explicit GRANT statement. Comments are
  // rejected so a second statement cannot be hidden from this lightweight guard.
  if (
    !statement ||
    statement.includes(";") ||
    /--|\/\*|\*\//u.test(statement) ||
    !/^GRANT\s/iu.test(statement) ||
    !/\bON\b/iu.test(statement) ||
    /\bWITH\s+(?:GRANT|ADMIN)\s+OPTION\b/iu.test(statement)
  ) {
    configError("Configured SQL must be one GRANT ... ON ... TO statement, without comments or grant/admin option.");
  }

  const toClauses = statement.match(/\bTO\b/giu) ?? [];
  const targetMatch = statement.match(/\bTO\s+([a-z_][a-z0-9_$]*)\s*$/iu);
  if (toClauses.length !== 1 || !targetMatch || targetMatch[1] !== role) {
    configError("Configured GRANT must target exactly the role set in the config.");
  }

  if (/\bON\s+DATABASE\b/iu.test(statement)) {
    const databaseTarget = statement.match(/\bON\s+DATABASE\s+(?:"([^"]+)"|([a-z_][a-z0-9_$]*))(?=\s|$)/iu);
    const targetName = databaseTarget?.[1] ?? databaseTarget?.[2]?.toLowerCase();
    if (!databaseTarget || targetName !== databaseName) {
      configError("Configured GRANT targets a different database than databaseName.");
    }
  }

  return statement;
}

function createPostgresClient(connectionString: string): PermissionsSqlClient {
  return postgres(connectionString, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 1,
    prepare: false,
    connection: {
      application_name: "pi-crm-inspector-permissions",
      statement_timeout: 10_000,
      lock_timeout: 5_000,
    },
  }) as unknown as PermissionsSqlClient;
}

/**
 * Runs the one administrator-configured GRANT against the explicitly configured
 * test database. No SQL or database result is returned to the agent.
 */
export async function executeInspectorPermissions(
  dependencies: ExecuteDependencies = {},
): Promise<InspectorPermissionsResult> {
  const env = dependencies.env ?? process.env;
  let client: PermissionsSqlClient | undefined;

  try {
    if (env[ENABLED_ENV] !== "1") {
      throw new PermissionsSetupError(
        "disabled",
        "Permission setup is disabled. Set PI_CRM_INSPECTOR_PERMISSIONS_ENABLED=1 only for an intentional test-database setup.",
      );
    }

    const connectionString = env[DATABASE_URL_ENV]?.trim();
    if (!connectionString || !/^postgres(?:ql)?:\/\//iu.test(connectionString)) {
      configError("A PostgreSQL URL must be provided in PI_CRM_INSPECTOR_TEST_DATABASE_URL.");
    }

    const config = await loadConfig(
      dependencies.configPath ?? env[CONFIG_PATH_ENV]?.trim() ?? DEFAULT_CONFIG_PATH,
    );
    const statement = validateGrantQuery(config.query, config.role, config.databaseName);
    client = (dependencies.createClient ?? createPostgresClient)(connectionString);

    const rows = await client<{ database: string }>`SELECT current_database() AS database`;
    if (rows[0]?.database !== config.databaseName) {
      throw new PermissionsSetupError(
        "database_mismatch",
        "Connected PostgreSQL database does not match the configured test database; no permissions were changed.",
      );
    }

    await client.unsafe(statement);
    return { status: "success", operation: "grant", anonymized: true };
  } catch (error) {
    if (error instanceof PermissionsSetupError) {
      return { status: "error", code: error.code, message: error.message, anonymized: true };
    }
    // Deliberately suppress PostgreSQL error details: they may include schema,
    // role, connection, or SQL information that should not reach agent context.
    return {
      status: "error",
      code: "execution_failed",
      message: "Permission setup failed; database and SQL details were suppressed.",
      anonymized: true,
    };
  } finally {
    if (client) {
      try {
        await client.end({ timeout: 1 });
      } catch {
        // Do not leak connection teardown details to the agent.
      }
    }
  }
}
