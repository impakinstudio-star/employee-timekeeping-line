const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");

const port = Number(process.env.PORT || 8124);
const channelSecret = process.env.LINE_CHANNEL_SECRET || "";
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const managerUser = process.env.MANAGER_USER || "manager";
const managerPassword = process.env.MANAGER_PASSWORD || "1234";
const databaseUrl = process.env.DATABASE_URL || "";
const root = __dirname;
const dataDir = process.env.DATA_DIR || root;
const dataFile = path.join(dataDir, "data.json");
const sessions = new Map();
let pgPool = null;

const seed = {
  employees: [
    { id: "e1", code: "EMP001", name: "นิดา", line: "U-nida", wage: 520, active: true, offDays: [], allowedShifts: ["morning", "evening", "night"] },
    { id: "e2", code: "EMP002", name: "กิตติ", line: "U-kitti", wage: 520, active: true, offDays: [], allowedShifts: ["morning", "evening", "night"] },
    { id: "e3", code: "EMP003", name: "เมย์", line: "U-may", wage: 500, active: true, offDays: [], allowedShifts: ["morning", "evening", "night"] },
    { id: "e4", code: "EMP004", name: "ต้น", line: "U-ton", wage: 500, active: true, offDays: [], allowedShifts: ["morning", "evening", "night"] },
    { id: "e5", code: "EMP005", name: "แพรว", line: "U-praew", wage: 480, active: true, offDays: [], allowedShifts: ["morning", "evening", "night"] },
    { id: "e6", code: "EMP006", name: "บอล", line: "U-ball", wage: 480, active: true, offDays: [], allowedShifts: ["morning", "evening", "night"] }
  ],
  shifts: [
    { id: "morning", name: "กะเช้า", start: "07:00", end: "15:00", required: 4, special: false },
    { id: "evening", name: "กะบ่าย", start: "15:00", end: "23:00", required: 4, special: false },
    { id: "night", name: "กะดึกพิเศษ", start: "23:00", end: "07:00", required: 3, special: true }
  ],
  campaigns: [{ id: "c1", name: "ดับเบิลเดย์", date: todayIso() }],
  schedules: [],
  attendance: [],
  leaves: [],
  pendingLineUsers: [],
  auditLogs: []
};

function todayIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function newId() {
  return crypto.randomBytes(5).toString("hex");
}

function cloneDb(db) {
  return JSON.parse(JSON.stringify(db));
}

async function readDb() {
  if (databaseUrl) return readPostgresDb();
  return readFileDb();
}

function readFileDb() {
  if (!fs.existsSync(dataFile)) {
    writeFileDb(cloneDb(seed));
  }
  const db = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  return normalizeDb(db);
}

function normalizeDb(db) {
  db.pendingLineUsers = Array.isArray(db.pendingLineUsers) ? db.pendingLineUsers : [];
  db.employees = db.employees.map((employee) => ({
    ...employee,
    offDays: Array.isArray(employee.offDays) ? employee.offDays : [],
    allowedShifts: Array.isArray(employee.allowedShifts) && employee.allowedShifts.length
      ? employee.allowedShifts
      : ["morning", "evening", "night"]
  }));
  return db;
}

async function writeDb(db) {
  if (databaseUrl) return writePostgresDb(db);
  writeFileDb(db);
}

function writeFileDb(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2), "utf8");
}

async function getPgPool() {
  if (pgPool) return pgPool;
  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch (error) {
    throw new Error("DATABASE_URL is set, but package 'pg' is not installed. Run npm install.");
  }
  pgPool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false }
  });
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  return pgPool;
}

async function readPostgresDb() {
  const pool = await getPgPool();
  const result = await pool.query("SELECT data FROM app_state WHERE id = $1", ["main"]);
  if (result.rows[0]?.data) return normalizeDb(result.rows[0].data);
  const initial = normalizeDb(cloneDb(seed));
  await writePostgresDb(initial);
  return initial;
}

