// The two-sided rewrite described in
// docs/adr/0005-oidc-two-origins-and-stateless-session.md: the document
// fetched over the back channel comes back with every field on the origin it
// was fetched from, so nothing in it is kept as returned.
import * as openid from "openid-client";

const FRONT_CHANNEL_FIELDS = ["authorization_endpoint", "end_session_endpoint"];
const BACK_CHANNEL_FIELDS = ["token_endpoint", "jwks_uri", "userinfo_endpoint"];

function withOrigin(url, origin) {
  const rewritten = new URL(url);
  const target = new URL(origin);
  rewritten.protocol = target.protocol;
  rewritten.hostname = target.hostname;
  // The URL setter for `.host` (or `.port` alone) leaves an existing port in
  // place when the new value carries none, so it has to be cleared by hand.
  rewritten.port = target.port;
  return rewritten.toString();
}

export async function createOidc(config) {
  const response = await fetch(
    `${config.oidcBackchannelUrl}/.well-known/openid-configuration`,
  );
  if (!response.ok) {
    throw new Error(
      `Could not fetch OIDC discovery document from ${config.oidcBackchannelUrl}: ${response.status}`,
    );
  }
  const document = await response.json();

  const issuerOrigin = new URL(config.oidcIssuerUrl).origin;
  const backchannelOrigin = new URL(config.oidcBackchannelUrl).origin;

  const metadata = { ...document };
  for (const field of FRONT_CHANNEL_FIELDS) {
    if (metadata[field])
      metadata[field] = withOrigin(metadata[field], issuerOrigin);
  }
  for (const field of BACK_CHANNEL_FIELDS) {
    if (metadata[field])
      metadata[field] = withOrigin(metadata[field], backchannelOrigin);
  }
  metadata.issuer = config.oidcIssuerUrl;

  const oidcConfig = new openid.Configuration(
    metadata,
    config.oidcClientId,
    {},
    openid.ClientSecretBasic(config.oidcClientSecret),
  );

  if (config.oidcAllowInsecureHttp) {
    openid.allowInsecureRequests(oidcConfig);
  }

  return oidcConfig;
}

export { openid };
