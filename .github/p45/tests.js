
// ---------- TODO #45 starters, #46 plan board, #47 hand-off, #20 History filter (Batch B / C) ----------
import fs45 from "node:fs";
import vm45 from "node:vm";
import { publicAgent } from "../src/main.js";

function page45(file, cfg) {
  const ctx = { console, AGENT_WEBCHAT_CONFIG: cfg || {} };
  ctx.window = ctx;
  vm45.createContext(ctx);
  vm45.runInContext(fs45.readFileSync(new URL("../../web/" + file, import.meta.url), "utf8"), ctx, { filename: file });
  return ctx;
}
const plain45 = (x) => JSON.parse(JSON.stringify(x));

test("#45: starter prompts are cleaned; a chat is empty until the user sends something", () => {
  const S = page45("starters.js").AgentStarters;
  assert.deepEqual(plain45(S.clean([" a ", "", "a", 5, "b", "c", "d", "e", "f", "g"])), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(plain45(S.clean("x")), []);
  assert.deepEqual(plain45(S.clean(["x".repeat(301)])), [], "too long");
  assert.equal(S.isEmpty([{ type: "message", from: { role: "bot" } }]), true);
  assert.equal(S.isEmpty([{ type: "message", from: { role: "user" } }]), false);
  assert.equal(S.isEmpty(null), true);
});

test("#46: plan board reads a YAML task list and picks the next task", () => {
  const P = page45("planboard.js").AgentPlan;
  const y = "plan: web-52\ntitle: Portable repos\ntasks:\n  - id: t1\n    title: \"Write the patch\"\n    status: done\n" +
    "  - id: t2\n    title: Open the PR # comment\n    status: todo\n  - {id: t3, title: Deploy, status: blocked}\n";
  const p = plain45(P.parse(y));
  assert.equal(p.plan, "web-52");
  assert.equal(p.title, "Portable repos");
  assert.deepEqual(p.tasks, [
    { id: "t1", title: "Write the patch", status: "done" },
    { id: "t2", title: "Open the PR", status: "todo" },
    { id: "t3", title: "Deploy", status: "blocked" },
  ]);
  assert.equal(P.next(P.parse(y)).id, "t2");
  assert.equal(P.command(P.parse(y)), "run plan web-52");
  assert.equal(P.command(P.parse("tasks:\n  - id: a\n    status: completed\n  - id: b\n")), "run task b", "no plan id");
  assert.equal(P.command(P.parse("tasks:\n  - id: a\n    status: done\n")), "", "all done");
  assert.equal(P.parse("no tasks here"), null);
  assert.equal(P.parse("tasks:\n"), null);
});

test("#20: History filter names agent folder numbers from /agents", () => {
  const H = page45("historyfilter.js").AgentHistoryFilter;
  const names = H.names({ github: 1, spark: 2 }, [{ id: "github", name: "GitHub" }, { id: "spark", name: "SPARK" }, { id: "x", name: "X" }]);
  assert.deepEqual(plain45(names), { 1: "GitHub", 2: "SPARK" });
});

test("#45 / #46: the Worker passes starters and plans on; /agents answers folder numbers; the default agent can be configured", async () => {
  const data = normalizeConfig({ people: {}, agents: { spark: { starters: [" Summarise my day ", "", 7], plans: true }, github: { starters: ["Hi"] } } });
  assert.deepEqual(data.agents.spark, { starters: ["Summarise my day"], plans: true });
  const reg = agentRegistry(await configEnv(env, { data }, ""));
  const gh = reg.find((a) => a.id === "github");
  assert.ok(gh, "configuring the default agent keeps it");
  assert.equal(gh.secret, "s1", "default agent falls back to DIRECTLINE_SECRET");
  assert.equal(gh.num, 1);
  assert.deepEqual(publicAgent(gh).starters, ["Hi"]);
  assert.equal(publicAgent(gh).plans, undefined);
  const sp = publicAgent(reg.find((a) => a.id === "spark"));
  assert.deepEqual(sp.starters, ["Summarise my day"]);
  assert.equal(sp.plans, true);
  const a = await (await worker.fetch(req("/agents", "owner-code"), env)).json();
  assert.deepEqual(a.nums, { github: 1, spark: 2, conductor: 3 });
});
