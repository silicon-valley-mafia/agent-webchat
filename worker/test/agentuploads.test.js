// TODO #20: uploads go to webchat-uploads/<agent number>/... (same numbers as logs/<N>/) when the page names the agent.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import worker from "../src/main.js";
import { _resetRateLimiter, artifactFolder } from "../src/index.js";

const ORIGIN = "https://silicon-valley-mafia.github.io";
const CONV = "AbCdEf123-in";
const env = {
  ALLOWED_ORIGINS: ORIGIN,
  DIRECTLINE_SECRET: "s",
  DEFAULT_AGENT_ID: "github",
  ACCESS_CODE: "owner-code",
  ARTIFACT_REPO: "silicon-valley-mafia/uploads",
  ARTIFACT_REPO_TOKEN: "t",
  AGENTS: JSON.stringify({ spark: { name: "SPARK", initials: "SP", num: 2, secret: "s2" } }),
};
beforeEach(() => _resetRateLimiter());

const begin = (agent) => {
  const headers = { Origin: ORIGIN, "X-Access-Code": "owner-code", "Content-Type": "application/json", "CF-Connecting-IP": "4.4.4.4" };
  if (agent) headers["X-Agent"] = agent;
  return worker.fetch(new Request("https://w.example/artifact", {
    method: "POST", headers, body: JSON.stringify({ op: "begin", conversationId: CONV, name: "a.txt", size: 10 }),
  }), env);
};

test("artifactFolder: agent number folder when given, old flat folder without", () => {
  const p = { slug: "deepesh" };
  assert.equal(artifactFolder(p, CONV, "20261127-174700-ab12", 2), "webchat-uploads/2/2026-11-27/deepesh--" + CONV + "/174700-ab12");
  assert.equal(artifactFolder(p, CONV, "20261127-174700-ab12"), "webchat-uploads/2026-11-27/deepesh--" + CONV + "/174700-ab12");
});

test("/artifact begin with X-Agent uses that agent's number", async () => {
  const j = await (await begin("spark")).json();
  assert.match(j.folder, /^webchat-uploads\/2\/\d{4}-\d{2}-\d{2}\//);
});

test("/artifact begin without X-Agent (older page) keeps the flat folder", async () => {
  const j = await (await begin("")).json();
  assert.match(j.folder, /^webchat-uploads\/\d{4}-\d{2}-\d{2}\//);
});

test("/artifact begin with an unknown agent is refused", async () => {
  const r = await begin("nope");
  assert.ok(r.status >= 400 && r.status < 500);
});

test("page: /artifact paths get X-Agent; /artifact/put takes the conversation from the URL", () => {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL("../../web/agents.js", import.meta.url), "utf8"), ctx);
  const A = ctx.AgentAgents;
  assert.equal(A.convOfUrl("https://w/artifact/put?conversationId=" + encodeURIComponent(CONV) + "&i=1"), CONV);
  assert.equal(A.convOfUrl("https://w/artifact/put?i=1"), "");
  const map = { [CONV]: "spark" };
  assert.equal(A.agentFor("/artifact", CONV, map, "github", ["github", "spark"]), "spark");
  assert.equal(A.agentFor("/artifact/put", CONV, map, "github", ["github", "spark"]), "spark");
});
