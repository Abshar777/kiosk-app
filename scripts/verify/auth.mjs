const API = "http://localhost:4000";
const PW = process.env.ADMIN_PASSWORD ?? "";
const results = [];
const check = (l, ok, d = "") => { results.push(ok); console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? ` — ${d}` : ""}`); };

const call = async (path, init = {}, cookie = null) => {
  const r = await fetch(API + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { status: r.status, setCookie: r.headers.get("set-cookie"), body: await r.json().catch(() => null) };
};

// 1. Admin endpoints must be closed to anonymous callers.
for (const path of ["/api/admin/stats", "/api/admin/enrollments", "/api/admin/payments",
                    "/api/admin/config", "/api/admin/logs", "/api/admin/pos/serial-ports"]) {
  const r = await call(path);
  check(`anonymous ${path} rejected`, r.status === 401, `got ${r.status}`);
}

// 2. The old header must not be a way in.
const hdr = await call("/api/admin/stats", { headers: { "X-Admin-Token": "anything" } });
check("legacy X-Admin-Token header does not authenticate", hdr.status === 401, `got ${hdr.status}`);

// 3. Uploads must be closed too.
const up = await call("/api/admin/uploads", { method: "POST" });
check("anonymous upload rejected", up.status === 401, `got ${up.status}`);

// 4. Wrong password is refused.
const bad = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) });
check("wrong password refused", bad.status === 401, `got ${bad.status}`);
check("no cookie issued on failure", !bad.setCookie);

// 5. Correct password issues a hardened cookie.
const ok = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ password: PW }) });
check("correct password accepted", ok.status === 200, `got ${ok.status}`);
const cookie = (ok.setCookie ?? "").split(";")[0];
check("cookie is HttpOnly", /HttpOnly/i.test(ok.setCookie ?? ""));
check("cookie is SameSite=Strict", /SameSite=Strict/i.test(ok.setCookie ?? ""));
check("session token is signed, not a raw secret", !(ok.setCookie ?? "").includes(PW));

// 6. The session opens the admin API.
const stats = await call("/api/admin/stats", {}, cookie);
check("session grants access to admin API", stats.status === 200,
  `courses=${stats.body?.totalCourses} enrollments=${stats.body?.totalEnrollments}`);

// 7. A tampered cookie must not.
const tampered = cookie.slice(0, -3) + "aaa";
const badCookie = await call("/api/admin/stats", {}, tampered);
check("tampered cookie rejected", badCookie.status === 401, `got ${badCookie.status}`);

// 8. Session endpoint reports accurately.
const s1 = await call("/api/admin/session", {}, cookie);
const s2 = await call("/api/admin/session");
check("session endpoint true when signed in", s1.body?.isAuthenticated === true);
check("session endpoint false when anonymous", s2.body?.isAuthenticated === false);

// 9. Logout clears it.
const out = await call("/api/admin/logout", { method: "POST" }, cookie);
check("logout clears the cookie", /Max-Age=0/.test(out.setCookie ?? ""));

// 10. The public kiosk must be unaffected.
for (const path of ["/api/config", "/api/courses?pageSize=1", "/api/categories", "/api/payments/gateways"]) {
  const r = await call(path);
  check(`public ${path.split("?")[0]} still open`, r.status === 200, `got ${r.status}`);
}

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} failed` : "\nAll auth checks passed.");
process.exit(failed ? 1 : 0);
