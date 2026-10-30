/**
 * Drives the LAN transport against a fake TCP terminal, including the two
 * things that break naive socket code: frames split across packets, and two
 * frames arriving in one packet.
 */
import { createPosSession } from "../../backend/src/lib/pos/index.ts";
import { buildFrame, parseFrame, computeLrc, STX, ETX } from "../../backend/src/lib/pos/genericEcr.ts";

const results = [];
const check = (l, ok, d = "") => { results.push(ok); console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- frame codec --------------------------------------------------------
const f = buildFrame("SALE|REF1|1200|AED|MID|TID");
check("frame starts STX / ends with LRC", f[0] === STX && f[f.length - 2] === ETX);
const parsed = parseFrame(f);
check("round-trips", parsed.ok && parsed.payload === "SALE|REF1|1200|AED|MID|TID", parsed.ok ? "" : parsed.reason);

const corrupt = Uint8Array.from(f); corrupt[corrupt.length - 1] ^= 0xff;
check("rejects bad LRC", parseFrame(corrupt).ok === false);
check("rejects truncated frame", parseFrame(f.subarray(0, 3)).ok === false);
check("decode never throws on garbage", (() => {
  try { const r = parseFrame(Uint8Array.from([1,2,3,4])); return r.ok === false; } catch { return false; }
})());

// --- fake terminal ------------------------------------------------------
let mode = "split";
let replyCode = "00";
const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    data(socket, data) {
      const p = parseFrame(data);
      const payload = p.ok ? p.payload : "";
      if (payload.startsWith("ECHO")) { socket.write(buildFrame("STATUS|OK|ready")); return; }
      if (payload.startsWith("SALE")) {
        const status = buildFrame("STATUS|REF1|WAIT_CARD|Present card||");
        const result = buildFrame(
          replyCode === "00"
            ? "RESULT|REF1|00|Approved|4242424242424242|123456"
            : `RESULT|REF1|${replyCode}|||`,
        );
        if (mode === "split") {
          // Deliberately tear the first frame across two packets.
          socket.write(status.subarray(0, 4));
          setTimeout(() => socket.write(status.subarray(4)), 30);
          setTimeout(() => socket.write(result), 80);
        } else {
          // Both frames in one packet.
          const merged = new Uint8Array(status.length + result.length);
          merged.set(status); merged.set(result, status.length);
          socket.write(merged);
        }
      }
    },
  },
});

const base = {
  isEnabled: true, transport: "lan",
  lan: { host: "127.0.0.1", port: server.port },
  serial: { path: "", baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" },
  merchantId: "MID", terminalId: "TID",
  saleTimeoutSeconds: 10, pollIntervalMs: 200, terminalPrintsSlip: true,
};

// probe
{
  const s = createPosSession(base);
  const t0 = Date.now();
  await s.transport.probe(5000);
  check("probe succeeds against a live socket", true, `${Date.now() - t0}ms`);
  await s.transport.close();
}

// split frames
for (const m of ["split", "merged"]) {
  mode = m;
  const s = createPosSession(base);
  await s.transport.open();
  const reply1 = s.protocol.decode(await s.transport.send(s.protocol.encodeSale({
    amountMinor: 1200, currency: "AED", reference: "REF1", merchantId: "MID", terminalId: "TID",
  }), 5000));
  check(`${m}: first reply decodes`, reply1.state === "waiting_for_card", `state=${reply1.state}`);
  const reply2 = s.protocol.decode(await s.transport.receive(5000));
  check(`${m}: second reply decodes`, reply2.state === "approved", `state=${reply2.state} instr=${reply2.instrument}`);
  await s.transport.close();
}

// declined + unknown code
{
  const s = createPosSession(base);
  await s.transport.open();
  replyCode = "51";
  mode = "merged";
  s.protocol.decode(await s.transport.send(s.protocol.encodeSale({
    amountMinor: 1200, currency: "AED", reference: "REF1", merchantId: "MID", terminalId: "TID",
  }), 5000));
  const declined = s.protocol.decode(await s.transport.receive(5000));
  check("declined card maps to declined", declined.state === "declined",
    `state=${declined.state} reason=${declined.failureReason}`);
  check("declined carries no auth code", declined.authCode === null);
  await s.transport.close();

  const s2 = createPosSession(base);
  await s2.transport.open();
  replyCode = "ZZ";
  s2.protocol.decode(await s2.transport.send(s2.protocol.encodeSale({
    amountMinor: 1200, currency: "AED", reference: "REF1", merchantId: "MID", terminalId: "TID",
  }), 5000));
  const unknown = s2.protocol.decode(await s2.transport.receive(5000));
  check("UNKNOWN result code is an error, never an approval", unknown.state === "error",
    `state=${unknown.state}`);
  await s2.transport.close();
  replyCode = "00";
}

// unreachable
{
  const s = createPosSession({ ...base, lan: { host: "127.0.0.1", port: 1 } });
  let code = null;
  try { await s.transport.probe(3000); } catch (e) { code = e.code ?? e.name; }
  check("unreachable port rejects with UNREACHABLE", code === "UNREACHABLE", `got ${code}`);
  await s.transport.close().catch(() => {});
}

// timeout
{
  const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const s = createPosSession({ ...base, lan: { host: "127.0.0.1", port: silent.port } });
  await s.transport.open();
  let code = null;
  try { await s.transport.send(s.protocol.encodeProbe(), 600); } catch (e) { code = e.code ?? e.name; }
  check("silent terminal times out", code === "TIMEOUT", `got ${code}`);
  await s.transport.close();
  silent.stop();
}

// idempotent close
{
  const s = createPosSession(base);
  await s.transport.open();
  await s.transport.close();
  let threw = false;
  try { await s.transport.close(); } catch { threw = true; }
  check("close() is safe twice", !threw);
}

// not configured
{
  let code = null;
  try { createPosSession({ ...base, lan: { host: "", port: 0 } }); } catch (e) { code = e.code; }
  check("blank host rejects as NOT_CONFIGURED", code === "NOT_CONFIGURED", `got ${code}`);
}

server.stop();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} failed` : "\nAll LAN transport checks passed.");
process.exit(failed ? 1 : 0);
