import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MacroFactorClient } from '../lib/api/index.js';
import { loadEnvFile } from './env.js';
import { createServer as createMcpServer } from './server.js';

const MCP_PATH = '/mcp';

loadEnvFile();

type JsonRpcId = string | number | null;

type JsonRpcSummary = {
  ids: JsonRpcId[];
  methods: string[];
  toolNames: string[];
};

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Authorization, Content-Type, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, X-MacroFactor-Request-Id');
}

function statusToJsonRpcCode(statusCode: number): number {
  if (statusCode === 400) {
    return -32600;
  }
  if (statusCode === 401 || statusCode === 403) {
    return -32001;
  }
  if (statusCode === 404) {
    return -32004;
  }
  return -32603;
}

function sendJsonError(
  res: ServerResponse,
  statusCode: number,
  message: string,
  requestId: string,
  rpcId: JsonRpcId = null,
  details?: Record<string, unknown>
): void {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-MacroFactor-Request-Id', requestId);
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: statusToJsonRpcCode(statusCode),
        message,
        data: {
          requestId,
          ...details,
        },
      },
      id: rpcId,
    })
  );
}

function isAuthorized(req: IncomingMessage, authToken?: string): boolean {
  if (!authToken) {
    return true;
  }

  const authHeader = req.headers.authorization;
  return authHeader === `Bearer ${authToken}`;
}

function isInitializeRequest(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }

  return 'method' in body && body.method === 'initialize';
}

function jsonRpcSummary(body: unknown): JsonRpcSummary {
  const messages = Array.isArray(body) ? body : [body];
  const ids: JsonRpcId[] = [];
  const methods: string[] = [];
  const toolNames: string[] = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    const record = message as Record<string, unknown>;
    const id = record.id;
    if (typeof id === 'string' || typeof id === 'number' || id === null) {
      ids.push(id);
    }

    if (typeof record.method === 'string') {
      methods.push(record.method);
      const params = record.params;
      if (record.method === 'tools/call' && params && typeof params === 'object') {
        const toolName = (params as { name?: unknown }).name;
        if (typeof toolName === 'string') {
          toolNames.push(toolName);
        }
      }
    }
  }

  return { ids, methods, toolNames };
}

function summaryForLog(summary: JsonRpcSummary): string {
  const method = summary.methods.join(',') || 'none';
  const tool = summary.toolNames.length ? ` tool=${summary.toolNames.join(',')}` : '';
  const ids = summary.ids.length ? ` rpcId=${summary.ids.join(',')}` : '';
  return `method=${method}${tool}${ids}`;
}

function firstRpcId(summary: JsonRpcSummary): JsonRpcId {
  return summary.ids[0] ?? null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) {
    return undefined;
  }

  return JSON.parse(rawBody);
}

async function main() {
  const username = process.env.MACROFACTOR_USERNAME;
  const password = process.env.MACROFACTOR_PASSWORD;
  const authToken = process.env.MCP_AUTH_TOKEN;
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? '3001');

  if (!username || !password) {
    console.error('Missing credentials. Set MACROFACTOR_USERNAME and MACROFACTOR_PASSWORD environment variables.');
    process.exit(1);
  }

  if (!authToken && host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    console.error('Refusing to run an unauthenticated HTTP MCP server on a non-loopback host.');
    process.exit(1);
  }

  if (!authToken) {
    console.warn('Warning: MCP_AUTH_TOKEN is not set. HTTP MCP endpoint is running without authentication.');
  }

  const client = await MacroFactorClient.login(username, password);
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let rpcSummary: JsonRpcSummary = { ids: [], methods: [], toolNames: [] };
    res.setHeader('X-MacroFactor-Request-Id', requestId);
    setCorsHeaders(res);

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    res.once('finish', () => {
      console.log(
        `MCP HTTP ${requestId} ${req.method ?? 'UNKNOWN'} ${url.pathname} -> ${res.statusCode} ${Date.now() - startedAt}ms session=${req.headers['mcp-session-id'] ?? 'none'} ${summaryForLog(rpcSummary)}`
      );
    });

    if (url.pathname !== MCP_PATH) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET,POST,OPTIONS');
      res.end('Method Not Allowed');
      return;
    }

    if (!isAuthorized(req, authToken)) {
      sendJsonError(res, 401, 'Unauthorized: missing or invalid upstream MCP bearer token', requestId);
      return;
    }

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = typeof sessionIdHeader === 'string' ? sessionIdHeader : undefined;

    try {
      if (req.method === 'GET') {
        if (!sessionId) {
          sendJsonError(res, 400, 'Bad Request: Mcp-Session-Id header is required', requestId);
          return;
        }

        const existingTransport = transports.get(sessionId);
        if (!existingTransport) {
          sendJsonError(res, 404, 'Session not found', requestId);
          return;
        }

        await existingTransport.handleRequest(req, res);
        return;
      }

      const parsedBody = await readJsonBody(req);
      rpcSummary = jsonRpcSummary(parsedBody);

      if (sessionId) {
        const existingTransport = transports.get(sessionId);
        if (!existingTransport) {
          sendJsonError(res, 404, 'Session not found', requestId, firstRpcId(rpcSummary));
          return;
        }

        await existingTransport.handleRequest(req, res, parsedBody);
        return;
      }

      if (!isInitializeRequest(parsedBody)) {
        sendJsonError(
          res,
          400,
          'Bad Request: No valid session ID provided. Send initialize without a session ID first, then reuse the Mcp-Session-Id response header.',
          requestId,
          firstRpcId(rpcSummary)
        );
        return;
      }

      let newTransport: StreamableHTTPServerTransport;
      newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (initializedSessionId) => {
          transports.set(initializedSessionId, newTransport);
        },
      });

      newTransport.onclose = () => {
        const sid = newTransport.sessionId;
        if (sid) {
          transports.delete(sid);
        }
      };

      const mcpServer = createMcpServer(client);
      await mcpServer.connect(newTransport);
      await newTransport.handleRequest(req, res, parsedBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof SyntaxError || message.includes('JSON')) {
        sendJsonError(res, 400, 'Invalid JSON body', requestId, firstRpcId(rpcSummary));
        return;
      }

      if (!res.headersSent) {
        sendJsonError(res, 500, 'Internal MacroFactor MCP server error', requestId, firstRpcId(rpcSummary));
      }

      console.error(`MCP HTTP ${requestId} error handling /mcp request: ${message}`);
    }
  });

  httpServer.listen(port, host, () => {
    console.log(`MCP HTTP server listening on http://${host}:${port}${MCP_PATH}`);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Fatal:', message);
  process.exit(1);
});