async function writePostgresDb(db) {
  const pool = await getPgPool();
  const data = normalizeDb(cloneDb(db));
  await pool.query(`
    INSERT INTO app_state (id, data, updated_at)
    VALUES ($1, $2::jsonb, now())
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `, ["main", JSON.stringify(data)]);
}

function backupPayload(db) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: "employee-timekeeping-line",
    data: db
  };
}

function restoredDbFrom(body) {
  const data = body?.data || body;
  if (!data || typeof data !== "object") throw new Error("Invalid backup file");
  for (const key of ["employees", "shifts", "campaigns", "schedules", "attendance", "leaves"]) {
    if (!Array.isArray(data[key])) throw new Error(`Backup missing ${key}`);
  }
  return normalizeDb({
    ...data,
    pendingLineUsers: Array.isArray(data.pendingLineUsers) ? data.pendingLineUsers : [],
    auditLogs: Array.isArray(data.auditLogs) ? data.auditLogs : []
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function withCookie(res, status, body, cookie) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "set-cookie": cookie
  });
  res.end(payload);
}

function text(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function verifyLineSignature(rawBody, signature) {
  if (!channelSecret) return true;
  const digest = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature || ""));
}

function recordPendingLineUser(db, { lineUserId, groupId, message, at }) {
  if (!lineUserId) return;
  const existing = db.pendingLineUsers.find((item) => item.lineUserId === lineUserId);
  if (existing) {
    existing.groupId = groupId || existing.groupId;
    existing.lastMessage = message;
    existing.lastSeenAt = at;
    existing.count = (existing.count || 1) + 1;
    return;
  }
  db.pendingLineUsers.push({
    id: newId(),
    lineUserId,
    groupId,
    firstMessage: message,
    lastMessage: message,
    firstSeenAt: at,
    lastSeenAt: at,
    count: 1
  });
}

