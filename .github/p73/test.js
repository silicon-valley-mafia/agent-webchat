test("match (owner test 07:00 IST): reply starting with a ```verilog fence, prompt with a session header, alert titles", () => {
  // the agent reply exactly as logged (logs/1/2026-11-28/0659-.../0003-070018-agent.md)
  const bot = { id: "b", type: "message", timestamp: "t", from: { role: "bot" },
    text: "```verilog\nmodule top(input clk); // counter\n  reg [3:0] q;\nendmodule\n```\n> [!WARNING]\n> There's no reset, so `q` gets its start value\n\n- [x] done\n- [ ] todo\n" };
  // what Web Chat shows: no fence line, alert title "⚠️ Warning" instead of [!WARNING]
  assert.equal(T.match([bot], "module top(input clk); // counter\n  reg [3:0] q;\nendmodule\n\u26a0\ufe0f Warning\nThere's no reset", false).id, "b");
  const alertFirst = { ...bot, id: "c", text: "> [!NOTE]\n> Read this first, then the code below" };
  assert.equal(T.match([alertFirst], "\u24d8 Note\nRead this first, then the code below", false).id, "c");
  // first prompt of a chat: the Worker's session header is in the stored text, not on screen
  const user = { id: "u", type: "message", timestamp: "t", from: { role: "user" },
    text: "[session header]\nDeepesh, IST, admin\n[end of header]\n\n[route: coach]\nreply with a Verilog block and a > [!WARNING]:\n\n```verilog\nmodule top" };
  assert.equal(T.match([user], "reply with a Verilog block and a > [!WARNING]:", true).id, "u");
  assert.equal(T.match([user], user.text, true).id, "u", "raw text kept on the bubble matches too");
  // escaped replies (#24a): the original text is used
  const esc = { ...bot, id: "e", text: "run plan \\<id\\>", channelData: { awOriginalText: "run plan <id> now" } };
  assert.equal(T.match([esc], "run plan <id> now", false).id, "e");
  assert.equal(T.norm("\u26a0\ufe0f Warning: Größe 3"), "warninggröße3", "symbols dropped, letters in any script kept");
});

