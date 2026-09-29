import assert from "node:assert/strict";
import test from "node:test";
import { classify, embedHost, mcpClientName, surface, toolName } from "./usage-classify.ts";

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

test("browsers, crawlers and software are told apart", () => {
  assert.equal(classify(CHROME), "browser");
  assert.equal(classify("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"), "crawler");
  assert.equal(classify(CHROME.replace("Chrome/", "HeadlessChrome/")), "crawler", "our own test browsers are not users");
  assert.equal(classify("Googlebot/2.1"), "crawler");
  assert.equal(classify("taifoon-probe/2 (+https://www.taifoon.io)"), "software");
  assert.equal(classify("curl/8.5.0"), "software");
  assert.equal(classify(""), "software");
});

test("paths map to surfaces and assets and scanner probes count as nothing", () => {
  assert.equal(surface("POST", "/api/registration/check"), "build:registration");
  assert.equal(surface("POST", "/api/service/sentinel"), "api:service:call");
  assert.equal(surface("GET", "/api/service/sentinel"), "api:service:read");
  assert.equal(surface("GET", "/api/agent/10256?x=1"), "api:agent");
  assert.equal(surface("POST", "/mcp"), "mcp");
  assert.equal(surface("GET", "/agent/10256"), "page");
  for (const p of ["/_next/static/a.js", "/brand/mark-32.png", "/favicon.ico", "/wp-admin/install.php", "/.env", "/sitemap.xml"]) assert.equal(surface("GET", p), null, p);
});

test("tool names come from the product token; generic HTTP libraries are not named", () => {
  assert.equal(toolName("taifoon-harvester/1.0 (+agent card crawler)"), "taifoon-harvester");
  for (const u of ["curl/8.5", "node", "python-requests/2.31", "Go-http-client/1.1", CHROME, ""]) assert.equal(toolName(u), null, u);
});

test("an embedding site is named; we, search engines and social sites are not", () => {
  assert.equal(embedHost("https://directory.example.org/agents?id=1", undefined), "directory.example.org");
  assert.equal(embedHost(undefined, "https://app.partner.xyz"), "app.partner.xyz");
  for (const r of ["https://kanmani.xyz/agent/1", "https://www.google.com/", "https://t.co/abc", "http://localhost:3000/", "not a url"]) assert.equal(embedHost(r, undefined), null, r);
});

test("MCP client names are short and plain", () => {
  assert.equal(mcpClientName("Claude Code"), "claude code");
  assert.equal(mcpClientName("<script>x</script>"), "scriptxscript");
  assert.equal(mcpClientName(42), null);
});
