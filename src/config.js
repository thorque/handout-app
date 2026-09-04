// Configuration is environment variables without defaults. A missing or
// malformed value aborts the start and names itself, all at once, so a fresh
// start names its whole gap rather than one variable per restart.

const VARIABLES = [
  "PORT",
  "BIND_ADDRESS",
  "DATABASE_URL",
  "HANDOUT_DATA_DIR",
  "MAX_UPLOAD_BYTES",
  "OIDC_ISSUER_URL",
  "OIDC_BACKCHANNEL_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_ALLOW_INSECURE_HTTP",
  "SESSION_SECRET",
  "SESSION_COOKIE_SECURE",
];

function isBoolean(value) {
  return value === "true" || value === "false";
}

function isPositiveInteger(value) {
  return /^[0-9]+$/.test(value) && Number(value) > 0;
}

function isPort(value) {
  return /^[0-9]+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

export function loadConfig(env = process.env) {
  const missing = VARIABLES.filter(
    (name) => env[name] === undefined || env[name] === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  const invalid = [];
  if (!isPort(env.PORT)) invalid.push("PORT");
  if (!isPositiveInteger(env.MAX_UPLOAD_BYTES))
    invalid.push("MAX_UPLOAD_BYTES");
  if (!isBoolean(env.OIDC_ALLOW_INSECURE_HTTP))
    invalid.push("OIDC_ALLOW_INSECURE_HTTP");
  if (!isBoolean(env.SESSION_COOKIE_SECURE))
    invalid.push("SESSION_COOKIE_SECURE");
  if (invalid.length > 0) {
    throw new Error(`Invalid environment variables: ${invalid.join(", ")}`);
  }

  return Object.freeze({
    port: Number(env.PORT),
    bindAddress: env.BIND_ADDRESS,
    databaseUrl: env.DATABASE_URL,
    handoutDataDir: env.HANDOUT_DATA_DIR,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES),
    oidcIssuerUrl: env.OIDC_ISSUER_URL,
    oidcBackchannelUrl: env.OIDC_BACKCHANNEL_URL,
    oidcClientId: env.OIDC_CLIENT_ID,
    oidcClientSecret: env.OIDC_CLIENT_SECRET,
    oidcAllowInsecureHttp: env.OIDC_ALLOW_INSECURE_HTTP === "true",
    sessionSecret: env.SESSION_SECRET,
    sessionCookieSecure: env.SESSION_COOKIE_SECURE === "true",
  });
}

export const CONFIG_VARIABLES = VARIABLES;
