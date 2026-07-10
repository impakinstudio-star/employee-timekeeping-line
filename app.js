const todayIso = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const baht = (value) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value);
const timeText = (date) => new Date(date).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
const dateText = (date) => {
  const { year, month, day } = parseIsoDate(date);
  return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
};
const datetimeLocalValue = (date) => {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    hour12: false
  }).formatToParts(new Date(date));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
};
const datetimeLocalToIso = (value) => value ? new Date(`${value}:00+07:00`).toISOString() : null;

let state = {
  employees: [],
  shifts: [],
  campaigns: [],
  schedules: [],
  attendance: [],
  leaves: [],
  auditLogs: []
};
let selectedDate = todayIso();
let session = { authenticated: false, user: null };
let editingAttendanceId = null;
const weekdays = [
  { value: 1, short: "จ", name: "จันทร์" },
  { value: 2, short: "อ", name: "อังคาร" },
  { value: 3, short: "พ", name: "พุธ" },
  { value: 4, short: "พฤ", name: "พฤหัส" },
  { value: 5, short: "ศ", name: "ศุกร์" },
  { value: 6, short: "ส", name: "เสาร์" },
  { value: 7, short: "อา", name: "อาทิตย์" }
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    ...options
  });
  if (response.status === 401) {
    showLogin("กรุณาเข้าสู่ระบบผู้จัดการ");
    throw new Error("Manager login required");
  }
  if (!response.ok) {
    const text = await response.text();
    try {
      throw new Error(JSON.parse(text).error || text);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(text);
      throw error;
    }
  }
  return response.json();
}

async function loadState() {
  state = await api("/api/state");
  render();
}

async function bootstrap() {
  session = await api("/api/session");
  if (!session.authenticated) {
    showLogin("");
    return;
  }
  hideLogin();
  await loadState();
}

function showLogin(message) {
  document.body.classList.add("locked");
  document.querySelector("#loginOverlay").classList.add("active");
  document.querySelector("#loginError").textContent = message || "";
  document.querySelector("#managerStatus").textContent = "ยังไม่ได้เข้าสู่ระบบ";
}

function hideLogin() {
  document.body.classList.remove("locked");
  document.querySelector("#loginOverlay").classList.remove("active");
  document.querySelector("#managerStatus").textContent = session.user ? `ผู้จัดการ: ${session.user}` : "ผู้จัดการ";
}

function activeEmployees() {
  return state.employees.filter((employee) => employee.active);
}

function isSpecialDate(date) {
  const { year, month, day } = parseIsoDate(date);
  const monthEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day === monthEnd || state.campaigns.some((campaign) => campaign.date === date);
}

function shiftsForDate(date) {
  return state.shifts.filter((shift) => !shift.special || isSpecialDate(date));
}

function findEmployee(employeeId) {
  return state.employees.find((employee) => employee.id === employeeId);
}

function findShift(shiftId) {
  return state.shifts.find((shift) => shift.id === shiftId);
}

function assignmentsFor(date, shiftId) {
  return state.schedules.filter((item) => item.date === date && item.shiftId === shiftId);
}

function attendanceFor(date, employeeId) {
  return state.attendance.find((item) => item.date === date && item.employeeId === employeeId);
}

function render() {
  renderLineEmployees();
  renderDashboard();
  renderEmployees();
  renderPendingLineUsers();
  renderSchedule();
  renderAttendance();
  renderPayroll();
  renderSettings();
}

function renderLineEmployees() {
  const select = document.querySelector("#lineEmployee");
  select.innerHTML = activeEmployees().map((employee) => `<option value="${employee.id}">${employee.name} (${employee.code})</option>`).join("");
}

