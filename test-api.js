const http = require("http");

const STAGE_DEFINITIONS = require("./shared/stage-defs.json");
const ExcelJS = require("exceljs");
const BASE = "http://localhost:3000";
let passed = 0, failed = 0, token = "", createdOrderId = null, roleOrderId = null, todoOrderId = null, testFileId = null;

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

async function rawFetch(method, path, body) {
  const headers = { Authorization: "Bearer " + token };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buffer, headers: res.headers };
}

async function uploadFile(orderId, filename) {
  const form = new FormData();
  form.append("file", new Blob(["hello"], { type: "text/plain" }), filename);
  const res = await fetch(BASE + `/api/orders/${orderId}/files`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: form
  });
  return { status: res.status, body: await res.json() };
}

async function loginUser(username, password) {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const body = await res.json();
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  for (const cookie of setCookies) {
    const match = cookie.match(/token=([^;]+)/);
    if (match) {
      token = decodeURIComponent(match[1]);
      break;
    }
  }
  return { status: res.status, body };
}

async function main() {
  console.log("=== 吹瓶机管理系统 - API 测试 ===\n");

  await test("Health check", async () => { const r = await req("GET", "/api/health"); return r.body.status === "ok" ? r.body : { error: "not ok" }; });
  await test("Health check verifies database", async () => { const r = await req("GET", "/api/health"); return r.body.db === "ok" ? {} : { error: "db not ok: " + r.body.db }; });
  await test("Uploads directory not publicly served", async () => { const r = await req("GET", "/uploads/export-jobs/export_1.xlsx"); return r.status === 404 ? {} : { error: "expected 404, got " + r.status }; });
  await test("Missing asset returns 404", async () => { const r = await req("GET", "/assets/__missing__.js"); return r.status === 404 ? {} : { error: "expected 404, got " + r.status }; });
  await test("Stale asset alias serves JS", async () => { const r = await req("GET", "/assets/index-CI0-ZRJE.js"); return r.status === 200 && typeof r.body === "string" && r.body.includes("import") ? {} : { error: "stale alias failed" }; });
  await test("Unknown old asset alias serves JS", async () => { const r = await req("GET", "/assets/OrderDetail-UNKNOWN.js"); return r.status === 200 && typeof r.body === "string" && r.body.includes("export") ? {} : { error: "dynamic alias failed" }; });
  await test("Unknown old index alias serves entry", async () => { const r = await req("GET", "/assets/index-OLDHASH.js"); return r.status === 200 && typeof r.body === "string" && r.body.includes("mount") ? {} : { error: "index alias failed" }; });
  if (failed > 0) { console.log("\n服务器未启动，测试终止"); process.exit(1); }

  const login = await loginUser("admin", "123456");
  await test("Login", async () => login.body.user ? {} : { error: "login failed" });
  await test("Login response hides token", async () => { const r = await loginUser("admin", "123456"); return !("token" in r.body) ? {} : { error: "token still returned" }; });
  await test("Logout revokes token", async () => {
    const login = await loginUser("admin", "123456");
    if (!login.body.user || !token) return { error: "login failed" };
    const out = await req("POST", "/api/auth/logout");
    if (out.status !== 200) return { error: "logout failed" };
    const after = await req("GET", "/api/orders?limit=1");
    if (after.status !== 401) return { error: "expected 401 after logout, got " + after.status };
    const relogin = await loginUser("admin", "123456");
    return relogin.body.user ? {} : { error: "re-login failed" };
  });
  await test("Reset password revokes target session", async () => {
    const username = "resetuser_" + Date.now();
    const create = await req("POST", "/api/auth/register", { username, password: "123456", name: "ResetUser", role: "sales", department_id: 1 });
    if (create.status !== 201) return { error: "register failed: " + JSON.stringify(create.body) };
    const users = await req("GET", "/api/auth/users");
    const u = (users.body.users || []).find(x => x.username === username);
    if (!u) return { error: "user not found" };
    const oldToken = token;
    const target = await loginUser(username, "123456");
    if (!target.body.user) { token = oldToken; return { error: "target login failed" }; }
    const targetToken = token;
    token = oldToken;
    const reset = await req("PUT", `/api/auth/users/${u.id}/reset-password`, { newPassword: "654321" });
    if (reset.status !== 200) { token = oldToken; return { error: "reset failed: " + JSON.stringify(reset.body) }; }
    token = targetToken;
    const after = await req("GET", "/api/orders?limit=1");
    token = oldToken;
    if (after.status !== 401) return { error: "expected 401 after reset, got " + after.status };
    const del = await req("DELETE", `/api/auth/users/${u.id}`);
    return del.status === 200 ? {} : { error: "cleanup failed" };
  });
  if (!token) { console.log("\n登录失败，测试终止"); process.exit(1); }

  await test("Stats", async () => { const r = await req("GET", "/api/orders/stats"); return r.body.stats ? {} : { error: "no stats" }; });
  await test("Stats has overdue and no cancelled", async () => { const r = await req("GET", "/api/orders/stats"); return !("cancelled" in r.body.stats) && typeof r.body.stats.overdue === "number" ? {} : { error: "stats mismatch" }; });
  await test("Orders list", async () => { const r = await req("GET", "/api/orders?limit=3"); return r.body.orders ? {} : { error: "no orders" }; });
  await test("Orders list has current stage", async () => {
    const orderNo = "CUR-" + Date.now();
    const created = await req("POST", "/api/orders", { order_no: orderNo, customer_name: "CurTest", project_name: "CurTest", planned_delivery_date: "2026-08-10" });
    if (created.status !== 201 || !created.body.orderId) return { error: "current stage order create failed" };
    const list = await req("GET", `/api/orders?search=${encodeURIComponent(orderNo)}`);
    const row = (list.body.orders || []).find(o => o.id === created.body.orderId);
    const ok = row && row.current_stage && row.current_stage.stage_name === "签订合同" && typeof row.progress === "number";
    await req("DELETE", `/api/orders/${created.body.orderId}`).catch(() => {});
    return ok ? {} : { error: "current_stage missing" };
  });
  const customNo = "TEST-" + Date.now();
  const autoTimeStages = new Set([
    "frame_follow_up", "mold_frame_follow_up", "electrical_follow_up",
    "cover_follow_up", "mold_design_follow_up", "material_in"
  ]);
  async function runStage(orderId, key) {
    if (key === "delivery_payment") {
      const timeRes = await req("PUT", `/api/orders/${orderId}/stages/${key}/time`, { planned_end_date: "2026-08-02T09:00" });
      if (timeRes.status !== 200) throw new Error(`time ${key}: ${JSON.stringify(timeRes.body)}`);
    } else if (!autoTimeStages.has(key)) {
      const timeRes = await req("PUT", `/api/orders/${orderId}/stages/${key}/time`, { start_date: "2026-08-01T09:00", planned_end_date: "2026-08-02T09:00" });
      if (timeRes.status !== 200) throw new Error(`time ${key}: ${JSON.stringify(timeRes.body)}`);
    }
    const startRes = await req("PUT", `/api/orders/${orderId}/stages/${key}`, { status: "in_progress" });
    if (startRes.status !== 200) throw new Error(`start ${key}: ${JSON.stringify(startRes.body)}`);
    const doneRes = await req("PUT", `/api/orders/${orderId}/stages/${key}`, { status: "completed" });
    if (doneRes.status !== 200) throw new Error(`done ${key}: ${JSON.stringify(doneRes.body)}`);
  }

  async function runStageAs(orderId, key, username) {
    if (key === "delivery_payment") {
      const timeRes = await req("PUT", `/api/orders/${orderId}/stages/${key}/time`, { planned_end_date: "2026-08-02T09:00" });
      if (timeRes.status !== 200) throw new Error(`time ${key}: ${JSON.stringify(timeRes.body)}`);
    } else if (!autoTimeStages.has(key)) {
      const timeRes = await req("PUT", `/api/orders/${orderId}/stages/${key}/time`, { start_date: "2026-08-01T09:00", planned_end_date: "2026-08-02T09:00" });
      if (timeRes.status !== 200) throw new Error(`time ${key}: ${JSON.stringify(timeRes.body)}`);
    }
    const oldToken = token;
    const login = await loginUser(username, "123456");
    if (!login.body.user || login.body.user.username !== username) {
      token = oldToken;
      throw new Error(`login failed as ${username}: ${JSON.stringify(login.body)}`);
    }
    const startRes = await req("PUT", `/api/orders/${orderId}/stages/${key}`, { status: "in_progress" });
    if (startRes.status !== 200) {
      token = oldToken;
      throw new Error(`start ${key} as ${username}: ${JSON.stringify(startRes.body)}`);
    }
    const doneRes = await req("PUT", `/api/orders/${orderId}/stages/${key}`, { status: "completed" });
    token = oldToken;
    if (doneRes.status !== 200) throw new Error(`done ${key} as ${username}: ${JSON.stringify(doneRes.body)}`);
  }

  await test("Create order with custom number", async () => {
    const r = await req("POST", "/api/orders", { order_no: customNo, customer_name: "Test", project_name: "Test", planned_delivery_date: "2026-08-10" });
    if (r.body.orderId) createdOrderId = r.body.orderId;
    return r.body.orderNo === customNo ? {} : { error: "create or custom number failed" };
  });
  await test("Duplicate order number rejected", async () => {
    const r = await req("POST", "/api/orders", { order_no: customNo, customer_name: "X", project_name: "Y", planned_delivery_date: "2026-08-10" });
    return r.status === 400 ? {} : { error: "expected 400, got " + r.status };
  });
  await test("Planned delivery date required", async () => { const r = await req("POST", "/api/orders", { customer_name: "Test", project_name: "Test" }); return r.status === 400 ? {} : { error: "expected 400, got " + r.status }; });
  await test("Invalid quantity rejected", async () => { const r = await req("POST", "/api/orders", { customer_name: "Test", project_name: "Test", quantity: -1, planned_delivery_date: "2026-08-10" }); return r.status === 400 ? {} : { error: "expected 400, got " + r.status }; });
  await test("No auto dates on create", async () => {
    const r = await req("GET", `/api/orders/${createdOrderId}`);
    const stage = (r.body.stages || []).find(s => s.stage_key === "contract_sign");
    return stage && !stage.planned_end_date ? {} : { error: "unexpected auto planned date" };
  });
  await test("Stage start without time rejected", async () => {
    const r = await req("PUT", `/api/orders/${createdOrderId}/stages/contract_sign`, { status: "in_progress" });
    return r.status === 400 ? {} : { error: "expected 400, got " + r.status };
  });
  await test("Order detail (23 stages)", async () => { const r = await req("GET", `/api/orders/${createdOrderId}`); return r.body.stages && r.body.stages.length === 23 ? {} : { error: "expected 23 stages" }; });
  await test("Debug stage renamed to 调试验收", async () => {
    const r = await req("GET", `/api/orders/${createdOrderId}`);
    const stage = (r.body.stages || []).find(s => s.stage_key === "debug");
    return stage && stage.stage_name === "调试验收" ? {} : { error: "debug stage name not updated" };
  });
  await test("Stage start", async () => { await req("PUT", `/api/orders/${createdOrderId}/stages/contract_sign/time`, { start_date: "2026-08-01T09:00", planned_end_date: "2026-08-02T09:00" }); const r = await req("PUT", `/api/orders/${createdOrderId}/stages/contract_sign`, { status: "in_progress" }); return r.body.message ? {} : { error: "start failed" }; });
  await test("Stage complete", async () => { const r = await req("PUT", `/api/orders/${createdOrderId}/stages/contract_sign`, { status: "completed" }); return r.body.message ? {} : { error: "complete failed" }; });
  await test("Next stage start auto-filled from actual completion", async () => {
    const r = await req("GET", `/api/orders/${createdOrderId}`);
    const contract = (r.body.stages || []).find(s => s.stage_key === "contract_sign");
    const deposit = (r.body.stages || []).find(s => s.stage_key === "deposit_confirm");
    const ok = deposit && deposit.start_date && contract && contract.actual_end_date &&
      String(deposit.start_date).slice(0, 10) === String(contract.actual_end_date).slice(0, 10);
    return ok ? {} : { error: "next stage start not auto-filled" };
  });
  await test("Full flow all 23 stages", async () => {
    const detail = await req("GET", `/api/orders/${createdOrderId}`);
    const statusMap = {};
    for (const s of detail.body.stages || []) statusMap[s.stage_key] = s.status;
    try {
      for (const stage of STAGE_DEFINITIONS) {
        if (statusMap[stage.key] === "completed") continue;
        await runStage(createdOrderId, stage.key);
      }
      return {};
    } catch (e) {
      return { error: e.message };
    }
  });
  await test("Role-driven full flow", async () => {
    const created = await req("POST", "/api/orders", { customer_name: "RoleTest", project_name: "RoleTest", planned_delivery_date: "2026-08-10" });
    if (!created.body.orderId) return { error: "role order create failed" };
    const orderId = created.body.orderId;
    roleOrderId = orderId;
    const roleMap = {
      contract_sign: "xiaoshou1",
      deposit_confirm: "caiwu1",
      manufacturing_approval: "shenpi1",
      gm_sign: "zongjingli",
      production_order: "xiaoshou1",
      technical_design: "jishu1",
      purchase_plan: "caigou1",
      purchase_frame: "caigou1",
      purchase_mold_frame: "caigou1",
      purchase_electrical: "caigou1",
      purchase_cover: "caigou1",
      mold_design_purchase: "mujv1",
      frame_follow_up: "wuliao1",
      mold_frame_follow_up: "wuliao1",
      electrical_follow_up: "wuliao1",
      cover_follow_up: "wuliao1",
      mold_design_follow_up: "wuliao1",
      material_in: "cangku1",
      warehouse_prepare: "cangku1",
      assembly: "zhuangpei1",
      debug: "tiaoshi1",
      delivery_payment: "caiwu1",
      shipping: "fahuo1"
    };
    try {
      for (const stage of STAGE_DEFINITIONS) {
        const username = roleMap[stage.key];
        if (username) await runStageAs(orderId, stage.key, username);
        else await runStage(orderId, stage.key);
      }
      return {};
    } catch (e) {
      return { error: e.message };
    }
  });
  await test("Todo order lifecycle", async () => {
    const orderNo = "TODO-" + Date.now();
    const created = await req("POST", "/api/orders", { order_no: orderNo, customer_name: "TodoTest", project_name: "TodoTest", planned_delivery_date: "2026-08-10" });
    if (created.status !== 201 || !created.body.orderId) return { error: "todo order create failed" };
    todoOrderId = created.body.orderId;

    const adminTodos = await req("GET", "/api/todos");
    const adminItem = (adminTodos.body.todos || []).find(t => t.order_id === todoOrderId);
    if (!adminItem || adminItem.category !== "ready" || adminItem.stage_name !== "签订合同") {
      return { error: "admin todo missing ready item: " + JSON.stringify(adminTodos.body) };
    }

    const oldToken = token;
    await loginUser("jishu1", "123456");
    const techTodos = await req("GET", "/api/todos");
    token = oldToken;
    if ((techTodos.body.todos || []).some(t => t.order_id === todoOrderId)) {
      return { error: "tech user saw out-of-dept todo" };
    }

    const timeRes = await req("PUT", `/api/orders/${todoOrderId}/stages/contract_sign/time`, { start_date: "2026-08-01T09:00", planned_end_date: "2026-08-02T09:00" });
    const s1 = await req("PUT", `/api/orders/${todoOrderId}/stages/contract_sign`, { status: "in_progress" });
    const s2 = await req("PUT", `/api/orders/${todoOrderId}/stages/contract_sign`, { status: "completed" });
    if (timeRes.status !== 200 || s1.status !== 200 || s2.status !== 200) {
      return { error: "contract sign advance failed" };
    }

    await loginUser("caiwu1", "123456");
    const financeTodos = await req("GET", "/api/todos");
    token = oldToken;
    const financeItem = (financeTodos.body.todos || []).find(t => t.order_id === todoOrderId);
    if (!financeItem || financeItem.category !== "ready" || financeItem.stage_name !== "财务确认定金") {
      return { error: "finance todo missing deposit item: " + JSON.stringify(financeTodos.body) };
    }
    return {};
  });
  await test("Attachment upload and preview", async () => {
    const filename = "\u6d4b\u8bd5\u9644\u4ef6.txt";
    const up = await uploadFile(createdOrderId, filename);
    if (up.status !== 201 || up.body.filename !== filename) return { error: "upload failed" };
    const files = await req("GET", `/api/orders/${createdOrderId}/files`);
    const file = (files.body.files || []).find(f => f.original_name === filename);
    if (!file) return { error: "file not found" };
    testFileId = file.id;
    const ticket = await req("GET", `/api/files/${file.id}/ticket`);
    if (ticket.status !== 200 || !ticket.body.url) return { error: "ticket failed" };
    const preview = await rawFetch("GET", ticket.body.url);
    if (preview.status !== 200) return { error: "preview failed" };
    return {};
  });
  await test("Non-admin can see attachment", async () => {
    if (!testFileId) return { error: "no test file" };
    const oldToken = token;
    const jishu = await loginUser("jishu1", "123456");
    const files = await req("GET", `/api/orders/${createdOrderId}/files`);
    token = oldToken;
    const visible = (files.body.files || []).some(f => f.id === testFileId);
    return visible ? {} : { error: "attachment should be visible" };
  });
  await test("Non-admin can preview attachment", async () => {
    if (!testFileId) return { error: "no test file" };
    const oldToken = token;
    const jishu = await loginUser("jishu1", "123456");
    const ticket = await req("GET", `/api/files/${testFileId}/ticket`);
    const preview = ticket.body.url ? await rawFetch("GET", ticket.body.url) : null;
    token = oldToken;
    if (!preview || preview.status !== 200) return { error: "non-admin preview failed" };
    return {};
  });
  await test("Non-sales cannot upload attachment", async () => {
    const oldToken = token;
    const jishu = await loginUser("jishu1", "123456");
    const up = await uploadFile(createdOrderId, "no-upload.txt");
    token = oldToken;
    return up.status === 403 ? {} : { error: "expected 403, got " + up.status };
  });
  await test("Upload to missing order rejected", async () => {
    const up = await uploadFile(999999, "missing-order.txt");
    return up.status === 404 && up.body.error === "订单不存在"
      ? {}
      : { error: "expected 404, got " + up.status + " " + JSON.stringify(up.body) };
  });
  await test("Non-admin cannot delete attachment", async () => {
    if (!testFileId) return { error: "no test file" };
    const oldToken = token;
    const jishu = await loginUser("jishu1", "123456");
    const del = await req("DELETE", `/api/files/${testFileId}`);
    token = oldToken;
    return del.status === 403 ? {} : { error: "expected 403, got " + del.status };
  });
  await test("Admin can delete attachment", async () => {
    if (!testFileId) return { error: "no test file" };
    const del = await req("DELETE", `/api/files/${testFileId}`);
    testFileId = null;
    return del.status === 200 ? {} : { error: "delete failed" };
  });
  await test("Notifications", async () => { const r = await req("GET", "/api/notifications"); return r.body.notifications ? {} : { error: "no notifs" }; });
  await test("Notification read isolation", async () => {
    const list = await req("GET", "/api/notifications?limit=500");
    const target = (list.body.notifications || []).find(n => n.recipient_dept_id === 4 && (n.order_id === createdOrderId || n.order_id === roleOrderId));
    if (!target) return { error: "no dept 4 notification" };
    const mark = await req("PUT", `/api/notifications/${target.id}/read`);
    if (mark.status !== 200) return { error: "mark failed" };
    const oldToken = token;
    const jishu = await loginUser("jishu1", "123456");
    const jishuList = await req("GET", "/api/notifications?limit=200");
    const jishuTarget = (jishuList.body.notifications || []).find(n => n.id === target.id);
    token = oldToken;
    if (!jishuTarget || jishuTarget.is_read !== 0) return { error: "read not isolated" };
    return {};
  });
  await test("Management role notification visible", async () => {
    const oldToken = token;
    const login = await loginUser("zongjingli", "123456");
    if (!login.body.user) { token = oldToken; return { error: "login failed" }; }
    const list = await req("GET", `/api/notifications?order_id=${createdOrderId}&limit=200`);
    token = oldToken;
    const n = (list.body.notifications || []).find(x => x.order_id === createdOrderId && x.recipient_role === "management");
    return n && n.message.includes("总经理签字") ? {} : { error: "management notification missing" };
  });
  await test("Non-management cannot see role notification", async () => {
    const oldToken = token;
    const jishu = await loginUser("jishu1", "123456");
    const list = await req("GET", `/api/notifications?order_id=${createdOrderId}&limit=200`);
    token = oldToken;
    const n = (list.body.notifications || []).find(x => x.order_id === createdOrderId && x.recipient_role === "management");
    return n ? { error: "role notification visible to non-management" } : {};
  });
  await test("Preview ticket endpoint", async () => { const r = await req("GET", "/api/files/999999/ticket"); return r.status === 404 ? {} : { error: "expected 404, got " + r.status }; });
  await test("Export contains order and stages", async () => {
    const res = await rawFetch("GET", `/api/export/order/${createdOrderId}`);
    if (res.status !== 200) return { error: "export failed" };
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.buffer);
      let text = "";
      for (const ws of wb.worksheets) ws.eachRow(row => row.eachCell(cell => { text += " " + cell.text; }));
      if (!text.includes(customNo) || !text.includes("签订合同")) return { error: "export content missing" };
      return {};
    } catch (e) {
      return { error: "excel parse failed: " + e.message };
    }
  });
  await test("Async export job", async () => {
    const create = await req("POST", "/api/export/jobs", { ids: [createdOrderId] });
    if (create.status !== 202 || !create.body.jobId) return { error: "job create failed" };
    let done = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const status = await req("GET", `/api/export/jobs/${create.body.jobId}`);
      if (status.body.status === "done") { done = true; break; }
      if (status.body.status === "error") return { error: "job error: " + (status.body.error || "") };
    }
    if (!done) return { error: "job timeout" };
    const dl = await rawFetch("GET", `/api/export/jobs/${create.body.jobId}/download`);
    return dl.status === 200 ? {} : { error: "download failed" };
  });
  await test("Cancelled export rejected", async () => { const r = await req("GET", "/api/export/orders?status=cancelled"); return r.status === 400 ? {} : { error: "expected 400, got " + r.status }; });
  await test("Delayed status rejected everywhere", async () => {
    const r1 = await req("POST", "/api/export/jobs", { status: "delayed" });
    const r2 = await req("PUT", `/api/orders/${createdOrderId}`, { status: "delayed" });
    return r1.status === 400 && r2.status === 400 ? {} : { error: "expected 400 for delayed, got " + r1.status + "/" + r2.status };
  });
  await test("Permission (finance denied)", async () => {
    const oldToken = token;
    const r2 = await loginUser("caiwu1", "123456");
    const r3 = await req("POST", "/api/orders", { customer_name: "X", project_name: "Y", planned_delivery_date: "2026-08-10" });
    token = oldToken;
    return r3.body.error ? {} : { error: "finance should be denied" };
  });
  await test("Departments (12 depts)", async () => { const r = await req("GET", "/api/departments"); return r.body.departments && r.body.departments.length >= 12 ? {} : { error: "expected 12 depts" }; });
    await test("Overdue check", async () => { const r = await req("POST", "/api/notifications/check-overdue"); return typeof r.body.checked !== "undefined" ? {} : { error: "overdue check failed" }; });
  await test("Users list (admin)", async () => { const r = await req("GET", "/api/auth/users"); return r.body.users ? {} : { error: "no users" }; });
  await test("User create and delete", async () => {
    const username = "testuser_" + Date.now();
    const create = await req("POST", "/api/auth/register", { username, password: "123456", name: "TestUser", role: "sales", department_id: 1 });
    if (create.status !== 201) return { error: "create failed: " + JSON.stringify(create.body) };
    const users = await req("GET", "/api/auth/users");
    const u = (users.body.users || []).find(x => x.username === username);
    if (!u) return { error: "user not found" };

    const oldToken = token;
    const targetLogin = await loginUser(username, "123456");
    if (!targetLogin.body.user) return { error: "test user login failed" };
    const up = await uploadFile(createdOrderId, "user-delete.txt");
    token = oldToken;
    if (up.status !== 201) return { error: "upload as test user failed" };

    const del = await req("DELETE", `/api/auth/users/${u.id}`);
    if (del.status !== 200) return { error: "delete failed" };

    const files = await req("GET", `/api/orders/${createdOrderId}/files`);
    const uploaded = (files.body.files || []).find(f => f.original_name === "user-delete.txt");
    if (!uploaded) return { error: "uploaded file missing after user delete" };
    if (uploaded.uploaded_by !== null || uploaded.uploader_name !== null) {
      return { error: "uploaded_by not cleaned after user delete" };
    }
    return {};
  });
  await test("Audit log", async () => { const r = await req("GET", "/api/audit"); return r.body.logs ? {} : { error: "no logs" }; });
  await test("Audit filter by order", async () => { const r = await req("GET", `/api/audit?order_id=${createdOrderId}`); return r.body.logs ? {} : { error: "audit filter failed" }; });
  await test("Audit filter by order number", async () => { const r = await req("GET", `/api/audit?order_no=${encodeURIComponent(customNo)}`); return r.body.logs ? {} : { error: "audit order_no filter failed" }; });

  await test("Invalid order list params are safe", async () => {
    const r1 = await req("GET", "/api/orders?page=abc&limit=abc");
    const r2 = await req("GET", "/api/orders?limit=-1");
    const r3 = await req("GET", "/api/orders?limit=100000");
    return r1.status === 200 && r2.status === 200 && r3.status === 200 && Array.isArray(r1.body.orders) ? {} : { error: "order list params not safe" };
  });
  await test("Order list invalid dates rejected", async () => {
    const r1 = await req("GET", "/api/orders?startDate=abc");
    const r2 = await req("GET", "/api/orders?endDate=abc");
    return r1.status === 400 && r2.status === 400 ? {} : { error: "invalid dates not rejected" };
  });
  await test("Audit invalid order id rejected", async () => {
    const r = await req("GET", "/api/audit?order_id=abc");
    return r.status === 400 ? {} : { error: "expected 400, got " + r.status };
  });
  await test("Notification invalid limit safe", async () => {
    const r = await req("GET", "/api/notifications?limit=abc");
    return r.status === 200 && Array.isArray(r.body.notifications) ? {} : { error: "notification limit not safe" };
  });
  await test("Stage time respects role permission", async () => {
    const oldToken = token;
    await loginUser("jishu1", "123456");
    const r = await req("PUT", `/api/orders/${createdOrderId}/stages/shipping/time`, { start_date: "2026-08-01T09:00", planned_end_date: "2026-08-02T09:00" });
    token = oldToken;
    return r.status === 403 ? {} : { error: "expected 403, got " + r.status };
  });
  await test("Purchase order date settable", async () => {
    const timeRes = await req("PUT", `/api/orders/${createdOrderId}/stages/purchase_frame/time`, { order_date: "2026-08-07" });
    if (timeRes.status !== 200) return { error: "order date set failed: " + JSON.stringify(timeRes.body) };
    const r = await req("GET", `/api/orders/${createdOrderId}`);
    const stage = (r.body.stages || []).find(s => s.stage_key === "purchase_frame");
    return stage && stage.order_date === "2026-08-07" ? {} : { error: "order date not saved" };
  });
  await test("Missing notification read returns 404", async () => {
    const r = await req("PUT", "/api/notifications/999999/read");
    return r.status === 404 ? {} : { error: "expected 404, got " + r.status };
  });
  await test("Invalid user role rejected", async () => {
    const r = await req("POST", "/api/auth/register", { username: "badrole_" + Date.now(), password: "123456", name: "Bad", role: "superadmin", department_id: 1 });
    return r.status === 400 ? {} : { error: "expected 400, got " + r.status };
  });
  await test("Register rejects missing department", async () => {
    const r = await req("POST", "/api/auth/register", { username: "baddept_" + Date.now(), password: "123456", name: "Bad", role: "sales", department_id: 999999 });
    return r.status === 400 && r.body.error === "部门不存在"
      ? {}
      : { error: "expected 400, got " + r.status + " " + JSON.stringify(r.body) };
  });
  await test("Update user rejects missing department", async () => {
    const username = "upduser_" + Date.now();
    const create = await req("POST", "/api/auth/register", { username, password: "123456", name: "Upd", role: "sales", department_id: 1 });
    if (create.status !== 201) return { error: "create failed: " + JSON.stringify(create.body) };
    const users = await req("GET", "/api/auth/users");
    const u = (users.body.users || []).find(x => x.username === username);
    if (!u) return { error: "user not found" };
    const r = await req("PUT", `/api/auth/users/${u.id}`, { department_id: 999999 });
    const del = await req("DELETE", `/api/auth/users/${u.id}`);
    if (del.status !== 200) return { error: "cleanup failed" };
    return r.status === 400 && r.body.error === "部门不存在"
      ? {}
      : { error: "expected 400, got " + r.status + " " + JSON.stringify(r.body) };
  });
  await test("Stats restricted by role", async () => {
    const oldToken = token;
    await loginUser("jishu1", "123456");
    const r = await req("GET", "/api/orders/stats");
    token = oldToken;
    return r.status === 403 ? {} : { error: "expected 403, got " + r.status };
  });
  await test("Non-string notes rejected", async () => {
    const r = await req("POST", "/api/orders", { customer_name: "T", project_name: "T", planned_delivery_date: "2026-08-10", notes: { a: 1 } });
    return r.status === 400 ? {} : { error: "expected 400, got " + r.status };
  });
  await test("Notification read respects visibility", async () => {
    const list = await req("GET", "/api/notifications?limit=200");
    const hidden = (list.body.notifications || []).find(n => n.recipient_dept_id && n.recipient_dept_id !== 4);
    if (!hidden) return {};
    const oldToken = token;
    await loginUser("jishu1", "123456");
    const r = await req("PUT", `/api/notifications/${hidden.id}/read`);
    token = oldToken;
    return r.status === 404 ? {} : { error: "expected 404, got " + r.status };
  });

  const testOrderIds = new Set([createdOrderId, roleOrderId, todoOrderId].filter(Boolean));
  if (process.env.SKIP_CLEANUP === '1') {
    console.log("[cleanup] skipped (SKIP_CLEANUP=1)");
  } else {
    for (const id of testOrderIds) {
      try { await req("DELETE", `/api/orders/${id}`); } catch {}
    }
    console.log("[cleanup] deleted test orders:", testOrderIds.size);
  }

  console.log("\n=== 结果: " + passed + "/" + (passed+failed) + " 通过 ===");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error("测试异常:", e.message); process.exit(1); });
