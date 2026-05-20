# Claude.ai Connector Over Tailscale Funnel

This setup exposes the full MacroFactor MCP server to Claude.ai without putting the raw write-capable MCP endpoint directly on the public internet.

## Architecture

```text
Claude.ai
  -> https://<mac>.<tailnet>.ts.net/macrofactor/mcp
    -> Tailscale Funnel
      -> 127.0.0.1:3010 connector OAuth proxy
        -> 127.0.0.1:3001 raw MacroFactor MCP server
```

The proxy does not remove tools. After OAuth, Claude can call the entire MacroFactor MCP server.

## Configure `.env`

Copy `.env.example` to `.env`, then fill in the real values.

Use the same random value for `MCP_AUTH_TOKEN` and `MACROFACTOR_MCP_UPSTREAM_TOKEN`:

```bash
openssl rand -hex 32
```

Required connector values:

```bash
HOST=127.0.0.1
PORT=3001
MCP_AUTH_TOKEN=<same-random-token>

MACROFACTOR_CONNECTOR_PUBLIC_BASE_URL=https://<mac>.<tailnet>.ts.net
MACROFACTOR_CONNECTOR_PUBLIC_PATH=/macrofactor
MACROFACTOR_CONNECTOR_RESOURCE_PATH=/macrofactor/mcp
MACROFACTOR_CONNECTOR_LOGIN_SECRET=<long-secret-you-type-during-Claude-connect>
MACROFACTOR_CONNECTOR_TOKEN_SECRET=<different-random-token>
MACROFACTOR_CONNECTOR_HOST=127.0.0.1
MACROFACTOR_CONNECTOR_PORT=3010
MACROFACTOR_MCP_UPSTREAM_URL=http://127.0.0.1:3001/mcp
MACROFACTOR_MCP_UPSTREAM_TOKEN=<same-random-token>
```

## Build

```bash
npm install
npm run build:mcp
```

## Run With launchd

Copy the plist files into `~/Library/LaunchAgents`:

```bash
cp ops/launchd/com.jwill.macrofactor-mcp-http.plist ~/Library/LaunchAgents/
cp ops/launchd/com.jwill.macrofactor-connector-proxy.plist ~/Library/LaunchAgents/
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.jwill.macrofactor-mcp-http.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.jwill.macrofactor-connector-proxy.plist
```

Check logs:

```bash
tail -f ~/Library/Logs/macrofactor-mcp-http.log
tail -f ~/Library/Logs/macrofactor-connector-proxy.log
```

## Expose With Tailscale Funnel

Once Tailscale is running and Funnel is enabled for the tailnet:

```bash
tailscale funnel --bg --https=443 localhost:3010
```

Your Claude connector URL is:

```text
https://<mac>.<tailnet>.ts.net/macrofactor/mcp
```

## Add In Claude.ai

Go to Claude.ai settings, add a custom connector, and enter:

```text
https://<mac>.<tailnet>.ts.net/macrofactor/mcp
```

The OAuth page asks for `MACROFACTOR_CONNECTOR_LOGIN_SECRET`. After authorization, Claude receives rotating OAuth bearer tokens and forwards them to the connector proxy.

## Stop Services

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.jwill.macrofactor-mcp-http.plist
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.jwill.macrofactor-connector-proxy.plist
tailscale funnel reset
```
