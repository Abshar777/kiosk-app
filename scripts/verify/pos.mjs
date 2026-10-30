/** End-to-end card-present sale against the mock terminal. */
const API = "http://localhost:4000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// Admin endpoints now need a session cookie.
let ADMIN_COOKIE = "";

const j = async (path, init) => {
  const r = await fetch(API + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(ADMIN_COOKIE ? { Cookie: ADMIN_COOKIE } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (label, ok, detail = "") => {
  results.push([label, ok, detail]);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// 0. Sign in so the admin calls below are authorised.
{
  const r = await fetch(API + "/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  ADMIN_COOKIE = (r.headers.get("set-cookie") ?? "").split(";")[0];
  check("admin sign-in for setup", r.status === 200 && ADMIN_COOKIE !== "");
}

// 1. Enable the card machine on the mock transport.
const cfg = await j("/api/admin/config", {
  method: "PATCH",
  body: JSON.stringify({
    pos: { isEnabled: true, transport: "mock", merchantId: "MID001", terminalId: "TID001" },
  }),
});
check("config accepts pos settings", cfg.status === 200 && cfg.body?.pos?.isEnabled === true,
  `transport=${cfg.body?.pos?.transport}`);

// Nested defaults must survive a partial patch.
check("partial patch keeps serial defaults", cfg.body?.pos?.serial?.baudRate === 9600,
  `baudRate=${cfg.body?.pos?.serial?.baudRate}`);

// 2. The gateway must now be offered.
const gw = await j("/api/payments/gateways");
const pos = gw.body?.items?.find((g) => g.id === "pos_terminal");
check("pos_terminal offered when enabled", Boolean(pos), pos ? `testMode=${pos.isTestMode}` : "absent");

// 3. Create an enrollment with an amount that forces approval (.00).
const courses = await j("/api/courses?pageSize=50");
const course = courses.body?.items?.find((c) => Number.isInteger(c.price));
if (!course) { console.log("no integer-priced course"); process.exit(1); }

const enr = await j("/api/enrollments", {
  method: "POST",
  body: JSON.stringify({ courseId: course.id, fullName: "Card Tester", mobile: "9876500099" }),
});
check("enrollment created", enr.status === 201, enr.body?.enrollmentId);
const enrollmentId = enr.body?.enrollmentId;

// 4. Start the sale.
const start = await j("/api/payments/pos/sale", {
  method: "POST",
  body: JSON.stringify({ enrollmentId }),
});
check("sale started", start.status === 201, `state=${start.body?.state}`);
const saleId = start.body?.saleId;

// 5. Starting again must rejoin, not double-charge.
const again = await j("/api/payments/pos/sale", {
  method: "POST",
  body: JSON.stringify({ enrollmentId }),
});
check("restart rejoins the same sale (no double prompt)", again.body?.saleId === saleId,
  `${again.body?.saleId === saleId ? "same id" : "DIFFERENT id"}`);

// 6. Poll to completion.
let status = start.body;
const seen = [status.state];
for (let i = 0; i < 40 && !status.isTerminal; i++) {
  await wait(400);
  const p = await j(`/api/payments/pos/sale/${saleId}`);
  status = p.body;
  if (seen.at(-1) !== status.state) seen.push(status.state);
}
check("sale reached a final state", status.isTerminal === true, `states: ${seen.join(" → ")}`);
check("sale approved", status.state === "approved", `instrument=${status.instrument} auth=${status.authCode}`);
check("no raw PAN in status", !/\b\d{13,19}\b/.test(JSON.stringify(status)));

// 7. Payment + enrollment must both be settled.
const after = await j(`/api/enrollments/${enrollmentId}`);
check("enrollment confirmed", after.body?.enrollment?.status === "confirmed",
  `status=${after.body?.enrollment?.status}`);
check("payment recorded as card_present", after.body?.payment?.method === "card_present",
  `method=${after.body?.payment?.method} status=${after.body?.payment?.status}`);
check("payment amount matches course price", after.body?.payment?.amount === course.price,
  `${after.body?.payment?.amount} vs ${course.price}`);

// 8. Receipt must build.
const rec = await j(`/api/enrollments/${enrollmentId}/receipt`);
check("receipt available", rec.status === 200, rec.body?.enrollment?.enrollmentId);

// 9. Disabling hides the gateway again.
await j("/api/admin/config", { method: "PATCH", body: JSON.stringify({ pos: { isEnabled: false } }) });
const gw2 = await j("/api/payments/gateways");
check("pos_terminal hidden when disabled",
  !gw2.body?.items?.some((g) => g.id === "pos_terminal"));

const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll card-present checks passed.");
process.exit(failed ? 1 : 0);