function renderDashboard() {
  const scheduled = state.schedules.filter((item) => item.date === selectedDate);
  const present = state.attendance.filter((item) => item.date === selectedDate && item.checkIn);
  const leave = state.leaves.filter((item) => item.date === selectedDate && item.status === "approved");
  const missing = scheduled.filter((item) => !attendanceFor(selectedDate, item.employeeId) && !leave.some((leaveItem) => leaveItem.employeeId === item.employeeId));
  const payroll = weeklyPayroll().reduce((sum, row) => sum + row.total, 0);

  document.querySelector("#metricCheckedIn").textContent = present.length;
  document.querySelector("#metricMissing").textContent = missing.length;
  document.querySelector("#metricLeave").textContent = leave.length;
  document.querySelector("#metricPayroll").textContent = baht(payroll);

  document.querySelector("#shiftStatus").innerHTML = shiftsForDate(selectedDate).map((shift) => {
    const count = assignmentsFor(selectedDate, shift.id).length;
    const ok = count >= shift.required;
    return `
      <div class="shift-card ${ok ? "ok" : "warn"}">
        <div>
          <strong>${shift.name}</strong>
          <div>${shift.start}-${shift.end} ต้องมี ${shift.required} คน</div>
        </div>
        <span class="pill ${ok ? "green" : "red"}">${count}/${shift.required}</span>
      </div>
    `;
  }).join("");

  const alerts = [];
  shiftsForDate(selectedDate).forEach((shift) => {
    const count = assignmentsFor(selectedDate, shift.id).length;
    if (count < shift.required) alerts.push({ type: "warn", text: `${shift.name} คนไม่ครบ ขาดอีก ${shift.required - count} คน` });
  });
  missing.forEach((item) => {
    const employee = findEmployee(item.employeeId);
    const shift = findShift(item.shiftId);
    alerts.push({ type: "danger", text: `${employee?.name || "-"} ยังไม่เข้างาน ${shift?.name || "-"}` });
  });
  present.filter((item) => !item.checkOut).forEach((item) => {
    const employee = findEmployee(item.employeeId);
    alerts.push({ type: "warn", text: `${employee?.name || "-"} เข้างานแล้ว แต่ยังไม่ออกงาน` });
  });

  document.querySelector("#alerts").innerHTML = alerts.length
    ? alerts.map((alert) => `<div class="alert ${alert.type}">${alert.text}</div>`).join("")
    : `<div class="alert">วันนี้ยังไม่มีรายการที่ต้องตรวจ</div>`;
}