function replyToLine(replyToken, message) {
  if (!channelAccessToken || !replyToken || !message) return Promise.resolve({ skipped: true });
  const payload = JSON.stringify({
    replyToken,
    messages: [{ type: "text", text: message }]
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.line.me",
      path: "/v2/bot/message/reply",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        authorization: `Bearer ${channelAccessToken}`
      }
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body });
        } else {
          reject(new Error(`LINE reply failed: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function currentManager(req) {
  const token = parseCookies(req).manager_session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireManager(req, res) {
  const manager = currentManager(req);
  if (manager) return manager;
  json(res, 401, { error: "Manager login required" });
  return null;
}

function activeEmployees(db) {
  return db.employees.filter((employee) => employee.active);
}

function allowedShiftsFor(employee) {
  return Array.isArray(employee.allowedShifts) && employee.allowedShifts.length
    ? employee.allowedShifts
    : ["morning", "evening", "night"];
}

function offDaysFor(employee) {
  return Array.isArray(employee.offDays) ? employee.offDays.map(Number) : [];
}

function weekdayNumber(date) {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

function canAssign(db, employee, date, shiftId) {
  if (!employee.active) return { ok: false, reason: "พนักงานถูกปิดใช้งาน" };
  if (offDaysFor(employee).includes(weekdayNumber(date))) return { ok: false, reason: "ตรงกับวันหยุดประจำของพนักงาน" };
  if (!allowedShiftsFor(employee).includes(shiftId)) return { ok: false, reason: "พนักงานไม่ได้เลือกว่าทำกะนี้ได้" };

  const sameDay = db.schedules.find((item) => item.date === date && item.employeeId === employee.id);
  if (sameDay && sameDay.shiftId !== shiftId) return { ok: false, reason: "ห้ามควงกะในวันเดียวกัน" };

  if (shiftId === "morning") {
    const previousDate = addDays(date, -1);
    const previousShift = db.schedules.find((item) => item.date === previousDate && item.employeeId === employee.id && item.shiftId === "evening");
    if (previousShift) return { ok: false, reason: "เข้าบ่ายแล้ววันถัดไปเข้าเช้าไม่ได้ ต้องคั่นด้วยวันหยุด" };
  }

  return { ok: true };
}

function isSpecialDate(db, date) {
  const { year, month, day } = parseIsoDate(date);
  const monthEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day === monthEnd || db.campaigns.some((campaign) => campaign.date === date);
}

function shiftsForDate(db, date) {
  return db.shifts.filter((shift) => !shift.special || isSpecialDate(db, date));
}

function attendanceFor(db, date, employeeId) {
  return db.attendance.find((item) => item.date === date && item.employeeId === employeeId);
}

function leaveFor(db, date, employeeId) {
  return db.leaves.find((item) => item.date === date && item.employeeId === employeeId && item.status === "approved");
}

function leaveLabel(type) {
  if (type === "sick") return "ลาป่วย";
  if (type === "personal") return "ลากิจ";
  return "ลา";
}

function dateFromMessage(message, at) {
  const base = at.slice(0, 10);
  if (message.includes("พรุ่งนี้")) return addDays(base, 1);
  const iso = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const slash = message.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const [, d, m, y] = slash;
    const baseYear = Number(base.slice(0, 4));
    let year = y ? Number(y) : baseYear;
    if (year > 2400) year -= 543;
    if (year < 100) year += 2000;
    return `${year}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  }
  return base;
}

function setLeave(db, { employeeId, date, type, note = "", source = "manager", groupId = "" }) {
  db.leaves = db.leaves.filter((item) => !(item.employeeId === employeeId && item.date === date));
  db.attendance = db.attendance.filter((item) => !(item.employeeId === employeeId && item.date === date && !item.checkIn));
  db.leaves.push({
    id: newId(),
    employeeId,
    date,
    type,
    status: "approved",
    note,
    source,
    groupId,
    requestedFromLine: source === "line",
    approvedBy: "manager",
    requestedAt: new Date().toISOString()
  });
}

function setAbsence(db, { employeeId, date, shiftId, source = "manager" }) {
  db.leaves = db.leaves.filter((item) => !(item.employeeId === employeeId && item.date === date));
  let record = attendanceFor(db, date, employeeId);
  if (!record) {
    record = {
      id: newId(),
      employeeId,
      line: "",
      groupId: "",
      date,
      shiftId: shiftId || inferShift(db, date, employeeId),
      checkIn: null,
      checkOut: null,
      source,
      status: "ขาดงาน"
    };
    db.attendance.push(record);
  } else {
    record.shiftId = shiftId || record.shiftId;
    record.status = "ขาดงาน";
  }
}

function clearWorkdayStatus(db, { employeeId, date }) {
  db.leaves = db.leaves.filter((item) => !(item.employeeId === employeeId && item.date === date));
  db.attendance = db.attendance.filter((item) => !(item.employeeId === employeeId && item.date === date && !item.checkIn));
}

function inferShift(db, date, employeeId) {
  const assigned = db.schedules.find((item) => item.date === date && item.employeeId === employeeId);
  return assigned?.shiftId || shiftsForDate(db, date)[0]?.id || "morning";
}

function handleCommand(db, { lineUserId, groupId, message, at = new Date().toISOString() }) {
  const employee = db.employees.find((item) => item.line === lineUserId && item.active);
  const date = at.slice(0, 10);
  if (!employee) {
    recordPendingLineUser(db, { lineUserId, groupId, message, at });
    return { ok: false, reply: "ระบบได้รับข้อความแล้ว แต่ยังไม่ได้ผูก LINE นี้กับพนักงาน กรุณาให้ผู้จัดการผูกในระบบก่อน" };
  }

  if (message.includes("เข้างาน")) {
    let record = attendanceFor(db, date, employee.id);
    if (!record) {
      record = {
        id: newId(),
        employeeId: employee.id,
        line: lineUserId,
        groupId,
        date,
        shiftId: inferShift(db, date, employee.id),
        checkIn: at,
        checkOut: null,
        source: "line",
        status: "ทำงาน"
      };
      db.attendance.push(record);
    } else if (!record.checkIn) {
      record.checkIn = at;
    }
    return { ok: true, reply: `บันทึกเข้างานให้ ${employee.name} แล้ว` };
  }

  if (message.includes("ออกงาน")) {
    const record = attendanceFor(db, date, employee.id);
    if (!record) return { ok: false, reply: `ยังไม่พบเวลาเข้างานของ ${employee.name}` };
    record.checkOut = at;
    record.status = "ครบเวลา";
    return { ok: true, reply: `บันทึกออกงานให้ ${employee.name} แล้ว` };
  }

  if (message.includes("ลาป่วย") || message.includes("ป่วย") || message.includes("ลากิจ") || message.includes("ธุระ") || message.includes("ลา") || message.includes("หยุด")) {
    const leaveDate = dateFromMessage(message, at);
    const type = (message.includes("ลาป่วย") || message.includes("ป่วย")) ? "sick" : "personal";
    setLeave(db, {
      employeeId: employee.id,
      date: leaveDate,
      type,
      note: message,
      source: "line",
      groupId
    });
    return { ok: true, reply: `บันทึก${leaveLabel(type)}ให้ ${employee.name} วันที่ ${leaveDate} แล้ว` };
  }

  if (message.includes("ลา") || message.includes("หยุด")) {
    db.leaves.push({
      id: newId(),
      employeeId: employee.id,
      date,
      type: message.includes("ลา") ? "ลา" : "หยุด",
      status: "approved",
      requestedFromLine: true,
      approvedBy: "manager"
    });
    return { ok: true, reply: `บันทึก${message.includes("ลา") ? "ลา" : "หยุด"}ให้ ${employee.name} แล้ว` };
  }

  if (message.includes("สรุป")) {
    const summary = payroll(db, date.slice(0, 7)).find((item) => item.employeeId === employee.id);
    return { ok: true, reply: `${employee.name}: ทำงาน ${summary.workDays} วัน ค่าแรงรวม ${summary.total} บาท` };
  }

  return { ok: false, reply: "คำสั่งที่ใช้ได้: เข้างาน, ออกงาน, ลา วันนี้, หยุด วันนี้, สรุปของฉัน" };
}

function payroll(db, month) {
  return db.employees.map((employee) => {
    const records = db.attendance.filter((item) => item.employeeId === employee.id && item.date.startsWith(month) && item.checkIn);
    const workDates = new Set(records.map((item) => item.date));
    const leaves = db.leaves.filter((item) => item.employeeId === employee.id && item.date.startsWith(month) && item.status === "approved");
    const sickLeaveDays = leaves.filter((leave) => leave.type === "sick").length;
    const personalLeaveDays = leaves.filter((leave) => leave.type === "personal").length;
    const scheduledDates = new Set(db.schedules.filter((item) => item.employeeId === employee.id && item.date.startsWith(month)).map((item) => item.date));
    const absentDays = [...scheduledDates].filter((date) => !workDates.has(date) && !leaves.some((leave) => leave.date === date)).length;
    return {
      employeeId: employee.id,
      name: employee.name,
      wage: employee.wage,
      workDays: workDates.size,
      leaveDays: leaves.length,
      sickLeaveDays,
      personalLeaveDays,
      absentDays,
      total: workDates.size * employee.wage
    };
  });
}

function autoSchedule(db, startDate, days) {
  const employees = activeEmployees(db);
  let pointer = 0;
  for (let day = 0; day < days; day += 1) {
    const date = addDays(startDate, day);
    db.schedules = db.schedules.filter((item) => item.date !== date);
    shiftsForDate(db, date).forEach((shift) => {
      for (let slot = 0; slot < shift.required; slot += 1) {
        if (!employees.length) return;
        let selected = null;
        for (let attempt = 0; attempt < employees.length; attempt += 1) {
          const employee = employees[(pointer + attempt) % employees.length];
          if (canAssign(db, employee, date, shift.id).ok) {
            selected = employee;
            pointer = pointer + attempt + 1;
            break;
          }
        }
        if (!selected) break;
        db.schedules.push({ id: newId(), date, shiftId: shift.id, employeeId: selected.id, status: "scheduled" });
      }
    });
  }
}

function addDays(date, days) {
  const { year, month, day } = parseIsoDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function parseIsoDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

async function api(req, res, pathname) {
  const db = await readDb();
  const method = req.method || "GET";

  if (method === "GET" && pathname === "/api/session") {
    const manager = currentManager(req);
    return json(res, 200, { authenticated: Boolean(manager), user: manager?.user || null });
  }

  if (method === "POST" && pathname === "/api/login") {
    const body = JSON.parse(await readBody(req));
    if (body.username !== managerUser || body.password !== managerPassword) {
      return json(res, 401, { error: "Invalid username or password" });
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { user: managerUser, createdAt: Date.now(), expiresAt: Date.now() + 12 * 60 * 60 * 1000 });
    return withCookie(res, 200, { authenticated: true, user: managerUser }, `manager_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
  }

  if (method === "POST" && pathname === "/api/logout") {
    const token = parseCookies(req).manager_session;
    if (token) sessions.delete(token);
    return withCookie(res, 200, { authenticated: false }, "manager_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  }

  if (method === "GET" && pathname === "/api/state") {
    if (!requireManager(req, res)) return;
    return json(res, 200, db);
  }

  if (method === "GET" && pathname === "/api/backup") {
    if (!requireManager(req, res)) return;
    return json(res, 200, backupPayload(db));
  }

  if (method === "POST" && pathname === "/api/restore") {
    const manager = requireManager(req, res);
    if (!manager) return;
    try {
      const body = JSON.parse(await readBody(req));
      const restored = restoredDbFrom(body);
      restored.auditLogs.push({
        id: newId(),
        actor: manager.user,
        action: "restore_backup",
        at: new Date().toISOString()
      });
      await writeDb(restored);
      return json(res, 200, restored);
    } catch (error) {
      return json(res, 400, { error: error.message || "Invalid backup file" });
    }
  }

  if (method === "POST" && pathname === "/api/reset") {
    if (!requireManager(req, res)) return;
    const freshSeed = cloneDb(seed);
    await writeDb(freshSeed);
    return json(res, 200, freshSeed);
  }

  if (method === "POST" && pathname === "/api/employees") {
    const manager = requireManager(req, res);
    if (!manager) return;
    const body = JSON.parse(await readBody(req));
    db.employees.push({
      id: newId(),
      code: body.code,
      name: body.name,
      line: body.line,
      wage: Number(body.wage),
      active: true,
      offDays: [],
      allowedShifts: ["morning", "evening", "night"]
    });
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "create_employee", after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 201, db);
  }

  if (method === "PUT" && pathname === "/api/employees") {
    const manager = requireManager(req, res);
    if (!manager) return;
    const body = JSON.parse(await readBody(req));
    const updates = Array.isArray(body.employees) ? body.employees : [];
    const before = db.employees.map((employee) => ({ ...employee }));
    updates.forEach((update) => {
      const employee = db.employees.find((item) => item.id === update.id);
      if (!employee) return;
      Object.assign(employee, {
        name: update.name,
        line: update.line,
        wage: Number(update.wage || 0),
        offDays: Array.isArray(update.offDays) ? update.offDays.map(Number) : [],
        allowedShifts: Array.isArray(update.allowedShifts) ? update.allowedShifts : []
      });
    });
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "bulk_update_employees", before, after: updates, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "PATCH" && pathname.startsWith("/api/employees/")) {
    const manager = requireManager(req, res);
    if (!manager) return;
    const employeeId = pathname.split("/").pop();
    const body = JSON.parse(await readBody(req));
    const employee = db.employees.find((item) => item.id === employeeId);
    if (!employee) return json(res, 404, { error: "Employee not found" });
    const before = { ...employee };
    Object.assign(employee, body);
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "update_employee", targetId: employeeId, before, after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "DELETE" && pathname.startsWith("/api/employees/")) {
    const manager = requireManager(req, res);
    if (!manager) return;
    const employeeId = pathname.split("/").pop();
    const employee = db.employees.find((item) => item.id === employeeId);
    if (!employee) return json(res, 404, { error: "Employee not found" });
    db.employees = db.employees.filter((item) => item.id !== employeeId);
    db.schedules = db.schedules.filter((item) => item.employeeId !== employeeId);
    db.leaves = db.leaves.filter((item) => item.employeeId !== employeeId);
    db.attendance = db.attendance.filter((item) => item.employeeId !== employeeId);
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "delete_employee", targetId: employeeId, before: employee, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "POST" && pathname === "/api/campaigns") {
    const manager = requireManager(req, res);
    if (!manager) return;
    const body = JSON.parse(await readBody(req));
    db.campaigns.push({ id: newId(), name: body.name, date: body.date });
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "create_campaign", after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 201, db);
  }

  if (method === "DELETE" && pathname.startsWith("/api/campaigns/")) {
    const manager = requireManager(req, res);
    if (!manager) return;
    const campaignId = pathname.split("/").pop();
    db.campaigns = db.campaigns.filter((item) => item.id !== campaignId);
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "delete_campaign", targetId: campaignId, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "PATCH" && pathname.startsWith("/api/shifts/")) {
    const manager = requireManager(req, res);
    if (!manager) return;
    const shiftId = pathname.split("/").pop();
    const body = JSON.parse(await readBody(req));
    const shift = db.shifts.find((item) => item.id === shiftId);
    if (!shift) return json(res, 404, { error: "Shift not found" });
    const before = { ...shift };
    Object.assign(shift, body);
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "update_shift", targetId: shiftId, before, after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "POST" && pathname === "/api/schedule/auto") {
    const manager = requireManager(req, res);
    if (!manager) return;
    const body = JSON.parse(await readBody(req));
    autoSchedule(db, body.date || todayIso(), Number(body.days || 1));
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "auto_schedule", after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "POST" && pathname === "/api/schedule/assign") {
    const manager = requireManager(req, res);
    if (!manager) return;
    const body = JSON.parse(await readBody(req));
    const employee = db.employees.find((item) => item.id === body.employeeId);
    const shift = db.shifts.find((item) => item.id === body.shiftId);
    if (!employee) return json(res, 404, { error: "Employee not found" });
    if (!shift) return json(res, 404, { error: "Shift not found" });
    const currentAssignments = db.schedules.filter((item) => !(item.date === body.date && item.employeeId === body.employeeId));
    const originalSchedules = db.schedules;
    db.schedules = currentAssignments;
    const check = canAssign(db, employee, body.date, body.shiftId);
    db.schedules = originalSchedules;
    if (!check.ok) return json(res, 400, { error: check.reason });
    db.schedules = db.schedules.filter((item) => !(item.date === body.date && item.employeeId === body.employeeId));
    db.schedules.push({
      id: newId(),
      date: body.date,
      shiftId: body.shiftId,
      employeeId: body.employeeId,
      status: "scheduled"
    });
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "assign_schedule", after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "POST" && pathname === "/api/schedule/remove") {
    const manager = requireManager(req, res);
    if (!manager) return;
    const body = JSON.parse(await readBody(req));
    const before = db.schedules.find((item) => item.date === body.date && item.shiftId === body.shiftId && item.employeeId === body.employeeId);
    db.schedules = db.schedules.filter((item) => !(item.date === body.date && item.shiftId === body.shiftId && item.employeeId === body.employeeId));
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "remove_schedule", before, after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "POST" && pathname === "/api/line/command") {
    if (!requireManager(req, res)) return;
    const body = JSON.parse(await readBody(req));
    const result = handleCommand(db, body);
    await writeDb(db);
    return json(res, 200, { ...result, state: db });
  }

  if (method === "POST" && pathname === "/api/line/bind") {
    const manager = requireManager(req, res);
    if (!manager) return;
    const body = JSON.parse(await readBody(req));
    const employee = db.employees.find((item) => item.id === body.employeeId);
    if (!employee) return json(res, 404, { error: "Employee not found" });
    const before = { ...employee };
    employee.line = body.lineUserId;
    db.pendingLineUsers = db.pendingLineUsers.filter((item) => item.lineUserId !== body.lineUserId);
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "bind_line_user", targetId: employee.id, before, after: { lineUserId: body.lineUserId }, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "PATCH" && pathname.startsWith("/api/attendance/")) {
    const manager = requireManager(req, res);
    if (!manager) return;
    const attendanceId = pathname.split("/").pop();
    const body = JSON.parse(await readBody(req));
    const record = db.attendance.find((item) => item.id === attendanceId);
    if (!record) return json(res, 404, { error: "Attendance not found" });
    const before = { ...record };
    Object.assign(record, body);
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "update_attendance", targetId: attendanceId, before, after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "POST" && pathname === "/api/workday-status") {
    const manager = requireManager(req, res);
    if (!manager) return;
    const body = JSON.parse(await readBody(req));
    const employee = db.employees.find((item) => item.id === body.employeeId);
    if (!employee) return json(res, 404, { error: "Employee not found" });
    const before = {
      attendance: db.attendance.filter((item) => item.employeeId === body.employeeId && item.date === body.date),
      leaves: db.leaves.filter((item) => item.employeeId === body.employeeId && item.date === body.date)
    };
    if (body.status === "sick" || body.status === "personal") {
      setLeave(db, {
        employeeId: body.employeeId,
        date: body.date,
        type: body.status,
        note: body.note || "",
        source: "manager"
      });
    } else if (body.status === "absent") {
      setAbsence(db, {
        employeeId: body.employeeId,
        date: body.date,
        shiftId: body.shiftId,
        source: "manager"
      });
    } else if (body.status === "clear") {
      clearWorkdayStatus(db, {
        employeeId: body.employeeId,
        date: body.date
      });
    } else {
      return json(res, 400, { error: "Invalid status" });
    }
    db.auditLogs.push({ id: newId(), actor: manager.user, action: "set_workday_status", targetId: body.employeeId, before, after: body, at: new Date().toISOString() });
    await writeDb(db);
    return json(res, 200, db);
  }

  if (method === "POST" && (pathname === "/webhook/line" || pathname === "/webhook")) {
    const rawBody = await readBody(req);
    if (!verifyLineSignature(rawBody, req.headers["x-line-signature"])) {
      return json(res, 401, { error: "Invalid LINE signature" });
    }
    const body = JSON.parse(rawBody);
    const replies = [];
    for (const event of body.events || []) {
      if (event.type !== "message" || event.message?.type !== "text") continue;
      const result = handleCommand(db, {
        lineUserId: event.source?.userId,
        groupId: event.source?.groupId,
        message: event.message.text,
        at: new Date(event.timestamp || Date.now()).toISOString()
      });
      replies.push(result);
      if (event.replyToken && result.reply) {
        try {
          await replyToLine(event.replyToken, result.reply);
        } catch (error) {
          db.auditLogs.push({ id: newId(), action: "line_reply_error", after: { message: error.message }, at: new Date().toISOString() });
        }
      }
    }
    await writeDb(db);
    return json(res, 200, { ok: true, replies });
  }

  if (method === "GET" && pathname === "/api/payroll") {
    if (!requireManager(req, res)) return;
    const query = new URL(req.url, `http://${req.headers.host}`).searchParams;
    return json(res, 200, payroll(db, query.get("month") || todayIso().slice(0, 7)));
  }

  return json(res, 404, { error: "Not found" });
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, safePath));
  if (!filePath.startsWith(root)) return text(res, 403, "Forbidden");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return text(res, 404, "Not found");
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  text(res, 200, fs.readFileSync(filePath), types[ext] || "application/octet-stream");
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname.startsWith("/api/") || pathname === "/webhook/line" || pathname === "/webhook") {
      await api(req, res, pathname);
    } else {
      serveStatic(req, res, decodeURIComponent(pathname));
    }
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Employee timekeeping app: http://${host}:${port}/`);
});
