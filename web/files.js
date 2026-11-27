/* agent-webchat attachments: agent size/type rules, ZIP (stored or deflate), splitting, artifact upload.
 * Works in browsers and in Node (tests). No dependencies. */
(function (root) {
  "use strict";

  var MiB = 1048576;
  // Copilot Studio "file input" documented types (docs/README.md -> Attachments)
  var DEFAULT_TYPES = ["docx", "csv", "pdf", "txt", "jpg", "jpeg", "png", "webp", "gif"];

  // ---------- CRC32 + ZIP ----------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = -1;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  /** Raw DEFLATE via the browser's CompressionStream; null when unavailable. */
  function deflateRaw(bytes) {
    if (typeof CompressionStream !== "function") return Promise.resolve(null);
    try {
      var cs = new CompressionStream("deflate-raw");
      var out = new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
      return out.then(function (b) { return new Uint8Array(b); }, function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  /**
   * entries: [{name, data: Uint8Array, deflated?: Uint8Array}] -> Uint8Array (a complete .zip).
   * An entry is stored DEFLATEd only when that is actually smaller. UTF-8 names. No zip64 (entries < 4 GiB).
   */
  function makeZip(entries, when) {
    var dt = dosTime(when || new Date());
    var enc = new TextEncoder();
    var locals = [], centrals = [], offset = 0;
    entries.forEach(function (e) {
      var name = enc.encode(e.name);
      var useDeflate = e.deflated && e.deflated.length < e.data.length;
      var body = useDeflate ? e.deflated : e.data;
      var crc = crc32(e.data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, useDeflate ? 8 : 0, true); lh.setUint16(10, dt.time, true); lh.setUint16(12, dt.date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, e.data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, useDeflate ? 8 : 0, true); ch.setUint16(12, dt.time, true); ch.setUint16(14, dt.date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, e.data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      locals.push(new Uint8Array(lh.buffer), name, body);
      centrals.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + body.length;
    });
    var cdSize = centrals.reduce(function (s, a) { return s + a.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    var parts = locals.concat(centrals, [new Uint8Array(end.buffer)]);
    var out = new Uint8Array(offset + cdSize + 22), p = 0;
    parts.forEach(function (a) { out.set(a, p); p += a.length; });
    return out;
  }

  // ---------- rules ----------
  function ext(name) { var m = /\.([A-Za-z0-9]+)$/.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
  function limits(cfg) {
    cfg = cfg || {};
    return {
      maxBytes: Math.floor((cfg.agentMaxFileMB || 3.8) * MiB), // per message (Direct Line upload: 4 MB)
      maxParts: cfg.agentMaxParts || 10,
      types: (cfg.agentFileTypes || DEFAULT_TYPES).map(function (t) { return String(t).toLowerCase(); })
    };
  }
  function fmt(n) { return n >= MiB ? (n / MiB).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B"; }
  function bytesOf(blob) { return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function partLabel(base, i, n) {
    var w = Math.max(2, String(n).length);
    return base + ".part" + String(i).padStart(w, "0") + "of" + String(n).padStart(w, "0");
  }

  /**
   * How a file reaches the agent:
   *   as-is  supported type and small enough
   *   zip    unsupported type, or too large but compresses under the limit -> name.zip
   *   parts  too large: raw bytes split, each slice in its own zip -> name.part01of03.zip ...
   *   skip   would need more than maxParts messages (the original is still saved to GitHub)
   * file: Blob/File with .name. Returns {mode, reason, items:[{name, type, blob}]}.
   */
  function planDelivery(file, lim) {
    var name = file.name || "file";
    var supported = lim.types.indexOf(ext(name)) >= 0;
    var tooBig = "too large for chat (max " + fmt(lim.maxBytes) + " per message)";
    var reason = supported ? tooBig
      : "file type ." + (ext(name) || "?") + " is not supported by the agent" + (file.size > lim.maxBytes ? " and it is " + tooBig : "");
    if (supported && file.size <= lim.maxBytes) return Promise.resolve({ mode: "as-is", items: [{ name: name, type: file.type, blob: file }] });
    var whole = file.size <= lim.maxBytes * 4
      ? bytesOf(file).then(function (data) {
          return deflateRaw(data).then(function (d) { return makeZip([{ name: name, data: data, deflated: d }]); });
        })
      : Promise.resolve(null);
    return whole.then(function (zip) {
      if (zip && zip.length <= lim.maxBytes) {
        return { mode: "zip", reason: reason, items: [{ name: name + ".zip", type: "application/zip", blob: new Blob([zip], { type: "application/zip" }) }] };
      }
      var chunk = lim.maxBytes - 1024; // room for the zip headers
      var n = Math.ceil(file.size / chunk);
      if (n > lim.maxParts) return { mode: "skip", reason: reason + "; it would need " + n + " messages (limit " + lim.maxParts + ")", items: [] };
      var items = [], chain = Promise.resolve();
      for (var i = 1; i <= n; i++) (function (i) {
        chain = chain.then(function () { return bytesOf(file.slice((i - 1) * chunk, i * chunk)); }).then(function (data) {
          var label = partLabel(name, i, n);
          items.push({ name: label + ".zip", type: "application/zip", blob: new Blob([makeZip([{ name: label, data: data }])], { type: "application/zip" }) });
        });
      })(i);
      return chain.then(function () { return { mode: "parts", reason: reason, items: items }; });
    });
  }

  /** Group items into messages whose attachments together stay under maxBytes. */
  function batch(items, maxBytes) {
    var out = [], cur = [], size = 0;
    items.forEach(function (it) {
      var s = it.blob.size;
      if (cur.length && size + s > maxBytes) { out.push(cur); cur = []; size = 0; }
      cur.push(it); size += s;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  function describe(file, plan, art) {
    var bits = [];
    if (plan.mode === "zip") bits.push(plan.reason + ", so it was sent as **" + plan.items[0].name + "**");
    else if (plan.mode === "parts") bits.push(plan.reason + ", so it was sent as " + plan.items.length + " zip parts (" + plan.items[0].name + " … " + plan.items[plan.items.length - 1].name + "); unzip each and join the pieces in order");
    else if (plan.mode === "skip") bits.push(plan.reason + ", so it was NOT sent in chat");
    if (art && art.folder) bits.push("full original saved to GitHub **" + art.repo + "** → `" + art.folder + "/`" + (art.parts > 1 ? " in " + art.parts + " parts" : "") + " (MANIFEST.md lists names and SHA-256)");
    if (!bits.length) return "";
    return "- " + (file.name || "file") + " (" + fmt(file.size) + "): " + bits.join("; ") + ".";
  }

  // ---------- artifact upload (to the Worker) ----------
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function sha256(blob) {
    if (!(root.crypto && root.crypto.subtle)) return Promise.resolve("");
    return blob.arrayBuffer().then(function (b) { return root.crypto.subtle.digest("SHA-256", b); }).then(hex, function () { return ""; });
  }
  function base64(blob) {
    if (typeof FileReader === "function") {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { var s = String(r.result); resolve(s.slice(s.indexOf(",") + 1)); };
        r.onerror = function () { reject(r.error); };
        r.readAsDataURL(blob);
      });
    }
    return blob.arrayBuffer().then(function (b) {
      var u = new Uint8Array(b), bin = "";
      for (var i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(bin);
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** ctx: {base, code, conversationId, person}. Resolves to the /artifact begin answer or null when disabled. */
  function beginArtifact(ctx, file) {
    return fetch(ctx.base + "/artifact", {
      method: "POST",
      headers: { "X-Access-Code": ctx.code, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "begin", conversationId: ctx.conversationId, name: file.name || "file", size: file.size, type: file.type })
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || "HTTP " + r.status); e.code = j.error; throw e; } return j.enabled ? j : null; }); });
  }

  /** Uploads every part (create-only, retried on conflicts), then MANIFEST.md. onState(text). */
  function uploadArtifact(ctx, file, art, onState) {
    var n = art.parts, pb = art.partBytes, results = [];
    var chain = Promise.resolve();
    for (var i = 1; i <= n; i++) (function (i) {
      chain = chain.then(function () {
        var slice = file.slice((i - 1) * pb, i * pb);
        onState && onState("Saving " + (file.name || "file") + (n > 1 ? " part " + i + "/" + n : "") + "…");
        return Promise.all([base64(slice), sha256(slice)]).then(function (v) {
          var msg = "webchat upload: " + (file.name || "file") + (n > 1 ? " part " + i + "/" + n : "");
          var body = new Blob(['{"message":', JSON.stringify(msg), ',"content":"', v[0], '"}'], { type: "application/json" });
          var qs = "conversationId=" + encodeURIComponent(ctx.conversationId) + "&uploadId=" + encodeURIComponent(art.uploadId) +
            "&name=" + encodeURIComponent(file.name || "file") + "&i=" + i + "&n=" + n;
          var attempt = function (k) {
            return fetch(ctx.base + "/artifact/put?" + qs, { method: "POST", headers: { "X-Access-Code": ctx.code, "Content-Type": "application/json" }, body: body })
              .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); },
                function () { return { status: 0, j: { retry: true } }; })
              .then(function (res) {
                if (res.j.ok) return true;
                if (k < 4 && (res.j.retry || res.status === 429 || res.status === 0)) return sleep(2000 * (k + 1)).then(function () { return attempt(k + 1); });
                return false;
              });
          };
          return attempt(0).then(function (ok) { results.push({ bytes: slice.size, sha256: v[1], ok: ok }); });
        });
      });
    })(i);
    return chain
      .then(function () { return file.size <= 256 * MiB ? sha256(file) : ""; })
      .then(function (whole) {
        return fetch(ctx.base + "/artifact", {
          method: "POST",
          headers: { "X-Access-Code": ctx.code, "Content-Type": "application/json" },
          body: JSON.stringify({ op: "manifest", conversationId: ctx.conversationId, uploadId: art.uploadId, name: file.name || "file", size: file.size, type: file.type, sha256: whole, parts: results })
        }).then(function (r) { return r.ok; }, function () { return false; });
      })
      .then(function (manifestOk) {
        var ok = results.every(function (r) { return r.ok; }) && manifestOk;
        return { ok: ok, saved: results.filter(function (r) { return r.ok; }).length, parts: n };
      });
  }

  root.AgentFiles = {
    crc32: crc32, makeZip: makeZip, deflateRaw: deflateRaw, ext: ext, limits: limits, planDelivery: planDelivery,
    batch: batch, describe: describe, beginArtifact: beginArtifact, uploadArtifact: uploadArtifact, fmt: fmt, DEFAULT_TYPES: DEFAULT_TYPES
  };
})(typeof window !== "undefined" ? window : globalThis);
