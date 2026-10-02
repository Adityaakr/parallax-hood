#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { loadMcpConfig } from "./config.js";
import { buildServer } from "./server.js";

const cfg = loadMcpConfig();
const useHttp = process.argv.includes("--http");

if (!useHttp) {
  const server = buildServer(cfg);
  await server.connect(new StdioServerTransport());
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "info", scope: "mcp", msg: "parallax mcp on stdio", chainId: cfg.chainId, agent: Boolean(cfg.agentPrivateKey) }));
} else {
  // Streamable HTTP: one transport per session.
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const http = createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, chainId: cfg.chainId, sessions: sessions.size, agent: Boolean(cfg.agentPrivateKey) }));
      return;
    }
    const sid = req.headers["mcp-session-id"] as string | undefined;
    let transport = sid ? sessions.get(sid) : undefined;
    if (!transport) {
      if (req.method !== "POST") {
        res.writeHead(400).end("missing session");
        return;
      }
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => { sessions.set(id, transport!); } });
      transport.onclose = () => {
        if (transport?.sessionId) sessions.delete(transport.sessionId);
      };
      await buildServer(cfg).connect(transport);
    }
    let body: unknown = undefined;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = raw ? JSON.parse(raw) : undefined;
    }
    await transport.handleRequest(req, res, body);
  });
  http.listen(cfg.port, cfg.host, () => console.error(JSON.stringify({ ts: new Date().toISOString(), level: "info", scope: "mcp", msg: `parallax mcp on http://${cfg.host}:${cfg.port}/mcp`, chainId: cfg.chainId, agent: Boolean(cfg.agentPrivateKey) })));
}
