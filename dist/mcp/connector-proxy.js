#!/usr/bin/env node
import {
  loadEnvFile
} from "../chunk-HESKLNRG.js";

// src/mcp/connector-proxy.ts
import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createServer } from "http";
import { homedir } from "os";
import { dirname, resolve } from "path";
import { Readable } from "stream";
loadEnvFile();
var SCOPE = "macrofactor";
var ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
var REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
var AUTH_CODE_TTL_MS = 10 * 60 * 1e3;
var FAILED_AUTH_WINDOW_MS = 5 * 60 * 1e3;
var FAILED_AUTH_LIMIT = 10;
var authorizationCodes = /* @__PURE__ */ new Map();
var failedAuthAttempts = /* @__PURE__ */ new Map();
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Set it in .env or the process environment.`);
    process.exit(1);
  }
  return value;
}
function optionalEnv(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}
function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}
function normalizePath(value) {
  const trimmed = value.trim();
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}
function joinPath(base, child) {
  const normalizedBase = normalizePath(base);
  const normalizedChild = normalizePath(child);
  if (normalizedBase === "/") {
    return normalizedChild;
  }
  if (normalizedChild === "/") {
    return normalizedBase;
  }
  return `${normalizedBase}${normalizedChild}`;
}
var publicBaseUrl = normalizeBaseUrl(requiredEnv("MACROFACTOR_CONNECTOR_PUBLIC_BASE_URL"));
var publicPath = normalizePath(optionalEnv("MACROFACTOR_CONNECTOR_PUBLIC_PATH", ""));
var resourcePath = normalizePath(optionalEnv("MACROFACTOR_CONNECTOR_RESOURCE_PATH", joinPath(publicPath, "/mcp")));
var registrationPath = joinPath(publicPath, "/register");
var authorizationPath = joinPath(publicPath, "/authorize");
var tokenPath = joinPath(publicPath, "/token");
var issuerUrl = publicPath === "/" ? publicBaseUrl : `${publicBaseUrl}${publicPath}`;
var resourceUrl = `${publicBaseUrl}${resourcePath}`;
var protectedResourceMetadataPath = `/.well-known/oauth-protected-resource${resourcePath}`;
var authorizationServerMetadataPath = publicPath === "/" ? "/.well-known/oauth-authorization-server" : `/.well-known/oauth-authorization-server${publicPath}`;
var openIdConfigurationPath = publicPath === "/" ? "/.well-known/openid-configuration" : `/.well-known/openid-configuration${publicPath}`;
var loginSecret = requiredEnv("MACROFACTOR_CONNECTOR_LOGIN_SECRET");
var tokenSecret = optionalEnv("MACROFACTOR_CONNECTOR_TOKEN_SECRET", loginSecret);
var host = optionalEnv("MACROFACTOR_CONNECTOR_HOST", "127.0.0.1");
var port = Number(optionalEnv("MACROFACTOR_CONNECTOR_PORT", "3010"));
var upstreamUrl = optionalEnv("MACROFACTOR_MCP_UPSTREAM_URL", "http://127.0.0.1:3001/mcp");
var upstreamToken = process.env.MACROFACTOR_MCP_UPSTREAM_TOKEN ?? process.env.MCP_AUTH_TOKEN;
var stateFilePath = resolve(
  optionalEnv("MACROFACTOR_CONNECTOR_STATE_FILE", `${homedir()}/.macrofactor-mcp-connector/state.json`)
);
var allowedRedirectUris = optionalEnv(
  "MACROFACTOR_CONNECTOR_ALLOWED_REDIRECT_URIS",
  "https://claude.ai/api/mcp/auth_callback,http://localhost/callback,http://127.0.0.1/callback"
).split(",").map((value) => value.trim()).filter(Boolean);
if (tokenSecret.length < 32) {
  console.warn("Warning: MACROFACTOR_CONNECTOR_TOKEN_SECRET should be at least 32 characters.");
}
if (!upstreamToken) {
  console.warn("Warning: no upstream MCP token is set. Set MCP_AUTH_TOKEN and MACROFACTOR_MCP_UPSTREAM_TOKEN.");
}
function blankState() {
  return { clients: {}, refreshTokens: {} };
}
function loadState() {
  if (!existsSync(stateFilePath)) {
    return blankState();
  }
  try {
    const parsed = JSON.parse(readFileSync(stateFilePath, "utf8"));
    return {
      clients: parsed.clients ?? {},
      refreshTokens: parsed.refreshTokens ?? {}
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read connector state file ${stateFilePath}: ${message}`);
  }
}
var state = loadState();
function saveState() {
  mkdirSync(dirname(stateFilePath), { recursive: true, mode: 448 });
  const tmpPath = `${stateFilePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), { mode: 384 });
  renameSync(tmpPath, stateFilePath);
}
function randomId(byteLength = 32) {
  return base64Url(randomBytes(byteLength));
}
function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64url");
}
function hmac(value) {
  return createHmac("sha256", tokenSecret).update(value).digest();
}
function signToken(payload) {
  const encodedPayload = base64Url(JSON.stringify(payload));
  return `${encodedPayload}.${base64Url(hmac(encodedPayload))}`;
}
function verifyToken(token, expectedType) {
  if (!token) {
    return null;
  }
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) {
    return null;
  }
  const expectedSignature = hmac(encodedPayload);
  const receivedSignature = Buffer.from(encodedSignature, "base64url");
  if (expectedSignature.length !== receivedSignature.length || !timingSafeEqual(expectedSignature, receivedSignature)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1e3);
    if (payload.typ !== expectedType || payload.iss !== issuerUrl || payload.aud !== resourceUrl || payload.exp <= now || !payload.scope.split(/\s+/).includes(SCOPE)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
function issueTokens(clientId, scope) {
  const now = Math.floor(Date.now() / 1e3);
  const accessJti = randomId(18);
  const refreshJti = randomId(18);
  const accessToken = signToken({
    aud: resourceUrl,
    client_id: clientId,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    iat: now,
    iss: issuerUrl,
    jti: accessJti,
    scope,
    sub: "macrofactor-owner",
    typ: "access"
  });
  const refreshToken = signToken({
    aud: resourceUrl,
    client_id: clientId,
    exp: now + REFRESH_TOKEN_TTL_SECONDS,
    iat: now,
    iss: issuerUrl,
    jti: refreshJti,
    scope,
    sub: "macrofactor-owner",
    typ: "refresh"
  });
  state.refreshTokens[refreshJti] = {
    client_id: clientId,
    expires_at: now + REFRESH_TOKEN_TTL_SECONDS,
    scope
  };
  saveState();
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}
function cleanExpiredState() {
  const now = Math.floor(Date.now() / 1e3);
  let changed = false;
  for (const [jti, record] of Object.entries(state.refreshTokens)) {
    if (record.expires_at <= now) {
      delete state.refreshTokens[jti];
      changed = true;
    }
  }
  if (changed) {
    saveState();
  }
}
function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}
function constantTimeSecretMatches(input) {
  const expected = createHmac("sha256", loginSecret).update(loginSecret).digest();
  const received = createHmac("sha256", loginSecret).update(input).digest();
  return timingSafeEqual(expected, received);
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Authorization, Content-Type, Last-Event-ID, Mcp-Session-Id, MCP-Protocol-Version"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
}
function sendJson(res, statusCode, body) {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
function statusToJsonRpcCode(statusCode) {
  if (statusCode === 400) {
    return -32600;
  }
  if (statusCode === 401 || statusCode === 403) {
    return -32001;
  }
  if (statusCode === 404) {
    return -32004;
  }
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return -32002;
  }
  return -32603;
}
function sendMcpJsonError(res, statusCode, message, requestId, rpcId = null, details) {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("X-MacroFactor-Request-Id", requestId);
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: statusToJsonRpcCode(statusCode),
        message,
        data: {
          requestId,
          ...details
        }
      },
      id: rpcId
    })
  );
}
function sendHtml(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
}
function sendOAuthError(res, statusCode, error, description) {
  sendJson(res, statusCode, {
    error,
    error_description: description
  });
}
function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}
function authChallengeHeader() {
  return `Bearer error="invalid_token", error_description="Authentication required", resource_metadata="${publicBaseUrl}${protectedResourceMetadataPath}", scope="${SCOPE}"`;
}
function sendAuthChallenge(res) {
  setCorsHeaders(res);
  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", authChallengeHeader());
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      error: "invalid_token",
      error_description: "Authentication required"
    })
  );
}
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
function jsonRpcSummary(body) {
  const messages = Array.isArray(body) ? body : [body];
  const ids = [];
  const methods = [];
  const toolNames = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message;
    const id = record.id;
    if (typeof id === "string" || typeof id === "number" || id === null) {
      ids.push(id);
    }
    if (typeof record.method === "string") {
      methods.push(record.method);
      const params = record.params;
      if (record.method === "tools/call" && params && typeof params === "object") {
        const toolName = params.name;
        if (typeof toolName === "string") {
          toolNames.push(toolName);
        }
      }
    }
  }
  return { ids, methods, toolNames };
}
function summaryForLog(summary) {
  const method = summary.methods.join(",") || "none";
  const tool = summary.toolNames.length ? ` tool=${summary.toolNames.join(",")}` : "";
  const ids = summary.ids.length ? ` rpcId=${summary.ids.join(",")}` : "";
  return `method=${method}${tool}${ids}`;
}
function firstRpcId(summary) {
  return summary.ids[0] ?? null;
}
function extractBearer(headers) {
  const authorization = headers.authorization;
  if (!authorization) {
    return void 0;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1];
}
function parseUrl(req) {
  return new URL(req.url ?? "/", publicBaseUrl);
}
function protectedResourceMetadata() {
  return {
    resource: resourceUrl,
    authorization_servers: [issuerUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE]
  };
}
function authorizationServerMetadata() {
  return {
    issuer: issuerUrl,
    authorization_endpoint: `${publicBaseUrl}${authorizationPath}`,
    token_endpoint: `${publicBaseUrl}${tokenPath}`,
    registration_endpoint: `${publicBaseUrl}${registrationPath}`,
    scopes_supported: [SCOPE, "offline_access"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true
  };
}
function redirectUriMatches(registered, actual) {
  if (registered === actual) {
    return true;
  }
  try {
    const registeredUrl = new URL(registered);
    const actualUrl = new URL(actual);
    const loopback = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]"]);
    return loopback.has(registeredUrl.hostname) && registeredUrl.hostname === actualUrl.hostname && registeredUrl.protocol === actualUrl.protocol && registeredUrl.pathname === actualUrl.pathname;
  } catch {
    return false;
  }
}
function redirectUriAllowedByPolicy(uri) {
  return allowedRedirectUris.some((allowed) => redirectUriMatches(allowed, uri));
}
function safeClientLabel(clientId) {
  if (clientId.startsWith("https://")) {
    try {
      const url = new URL(clientId);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "https-client";
    }
  }
  return `${clientId.slice(0, 18)}...`;
}
function normalizeScope(scope) {
  const requested = new Set((scope ?? SCOPE).split(/\s+/).filter(Boolean));
  requested.add(SCOPE);
  return [...requested].filter((item) => item === SCOPE || item === "offline_access").join(" ");
}
async function clientFromId(clientId) {
  const registered = state.clients[clientId];
  if (registered) {
    return registered;
  }
  if (!clientId.startsWith("https://")) {
    return null;
  }
  const response = await fetch(clientId);
  if (!response.ok) {
    return null;
  }
  const metadata = await response.json();
  const redirectUris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.filter((uri) => typeof uri === "string") : [];
  if (metadata.client_id !== clientId || redirectUris.length === 0) {
    return null;
  }
  if (!redirectUris.some(redirectUriAllowedByPolicy)) {
    return null;
  }
  return {
    client_id: clientId,
    client_name: metadata.client_name,
    client_uri: metadata.client_uri,
    created_at: Math.floor(Date.now() / 1e3),
    redirect_uris: redirectUris
  };
}
function redirectAllowedForClient(client, redirectUri) {
  return client.redirect_uris.some((registered) => redirectUriMatches(registered, redirectUri));
}
async function handleRegistration(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }
  const rawBody = await readBody(req);
  let body;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    sendOAuthError(res, 400, "invalid_client_metadata", "Registration body must be JSON.");
    return;
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((uri) => typeof uri === "string") : [];
  if (redirectUris.length === 0) {
    sendOAuthError(res, 400, "invalid_redirect_uri", "At least one redirect URI is required.");
    return;
  }
  if (!redirectUris.some(redirectUriAllowedByPolicy)) {
    sendOAuthError(res, 400, "invalid_redirect_uri", "No registered redirect URI is allowed.");
    return;
  }
  const clientId = `client_${randomId(24)}`;
  const client = {
    client_id: clientId,
    client_name: typeof body.client_name === "string" ? body.client_name : void 0,
    client_uri: typeof body.client_uri === "string" ? body.client_uri : void 0,
    created_at: Math.floor(Date.now() / 1e3),
    redirect_uris: redirectUris
  };
  state.clients[clientId] = client;
  saveState();
  console.log(`OAuth DCR registered client=${safeClientLabel(clientId)} redirects=${redirectUris.length}`);
  sendJson(res, 201, {
    client_id: client.client_id,
    client_id_issued_at: client.created_at,
    client_name: client.client_name,
    client_uri: client.client_uri,
    redirect_uris: client.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: `${SCOPE} offline_access`
  });
}
function authForm(query, error) {
  const hiddenInputs = [...query.entries()].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join("\n");
  const errorBlock = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize MacroFactor MCP</title>
    <style>
      :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { align-items: center; background: #101114; display: flex; margin: 0; min-height: 100vh; }
      main { margin: 0 auto; max-width: 460px; padding: 32px; width: 100%; }
      h1 { font-size: 24px; margin: 0 0 12px; }
      p { color: #b8bcc6; line-height: 1.5; }
      label { display: block; font-size: 13px; font-weight: 600; margin: 24px 0 8px; }
      input[type="password"] { background: #191b20; border: 1px solid #343844; border-radius: 8px; color: #fff; font: inherit; padding: 12px; width: 100%; }
      button { background: #5b8cff; border: 0; border-radius: 8px; color: #fff; cursor: pointer; font: inherit; font-weight: 700; margin-top: 18px; padding: 12px 16px; width: 100%; }
      .error { color: #ff8787; }
      .fine-print { font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize MacroFactor MCP</h1>
      <p>Claude is requesting access to your local MacroFactor MCP connector.</p>
      <p class="fine-print">This grants access to the full MCP server, including write tools for food, weight, workouts, recipes, and preferences.</p>
      ${errorBlock}
      <form method="post" action="${escapeHtml(authorizationPath)}">
        ${hiddenInputs}
        <label for="login_secret">Connector login secret</label>
        <input id="login_secret" name="login_secret" type="password" autocomplete="current-password" autofocus required>
        <button type="submit">Authorize Claude</button>
      </form>
    </main>
  </body>
</html>`;
}
function clientIp(req) {
  return req.socket.remoteAddress ?? "unknown";
}
function tooManyFailedAttempts(req) {
  const ip = clientIp(req);
  const entry = failedAuthAttempts.get(ip);
  if (!entry) {
    return false;
  }
  if (Date.now() - entry.firstFailureAt > FAILED_AUTH_WINDOW_MS) {
    failedAuthAttempts.delete(ip);
    return false;
  }
  return entry.count >= FAILED_AUTH_LIMIT;
}
function recordFailedAttempt(req) {
  const ip = clientIp(req);
  const existing = failedAuthAttempts.get(ip);
  if (!existing || Date.now() - existing.firstFailureAt > FAILED_AUTH_WINDOW_MS) {
    failedAuthAttempts.set(ip, { count: 1, firstFailureAt: Date.now() });
    return;
  }
  existing.count += 1;
}
function clearFailedAttempts(req) {
  failedAuthAttempts.delete(clientIp(req));
}
async function handleAuthorize(req, res, url) {
  const query = new URLSearchParams(url.searchParams);
  if (req.method === "POST") {
    const rawBody = await readBody(req);
    const form = new URLSearchParams(rawBody.toString("utf8"));
    const submittedSecret = form.get("login_secret") ?? "";
    form.delete("login_secret");
    query.forEach((_, key) => query.delete(key));
    for (const [key, value] of form.entries()) {
      query.append(key, value);
    }
    if (tooManyFailedAttempts(req)) {
      sendHtml(res, 429, authForm(query, "Too many failed attempts. Wait a few minutes and try again."));
      return;
    }
    if (!constantTimeSecretMatches(submittedSecret)) {
      recordFailedAttempt(req);
      sendHtml(res, 401, authForm(query, "That connector login secret was not accepted."));
      return;
    }
    clearFailedAttempts(req);
  } else if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET,POST");
    res.end("Method Not Allowed");
    return;
  }
  const responseType = query.get("response_type");
  const clientId = query.get("client_id");
  const redirectUri = query.get("redirect_uri");
  const codeChallenge = query.get("code_challenge");
  const codeChallengeMethod = query.get("code_challenge_method");
  if (!responseType || !clientId || !redirectUri || !codeChallenge) {
    sendHtml(res, 400, authForm(query, "Missing required OAuth parameters."));
    return;
  }
  if (responseType !== "code" || codeChallengeMethod !== "S256") {
    sendHtml(res, 400, authForm(query, "Unsupported OAuth request."));
    return;
  }
  const client = await clientFromId(clientId);
  if (!client || !redirectAllowedForClient(client, redirectUri) || !redirectUriAllowedByPolicy(redirectUri)) {
    console.warn(
      `OAuth authorize rejected client=${clientId ? safeClientLabel(clientId) : "missing"} redirect=${redirectUri ?? "missing"}`
    );
    sendHtml(res, 400, authForm(query, "The OAuth client or redirect URI is not allowed."));
    return;
  }
  if (req.method === "GET") {
    console.log(`OAuth authorize prompt client=${safeClientLabel(clientId)} redirect=${redirectUri}`);
    sendHtml(res, 200, authForm(query));
    return;
  }
  const code = randomId(32);
  authorizationCodes.set(code, {
    client_id: clientId,
    code_challenge: codeChallenge,
    expires_at: Date.now() + AUTH_CODE_TTL_MS,
    redirect_uri: redirectUri,
    scope: normalizeScope(query.get("scope"))
  });
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  const oauthState = query.get("state");
  if (oauthState) {
    redirectUrl.searchParams.set("state", oauthState);
  }
  console.log(`OAuth authorize accepted client=${safeClientLabel(clientId)} redirect=${redirectUri}`);
  redirect(res, redirectUrl.toString());
}
async function handleToken(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return;
  }
  const form = new URLSearchParams((await readBody(req)).toString("utf8"));
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code");
    const clientId = form.get("client_id");
    const redirectUri = form.get("redirect_uri");
    const codeVerifier = form.get("code_verifier");
    if (!code || !clientId || !redirectUri || !codeVerifier) {
      sendOAuthError(res, 400, "invalid_request", "Missing authorization_code token parameters.");
      return;
    }
    const record = authorizationCodes.get(code);
    authorizationCodes.delete(code);
    if (!record || record.expires_at <= Date.now()) {
      console.warn(`OAuth token rejected expired_or_missing_code client=${safeClientLabel(clientId)}`);
      sendOAuthError(res, 400, "invalid_grant", "Authorization code is invalid or expired.");
      return;
    }
    if (record.client_id !== clientId || record.redirect_uri !== redirectUri || sha256Base64Url(codeVerifier) !== record.code_challenge) {
      console.warn(`OAuth token rejected verification_failed client=${safeClientLabel(clientId)}`);
      sendOAuthError(res, 400, "invalid_grant", "Authorization code verification failed.");
      return;
    }
    const tokens = issueTokens(clientId, record.scope);
    console.log(`OAuth token issued grant=authorization_code client=${safeClientLabel(clientId)}`);
    sendJson(res, 200, {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      scope: record.scope
    });
    return;
  }
  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    const payload = verifyToken(refreshToken ?? void 0, "refresh");
    if (!payload) {
      console.warn("OAuth token rejected invalid_refresh");
      sendOAuthError(res, 400, "invalid_grant", "Refresh token is invalid or expired.");
      return;
    }
    const record = state.refreshTokens[payload.jti];
    if (!record || record.client_id !== payload.client_id || record.expires_at <= Math.floor(Date.now() / 1e3)) {
      console.warn(`OAuth token rejected inactive_refresh client=${safeClientLabel(payload.client_id)}`);
      sendOAuthError(res, 400, "invalid_grant", "Refresh token is no longer active.");
      return;
    }
    delete state.refreshTokens[payload.jti];
    const tokens = issueTokens(payload.client_id, record.scope);
    console.log(`OAuth token issued grant=refresh_token client=${safeClientLabel(payload.client_id)}`);
    sendJson(res, 200, {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      scope: record.scope
    });
    return;
  }
  sendOAuthError(res, 400, "unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
}
function mcpBodyRequiresAuth(body) {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      return true;
    }
    const method = message.method;
    if (typeof method !== "string") {
      continue;
    }
    if (method === "initialize" || method === "notifications/initialized" || method === "ping") {
      continue;
    }
    return true;
  }
  return false;
}
function copyForwardHeaders(req) {
  const headers = new Headers();
  const namesToCopy = ["content-type", "last-event-id", "mcp-session-id", "mcp-protocol-version"];
  for (const name of namesToCopy) {
    const value = req.headers[name];
    if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  if (req.method === "GET") {
    headers.set("accept", "text/event-stream");
  } else {
    headers.set("accept", "application/json, text/event-stream");
  }
  if (upstreamToken) {
    headers.set("authorization", `Bearer ${upstreamToken}`);
  }
  return headers;
}
async function pipeUpstreamResponse(upstreamResponse, res) {
  setCorsHeaders(res);
  res.statusCode = upstreamResponse.status;
  upstreamResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "transfer-encoding") {
      res.setHeader(key, value);
    }
  });
  setCorsHeaders(res);
  if (!upstreamResponse.body) {
    res.end();
    return;
  }
  await new Promise((resolvePromise, reject) => {
    Readable.fromWeb(upstreamResponse.body).on("error", reject).on("end", resolvePromise).pipe(res);
  });
}
async function readUpstreamText(upstreamResponse) {
  try {
    return await upstreamResponse.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Failed to read upstream response body: ${message}`;
  }
}
function summarizeUpstreamErrorBody(bodyText) {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "No response body from upstream MCP server.";
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const error = parsed.error;
      if (error && typeof error === "object") {
        const message = error.message;
        const description = error.error_description;
        if (typeof message === "string") {
          return message;
        }
        if (typeof description === "string") {
          return description;
        }
      }
    }
  } catch {
  }
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}
async function handleMcp(req, res) {
  const requestId = randomUUID();
  res.setHeader("X-MacroFactor-Request-Id", requestId);
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET,POST,OPTIONS");
    res.end("Method Not Allowed");
    return;
  }
  const accessPayload = verifyToken(extractBearer(req.headers), "access");
  let rawBody;
  let parsedBody;
  let rpcSummary = { ids: [], methods: [], toolNames: [] };
  if (req.method === "POST") {
    rawBody = await readBody(req);
    const bodyText = rawBody.toString("utf8").trim();
    if (bodyText) {
      try {
        parsedBody = JSON.parse(bodyText);
        rpcSummary = jsonRpcSummary(parsedBody);
      } catch {
        console.warn(`MCP ${requestId} invalid_json auth=${accessPayload ? "ok" : "missing"}`);
        sendMcpJsonError(res, 400, "Invalid JSON body", requestId, null);
        return;
      }
    }
  }
  console.log(
    `MCP ${requestId} inbound auth=${accessPayload ? "ok" : "missing"} session=${req.headers["mcp-session-id"] ?? "none"} ${summaryForLog(rpcSummary)}`
  );
  const authRequired = req.method === "GET" || mcpBodyRequiresAuth(parsedBody);
  if (authRequired && !accessPayload) {
    console.warn(`MCP ${requestId} auth_required ${summaryForLog(rpcSummary)}`);
    sendAuthChallenge(res);
    return;
  }
  let upstreamResponse;
  const upstreamStartedAt = Date.now();
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      body: rawBody ? rawBody.toString("utf8") : void 0,
      headers: copyForwardHeaders(req),
      method: req.method
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`MCP ${requestId} upstream_fetch_failed ${message}`);
    sendMcpJsonError(res, 502, "MacroFactor MCP upstream is unreachable", requestId, firstRpcId(rpcSummary), {
      upstreamUrl,
      cause: message
    });
    return;
  }
  console.log(
    `MCP ${requestId} upstream status=${upstreamResponse.status} duration=${Date.now() - upstreamStartedAt}ms ${summaryForLog(rpcSummary)}`
  );
  if (upstreamResponse.status >= 400) {
    const bodyText = await readUpstreamText(upstreamResponse);
    const upstreamMessage = summarizeUpstreamErrorBody(bodyText);
    console.warn(`MCP ${requestId} upstream_error status=${upstreamResponse.status} message=${upstreamMessage}`);
    sendMcpJsonError(
      res,
      upstreamResponse.status === 406 ? 502 : upstreamResponse.status,
      `MacroFactor MCP upstream returned ${upstreamResponse.status}: ${upstreamMessage}`,
      requestId,
      firstRpcId(rpcSummary),
      {
        upstreamStatus: upstreamResponse.status
      }
    );
    return;
  }
  await pipeUpstreamResponse(upstreamResponse, res);
}
async function handleRequest(req, res) {
  cleanExpiredState();
  const url = parseUrl(req);
  const startedAt = Date.now();
  res.once("finish", () => {
    console.log(`${req.method ?? "UNKNOWN"} ${url.pathname} -> ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }
  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, service: "macrofactor-mcp-connector" });
    return;
  }
  if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp" || url.pathname === protectedResourceMetadataPath) {
    sendJson(res, 200, protectedResourceMetadata());
    return;
  }
  if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration" || url.pathname === authorizationServerMetadataPath || url.pathname === openIdConfigurationPath) {
    sendJson(res, 200, authorizationServerMetadata());
    return;
  }
  if (url.pathname === registrationPath) {
    await handleRegistration(req, res);
    return;
  }
  if (url.pathname === authorizationPath) {
    await handleAuthorize(req, res, url);
    return;
  }
  if (url.pathname === tokenPath) {
    await handleToken(req, res);
    return;
  }
  if (url.pathname === resourcePath) {
    await handleMcp(req, res);
    return;
  }
  res.statusCode = 404;
  res.end("Not Found");
}
var server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Connector proxy error:", message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "server_error", error_description: "Internal server error" });
    }
  });
});
server.listen(port, host, () => {
  console.log(`MacroFactor Claude connector proxy listening on http://${host}:${port}`);
  console.log(`Public connector URL should be ${resourceUrl}`);
});
//# sourceMappingURL=connector-proxy.js.map