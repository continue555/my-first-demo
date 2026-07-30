const http = require("http");

const BASE = "http://localhost:3000";
let passed = 0, failed = 0, token = "";

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const options = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
      headers: { "Content-Type": "application/json" }
    };
    if (token) options.headers["Authorization"] = "Bearer " + token;
    const r = http.request(options, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function test(name, fn) {
  try {
    const r = await fn();
    if (r && r.error) { failed++; console.log("  [FAIL] " + name + ": " + r.error); return; }
    passed++; console.log("  [PASS] " + name);
  } catch (e) { failed++; console.log("  [FAIL] " + name + ": " + e.message); }
}

async function main() {
  console.log("=== 吹瓶机管理系统 - API 测试 ===\n");

  await test("Health check", async () => { const r = await req("GET", "/api/health"); return r.body.status === "ok" ? r.body : { error: "not ok" }; });
  if (failed > 0) { console.log("\n服务器未启动，测试终止"); process.exit(1); }

  const login = await req("POST", "/api/auth/login", { username: "admin", password: "123456" });
  token = login.body.token;
  await test("Login", async () => login.body.user ? {} : { error: "login failed" });
  if (!token) { console.log("\n登录失败，测试终止"); process.exit(1); }

  await test("Stats", async () => { const r = await req("GET", "/api/orders/stats"); return r.body.stats ? {} : { error: "no stats" }; });
  await test("Orders list", async () => { const r = await req("GET", "/api/orders?limit=3"); return r.body.orders ? {} : { error: "no orders" }; });
  await test("Create order", async () => { const r = await req("POST", "/api/orders", { customer_name: "Test", project_name: "Test" }); return r.body.orderId ? {} : { error: "create failed" }; });
  await test("Order detail (18 stages)", async () => { const r = await req("GET", "/api/orders/2"); return r.body.stages && r.body.stages.length === 18 ? {} : { error: "expected 10+ stages" }; });
  await test("Stage start", async () => { const r = await req("PUT", "/api/orders/2/stages/manufacturing_approval", { status: "in_progress" }); return r.body.message ? {} : { error: "start failed" }; });
  await test("Stage complete", async () => { const r = await req("PUT", "/api/orders/2/stages/manufacturing_approval", { status: "completed" }); return r.body.message ? {} : { error: "complete failed" }; });
  await test("Notifications", async () => { const r = await req("GET", "/api/notifications"); return r.body.notifications ? {} : { error: "no notifs" }; });
  await test("Export single order", async () => { const r = await req("GET", "/api/export/order/2"); return r.status === 200 ? {} : { error: "export failed" }; });
  await test("Permission (finance denied)", async () => {
    const r2 = await req("POST", "/api/auth/login", { username: "caiwu1", password: "123456" });
    const oldToken = token; token = r2.body.token;
    const r3 = await req("POST", "/api/orders", { customer_name: "X", project_name: "Y" });
    token = oldToken;
    return r3.body.error ? {} : { error: "finance should be denied" };
  });
  await test("Departments (10 depts)", async () => { const r = await req("GET", "/api/departments"); return r.body.departments && r.body.departments.length >= 9 ? {} : { error: "expected 8+ depts" }; });
    await test("Overdue check", async () => { const r = await req("POST", "/api/notifications/check-overdue"); return typeof r.body.checked !== "undefined" ? {} : { error: "overdue check failed" }; });
  await test("Users list (admin)", async () => { const r = await req("GET", "/api/auth/users"); return r.body.users ? {} : { error: "no users" }; });
  await test("Audit log", async () => { const r = await req("GET", "/api/audit"); return r.body.logs ? {} : { error: "no logs" }; });

  console.log("\n=== 结果: " + passed + "/" + (passed+failed) + " 通过 ===");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("测试异常:", e.message); process.exit(1); });