function renderEmployees() {
  document.querySelector("#employeeRows").innerHTML = state.employees.map((employee) => `
    <tr>
      <td>${employee.code}</td>
      <td><input class="employee-name-input" value="${employee.name || ""}" data-name-value="${employee.id}"></td>
      <td>
        <div class="input-row compact">
          <input class="line-bind-input" value="${employee.line || ""}" data-line-value="${employee.id}" placeholder="LINE user ID">
        </div>
      </td>
      <td><input class="employee-wage-input" type="number" min="0" value="${employee.wage || 0}" data-wage-value="${employee.id}"></td>
      <td>${renderOffDayControls(employee)}</td>
      <td>${renderAllowedShiftControls(employee)}</td>
      <td><span class="pill ${employee.active ? "green" : "red"}">${employee.active ? "ใช้งาน" : "ปิดใช้งาน"}</span></td>
      <td>
        <div class="row-actions">
          <button class="tiny" data-toggle-employee="${employee.id}">${employee.active ? "ปิด" : "เปิด"}</button>
          <button class="tiny danger" data-delete-employee="${employee.id}">ลบ</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderOffDayControls(employee) {
  const offDays = Array.isArray(employee.offDays) ? employee.offDays.map(Number) : [];
  return `
    <div class="checkbox-grid day-checks">
      ${weekdays.map((day) => `
        <label title="${day.name}">
          <input type="checkbox" data-offday-value="${employee.id}" value="${day.value}" ${offDays.includes(day.value) ? "checked" : ""}>
          ${day.short}
        </label>
      `).join("")}
    </div>
  `;
}

function renderAllowedShiftControls(employee) {
  const allowed = Array.isArray(employee.allowedShifts) && employee.allowedShifts.length ? employee.allowedShifts : ["morning", "evening", "night"];
  return `
    <div class="checkbox-grid shift-checks">
      ${state.shifts.map((shift) => `
        <label>
          <input type="checkbox" data-allowed-shift-value="${employee.id}" value="${shift.id}" ${allowed.includes(shift.id) ? "checked" : ""}>
          ${shift.name}
        </label>
      `).join("")}
    </div>
  `;
}

function renderPendingLineUsers() {
  const rows = state.pendingLineUsers || [];
  const target = document.querySelector("#pendingLineRows");
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = `<tr><td colspan="5">ยังไม่มี LINE user ที่รอผูก</td></tr>`;
    return;
  }
  target.innerHTML = rows.map((item) => `
    <tr>
      <td><code>${item.lineUserId}</code></td>
      <td>${item.lastMessage || "-"}</td>
      <td>${item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString("th-TH") : "-"}</td>
      <td>
        <select data-pending-employee="${item.lineUserId}">
          <option value="">เลือกพนักงาน</option>
          ${state.employees.map((employee) => `<option value="${employee.id}">${employee.name} (${employee.code})</option>`).join("")}
        </select>
      </td>
      <td><button class="tiny" data-bind-pending-line="${item.lineUserId}">ผูก LINE</button></td>
    </tr>
  `).join("");
}

function renderSchedule() {
  const { start } = weekRange(selectedDate);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  document.querySelector("#schedulePeople").innerHTML = activeEmployees().map((employee) => `
    <button class="person-chip" draggable="true" data-drag-employee="${employee.id}" type="button">${employee.name}</button>
  `).join("");

  document.querySelector("#scheduleBoard").innerHTML = dates.map((date) => {
    const shiftHtml = shiftsForDate(date).map((shift) => {
      const assignments = assignmentsFor(date, shift.id);
      const names = assignments.map((item) => {
        const employee = findEmployee(item.employeeId);
        return employee ? `
          <span class="scheduled-name" draggable="true" data-drag-employee="${employee.id}" data-drag-date="${date}" data-drag-shift="${shift.id}">
            ${employee.name}
            <button class="remove-assignment" type="button" title="เอาออกจากเวร" data-remove-employee="${employee.id}" data-remove-date="${date}" data-remove-shift="${shift.id}">×</button>
          </span>
        ` : "";
      }).join("");
      return `
        <div class="assignment drop-zone" data-drop-date="${date}" data-drop-shift="${shift.id}">
          <strong>${shift.name}</strong>
          <div class="scheduled-list">${names || "ยังไม่ได้จัดเวร"}</div>
          <span class="pill ${assignments.length >= shift.required ? "green" : "red"}">${assignments.length}/${shift.required}</span>
        </div>
      `;
    }).join("");
    return `<div class="day-column"><div class="day-head"><span>${weekdayLabel(date)}</span><strong>${dateText(date)}</strong></div>${shiftHtml}</div>`;
  }).join("");
}

function renderAttendance() {
  const rows = [...state.attendance].sort((a, b) => (b.date + (b.checkIn || "")).localeCompare(a.date + (a.checkIn || "")));
  document.querySelector("#attendanceRows").innerHTML = rows.map((item) => {
    const employee = findEmployee(item.employeeId);
    const shift = findShift(item.shiftId);
    if (editingAttendanceId === item.id) {
      return `
        <tr class="editing-row">
          <td>${item.date}</td>
          <td>${employee?.name || "-"}</td>
          <td>${shift?.name || "-"}</td>
          <td><input class="attendance-time-input" type="datetime-local" data-attendance-check-in="${item.id}" value="${datetimeLocalValue(item.checkIn)}"></td>
          <td><input class="attendance-time-input" type="datetime-local" data-attendance-check-out="${item.id}" value="${datetimeLocalValue(item.checkOut)}"></td>
          <td><input class="attendance-status-input" type="text" data-attendance-status="${item.id}" value="${item.status || ""}"></td>
          <td>
            <div class="row-actions">
              <button class="tiny primary" data-save-attendance="${item.id}">บันทึก</button>
              <button class="tiny" data-cancel-attendance-edit="${item.id}">ยกเลิก</button>
            </div>
          </td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${item.date}</td>
        <td>${employee?.name || "-"}</td>
        <td>${shift?.name || "-"}</td>
        <td>${item.checkIn ? timeText(item.checkIn) : "-"}</td>
        <td>${item.checkOut ? timeText(item.checkOut) : "-"}</td>
        <td><span class="pill ${item.checkOut ? "green" : ""}">${item.status}</span></td>
        <td>
          <div class="row-actions">
            <button class="tiny" data-edit-attendance="${item.id}">แก้เวลา</button>
            <button class="tiny" data-close-attendance="${item.id}">ปิดเวลา</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderPayroll() {
  const { start, end } = weekRange(selectedDate);
  document.querySelector("#payrollTitle").textContent = `สรุปค่าแรงรายอาทิตย์ ${dateText(start)} - ${dateText(end)}`;
  document.querySelector("#payrollRows").innerHTML = weeklyPayroll().map((row) => `
    <tr>
      <td>${row.name}</td>
      <td>${row.workDays}</td>
      <td>${row.leaveDays}</td>
      <td>${row.absentDays}</td>
      <td>${baht(row.wage)}</td>
      <td><strong>${baht(row.total)}</strong></td>
    </tr>
  `).join("");
}

function renderSettings() {
  document.querySelector("#shiftSettings").innerHTML = state.shifts.map((shift) => `
    <div class="setting-row">
      <div>
        <strong>${shift.name}</strong>
        <div>${shift.start}-${shift.end}</div>
      </div>
      <label>
        ขั้นต่ำ
        <input type="number" min="1" value="${shift.required}" data-required-shift="${shift.id}">
      </label>
    </div>
  `).join("");

  document.querySelector("#campaignRows").innerHTML = state.campaigns.map((campaign) => `
    <div class="campaign-row">
      <div>
        <strong>${campaign.name}</strong>
        <div>${campaign.date}</div>
      </div>
      <button class="tiny" data-delete-campaign="${campaign.id}">ลบ</button>
    </div>
  `).join("");
}

function weeklyPayroll() {
  const { start, end } = weekRange(selectedDate);
  return state.employees.map((employee) => {
    const records = state.attendance.filter((item) => item.employeeId === employee.id && isDateBetween(item.date, start, end) && item.checkIn);
    const workDates = new Set(records.map((item) => item.date));
    const leaves = state.leaves.filter((item) => item.employeeId === employee.id && isDateBetween(item.date, start, end) && item.status === "approved");
    const scheduledDates = new Set(state.schedules.filter((item) => item.employeeId === employee.id && isDateBetween(item.date, start, end)).map((item) => item.date));
    const absentDays = [...scheduledDates].filter((date) => !workDates.has(date) && !leaves.some((leave) => leave.date === date)).length;
    return {
      employeeId: employee.id,
      name: employee.name,
      wage: employee.wage,
      workDays: workDates.size,
      leaveDays: leaves.length,
      absentDays,
      total: workDates.size * employee.wage
    };
  });
}

async function autoSchedule(days) {
  const startDate = days === 7 ? weekRange(selectedDate).start : selectedDate;
  state = await api("/api/schedule/auto", {
    method: "POST",
    body: JSON.stringify({ date: startDate, days })
  });
  render();
}

async function resetDemoData() {
  state = await api("/api/reset", { method: "POST", body: "{}" });
  selectedDate = todayIso();
  document.querySelector("#datePicker").value = selectedDate;
  render();
}

async function handleLineCommand() {
  const employeeId = document.querySelector("#lineEmployee").value;
  const employee = findEmployee(employeeId);
  const command = document.querySelector("#lineCommand").value.trim();
  const reply = document.querySelector("#lineReply");
  if (!employee || !command) return;

  const result = await api("/api/line/command", {
    method: "POST",
    body: JSON.stringify({
      lineUserId: employee.line,
      groupId: "demo-group",
      message: command,
      at: new Date().toISOString()
    })
  });
  reply.textContent = result.reply;
  state = result.state;
  document.querySelector("#lineCommand").value = "";
  render();
}

async function saveAllEmployees() {
  const employees = state.employees.map((employee) => {
    const employeeId = employee.id;
    const lineInput = document.querySelector(`[data-line-value="${employeeId}"]`);
    const nameInput = document.querySelector(`[data-name-value="${employeeId}"]`);
    const wageInput = document.querySelector(`[data-wage-value="${employeeId}"]`);
    const offDays = [...document.querySelectorAll(`[data-offday-value="${employeeId}"]:checked`)].map((input) => Number(input.value));
    const allowedShifts = [...document.querySelectorAll(`[data-allowed-shift-value="${employeeId}"]:checked`)].map((input) => input.value);
    return {
      id: employeeId,
      name: nameInput.value.trim(),
      line: lineInput.value.trim(),
      wage: Number(wageInput.value || 0),
      offDays,
      allowedShifts
    };
  });

  document.querySelector("#employeeSaveStatus").textContent = "กำลังบันทึก...";
  state = await api("/api/employees", {
    method: "PUT",
    body: JSON.stringify({ employees })
  });
  render();
  document.querySelector("#employeeSaveStatus").textContent = "บันทึกแล้ว";
}

async function downloadBackup() {
  const backup = await api("/api/backup");
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  link.href = url;
  link.download = `employee-timekeeping-backup-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
  document.querySelector("#backupStatus").textContent = "ดาวน์โหลดไฟล์สำรองแล้ว";
}

async function restoreBackup(file) {
  if (!file) return;
  const text = await file.text();
  let backup;
  try {
    backup = JSON.parse(text);
  } catch (error) {
    alert("ไฟล์สำรองไม่ถูกต้อง");
    return;
  }
  if (!confirm("กู้คืนข้อมูลจากไฟล์นี้ใช่ไหม ข้อมูลปัจจุบันบนระบบจะถูกแทนที่")) return;
  state = await api("/api/restore", {
    method: "POST",
    body: JSON.stringify(backup)
  });
  render();
  document.querySelector("#backupStatus").textContent = "กู้คืนข้อมูลสำเร็จ";
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

function weekRange(date) {
  const { year, month, day } = parseIsoDate(date);
  const target = new Date(Date.UTC(year, month - 1, day));
  const weekday = target.getUTCDay() || 7;
  const start = addDays(date, 1 - weekday);
  const end = addDays(start, 6);
  return { start, end };
}

function weekdayLabel(date) {
  return weekdays.find((day) => day.value === weekdayNumber(date))?.name || "";
}

function weekdayNumber(date) {
  const { year, month, day } = parseIsoDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

function isDateBetween(date, start, end) {
  return date >= start && date <= end;
}

function parseIsoDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function exportCsv(name, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function dragData(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("application/json") || "{}");
  } catch (error) {
    return {};
  }
}

function bindEvents() {
  document.querySelector("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      session = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") })
      });
      hideLogin();
      await loadState();
    } catch (error) {
      document.querySelector("#loginError").textContent = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    }
  });

  document.querySelector("#logoutButton").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    session = { authenticated: false, user: null };
    showLogin("");
  });

  document.querySelector("#datePicker").value = selectedDate;
  document.querySelector("#datePicker").addEventListener("change", (event) => {
    selectedDate = event.target.value;
    render();
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.view}`).classList.add("active");
      document.querySelector("#pageTitle").textContent = button.querySelector("span").textContent;
    });
  });

  document.querySelector("#sendLine").addEventListener("click", handleLineCommand);
  document.querySelector("#lineCommand").addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleLineCommand();
  });

  document.querySelector("#autoScheduleToday").addEventListener("click", () => autoSchedule(1));
  document.querySelector("#autoScheduleWeek").addEventListener("click", () => autoSchedule(7));
  document.querySelector("#resetDemo").addEventListener("click", resetDemoData);
  document.querySelector("#saveAllEmployees").addEventListener("click", saveAllEmployees);
  document.querySelector("#downloadBackup").addEventListener("click", downloadBackup);
  document.querySelector("#restoreBackupFile").addEventListener("change", (event) => {
    restoreBackup(event.target.files[0]).finally(() => {
      event.target.value = "";
    });
  });

  document.querySelector("#employeeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    state = await api("/api/employees", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        code: data.get("code"),
        line: data.get("line"),
        wage: Number(data.get("wage"))
      })
    });
    event.target.reset();
    render();
  });

  document.querySelector("#campaignForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    state = await api("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({ name: data.get("name"), date: data.get("date") })
    });
    event.target.reset();
    render();
  });

  document.body.addEventListener("click", async (event) => {
    const toggleId = event.target.dataset.toggleEmployee;
    const closeId = event.target.dataset.closeAttendance;
    const editAttendanceId = event.target.dataset.editAttendance;
    const saveAttendanceId = event.target.dataset.saveAttendance;
    const cancelAttendanceEditId = event.target.dataset.cancelAttendanceEdit;
    const deleteEmployeeId = event.target.dataset.deleteEmployee;
    const deleteCampaignId = event.target.dataset.deleteCampaign;
    const removeEmployeeId = event.target.dataset.removeEmployee;
    const bindPendingLineId = event.target.dataset.bindPendingLine;
    if (toggleId) {
      const employee = findEmployee(toggleId);
      state = await api(`/api/employees/${toggleId}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !employee.active })
      });
      render();
    }
    if (deleteCampaignId) {
      state = await api(`/api/campaigns/${deleteCampaignId}`, { method: "DELETE" });
      render();
    }
    if (closeId) {
      state = await api(`/api/attendance/${closeId}`, {
        method: "PATCH",
        body: JSON.stringify({ checkOut: new Date().toISOString(), status: "ผู้จัดการปิดเวลา" })
      });
      render();
    }
    if (editAttendanceId) {
      editingAttendanceId = editAttendanceId;
      renderAttendance();
    }
    if (cancelAttendanceEditId) {
      editingAttendanceId = null;
      renderAttendance();
    }
    if (saveAttendanceId) {
      const checkInInput = document.querySelector(`[data-attendance-check-in="${saveAttendanceId}"]`);
      const checkOutInput = document.querySelector(`[data-attendance-check-out="${saveAttendanceId}"]`);
      const statusInput = document.querySelector(`[data-attendance-status="${saveAttendanceId}"]`);
      if (!checkInInput.value) {
        alert("กรุณาใส่เวลาเข้างาน");
        return;
      }
      const checkIn = datetimeLocalToIso(checkInInput.value);
      const checkOut = datetimeLocalToIso(checkOutInput.value);
      if (checkOut && new Date(checkOut) < new Date(checkIn)) {
        alert("เวลาออกงานต้องไม่น้อยกว่าเวลาเข้างาน");
        return;
      }
      state = await api(`/api/attendance/${saveAttendanceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          date: checkInInput.value.slice(0, 10),
          checkIn,
          checkOut,
          status: statusInput.value.trim() || "แก้ไขโดยผู้จัดการ"
        })
      });
      editingAttendanceId = null;
      render();
    }
    if (deleteEmployeeId) {
      const employee = findEmployee(deleteEmployeeId);
      if (!confirm(`ลบพนักงาน ${employee?.name || ""} ใช่ไหม`)) return;
      state = await api(`/api/employees/${deleteEmployeeId}`, { method: "DELETE" });
      render();
    }
    if (removeEmployeeId) {
      state = await api("/api/schedule/remove", {
        method: "POST",
        body: JSON.stringify({
          employeeId: removeEmployeeId,
          date: event.target.dataset.removeDate,
          shiftId: event.target.dataset.removeShift
        })
      });
      render();
    }
    if (bindPendingLineId) {
      const select = document.querySelector(`[data-pending-employee="${bindPendingLineId}"]`);
      if (!select.value) {
        alert("กรุณาเลือกพนักงานก่อน");
        return;
      }
      state = await api("/api/line/bind", {
        method: "POST",
        body: JSON.stringify({ lineUserId: bindPendingLineId, employeeId: select.value })
      });
      render();
    }
  });

  document.body.addEventListener("dragstart", (event) => {
    const employeeId = event.target.dataset.dragEmployee;
    if (!employeeId) return;
    event.dataTransfer.setData("application/json", JSON.stringify({
      employeeId,
      date: event.target.dataset.dragDate || "",
      shiftId: event.target.dataset.dragShift || ""
    }));
    event.dataTransfer.setData("text/plain", employeeId);
    event.dataTransfer.effectAllowed = "move";
  });

  document.body.addEventListener("dragover", (event) => {
    if (!event.target.closest(".drop-zone") && !event.target.closest(".remove-drop-zone")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  document.body.addEventListener("drop", async (event) => {
    const removeZone = event.target.closest(".remove-drop-zone");
    if (removeZone) {
      event.preventDefault();
      const data = dragData(event);
      if (!data.employeeId || !data.date || !data.shiftId) return;
      state = await api("/api/schedule/remove", {
        method: "POST",
        body: JSON.stringify({
          employeeId: data.employeeId,
          date: data.date,
          shiftId: data.shiftId
        })
      });
      render();
      return;
    }

    const zone = event.target.closest(".drop-zone");
    if (!zone) return;
    event.preventDefault();
    const employeeId = dragData(event).employeeId || event.dataTransfer.getData("text/plain");
    if (!employeeId) return;
    try {
      state = await api("/api/schedule/assign", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          date: zone.dataset.dropDate,
          shiftId: zone.dataset.dropShift
        })
      });
      render();
    } catch (error) {
      alert(error.message);
    }
  });

  document.body.addEventListener("change", async (event) => {
    const shiftId = event.target.dataset.requiredShift;
    if (shiftId) {
      state = await api(`/api/shifts/${shiftId}`, {
        method: "PATCH",
        body: JSON.stringify({ required: Number(event.target.value) })
      });
      render();
    }
  });

  document.querySelector("#exportPayroll").addEventListener("click", () => {
    const rows = [["พนักงาน", "วันทำงาน", "ลา/หยุด", "ขาด", "ค่าแรงรายวัน", "รวม"]];
    weeklyPayroll().forEach((row) => rows.push([row.name, row.workDays, row.leaveDays, row.absentDays, row.wage, row.total]));
    const { start, end } = weekRange(selectedDate);
    exportCsv(`payroll-${start}-to-${end}.csv`, rows);
  });

  document.querySelector("#exportAttendance").addEventListener("click", () => {
    const rows = [["วันที่", "พนักงาน", "กะ", "เข้า", "ออก", "สถานะ"]];
    state.attendance.forEach((item) => rows.push([
      item.date,
      findEmployee(item.employeeId)?.name || "",
      findShift(item.shiftId)?.name || "",
      item.checkIn ? timeText(item.checkIn) : "",
      item.checkOut ? timeText(item.checkOut) : "",
      item.status
    ]));
    exportCsv(`attendance-${selectedDate}.csv`, rows);
  });
}

window.autoSchedule = autoSchedule;
window.handleLineCommand = handleLineCommand;
window.resetDemoData = resetDemoData;

bindEvents();
bootstrap().catch((error) => {
  document.querySelector("#lineReply").textContent = `โหลดข้อมูลไม่สำเร็จ: ${error.message}`;
});
