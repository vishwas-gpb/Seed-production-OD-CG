/**
 * Field Visit Log — Apps Script backend.
 * Handles: user registration + PIN login (admin-approved), visit upload with
 * photos to Drive, and dashboard stats. One web app, routed by "action".
 *
 * DEPLOY: Extensions -> Apps Script -> paste -> Deploy -> Web app
 *   (Execute as: Me, Who has access: Anyone) -> authorise -> copy /exec URL.
 * Admin approves users by changing their "status" cell in the Users sheet
 * from "pending" to "approved" (or "rejected").
 */

var VISITS = "Visits";
var USERS  = "Users";
var PHOTO_FOLDER = "Field Visit Photos";
// Set this to a long random string, and set the SAME string as TOKEN in app.js.
// While it is left as the placeholder, the check is skipped (nothing breaks).
var SECRET = "CHANGE_ME_SHARED_SECRET";
var REVIEWS = "Reviews";
var R_HEADERS = ["visit_id","farmer_id","farmer_name","village","reviewer","comment","condition_review","actions","next_visit_date","actions_done","updated_at"];

var V_HEADERS = ["visit_id","visit_date","visit_time","staff_id","staff_name","state","agency","farmer_id","farmer_name",
  "district","block","gp","village","crop","seed_variety","seed_class",
  "crop_stage","condition","purpose","immediate_actions","lat","lon","notes",
  "photo1","photo2","photo3","logged_at","device_id","received_at"];
var U_HEADERS = ["staff_id","name","phone","salt","pin_hash","status","role","registered_at","approved_at"];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || "visit";
    if (SECRET !== "CHANGE_ME_SHARED_SECRET" && String(body.token || "") !== SECRET)
      return json({ status: "error", message: "unauthorized" });
    // Reads: no global lock (so concurrent users don't queue), cached briefly.
    if (action === "stats")  return cachedRead("stats", stats, 30);
    if (action === "photos") return cachedRead("photos", photosList, 30);
    if (action === "visits") return cachedRead("visits", visitsList, 30);
    if (action === "login")  return login(body);
    // Writes: serialise with a lock to avoid row races.
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try { if (action === "register") return register(body); if (action === "review") return saveReview(body.review); return saveVisit(body.visit); }
    finally { lock.releaseLock(); }
  } catch (err) {
    return json({ status: "error", message: String(err) });
  }
}
function cachedRead(key, fn, ttl) {
  var cache = CacheService.getScriptCache(); var hit = cache.get(key);
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  var out = fn(); var s = out.getContent();
  try { if (s.length < 95000) cache.put(key, s, ttl); } catch (e) {}
  return out;
}
function doGet() { return json({ status: "ok", message: "Field Visit Log endpoint is live" }); }

/* ---------- users / auth ---------- */
function usersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(USERS) || ss.insertSheet(USERS);
  if (s.getLastRow() === 0) s.appendRow(U_HEADERS);
  return s;
}
function findUserRow(sheet, staffId) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === String(staffId)) return { row: i + 1, values: data[i] };
  return null;
}
function hashPin(pin, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + pin, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join("");
}
function register(b) {
  var s = usersSheet();
  if (!b.staff_id || !b.pin) return json({ status: "error", message: "staff_id and pin required" });
  if (findUserRow(s, b.staff_id)) return json({ status: "error", message: "That Staff ID already exists" });
  var salt = Utilities.getUuid();
  s.appendRow([b.staff_id, b.name || "", b.phone || "", salt, hashPin(b.pin, salt), "pending", "staff", new Date(), ""]);
  return json({ status: "ok", state: "pending" });
}
function login(b) {
  var s = usersSheet();
  var u = findUserRow(s, b.staff_id);
  if (!u) return json({ status: "error", message: "No such Staff ID" });
  var salt = u.values[3], hash = u.values[4], state = String(u.values[5]), role = u.values[6] || "staff";
  if (hashPin(b.pin, salt) !== hash) return json({ status: "error", message: "Wrong PIN" });
  if (state !== "approved") return json({ status: state === "rejected" ? "rejected" : "pending" });
  return json({ status: "ok", name: u.values[1], salt: salt, pin_hash: hash, role: role });
}

/* ---------- visits ---------- */
function saveVisit(v) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(VISITS) || ss.insertSheet(VISITS);
  if (sheet.getLastRow() === 0) sheet.appendRow(V_HEADERS);
  // duplicate guard: same farmer + same staff + same date
  if (sheet.getLastRow() > 1) {
    var chk = sheet.getDataRange().getValues(); var ch = chk.shift(); var ci = {}; ch.forEach(function (h, i) { ci[h] = i; });
    for (var k = 0; k < chk.length; k++) {
      if (String(chk[k][ci.farmer_id]) === String(v.farmer_id) && String(chk[k][ci.staff_id]) === String(v.staff_id) && fmtDate(chk[k][ci.visit_date]) === String(v.visit_date))
        return json({ status: "duplicate", visit_id: v.visit_id });
    }
  }
  var urls = savePhotos(v.photos || [], v.visit_id);

  // Build the row as a key->value object. Client-only fields are dropped.
  var skip = { photos: 1, id: 1, synced: 1, synced_at: 1 };
  var rowObj = {};
  Object.keys(v).forEach(function (k) { if (!skip[k]) rowObj[k] = v[k]; });
  rowObj.photo1 = urls[0] || ""; rowObj.photo2 = urls[1] || ""; rowObj.photo3 = urls[2] || "";
  rowObj.received_at = new Date();

  // Dynamic schema: any key not already a column is appended as a NEW column.
  // Existing rows keep their data; the new column is simply blank for them.
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(rowObj).forEach(function (k) {
    if (headers.indexOf(k) === -1) { headers.push(k); sheet.getRange(1, headers.length).setValue(k); }
  });
  sheet.appendRow(headers.map(function (h) { return rowObj[h] !== undefined ? rowObj[h] : ""; }));
  try { CacheService.getScriptCache().removeAll(["stats", "photos"]); } catch (e) {}
  return json({ status: "ok", visit_id: v.visit_id });
}
function savePhotos(photos, id) {
  if (!photos.length) return [];
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
  return photos.map(function (d, i) {
    var b64 = d.indexOf(",") >= 0 ? d.split(",")[1] : d;
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), "image/jpeg", id + "_" + (i + 1) + ".jpg"));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  });
}

/* ---------- stats for in-app team dashboard ---------- */
function stats() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(VISITS);
  var empty = { status: "ok", total: 0, byStaff: {}, byStage: {}, byCondition: {}, byDistrict: {}, perDay: [], farmers: 0, visitCounts: {}, perWeek: [], byWeekday: {}, avgRevisitDays: 0, visitedIds: [], points: [], attention: [] };
  if (!sheet || sheet.getLastRow() < 2) return json(empty);
  var data = sheet.getDataRange().getValues(); var head = data.shift();
  var col = {}; head.forEach(function (h, i) { col[h] = i; });
  var byStaff = {}, byStage = {}, byCond = {}, byDist = {}, perDay = {}, perWeek = {}, byWeekday = {}, farmerDates = {}, points = [];
  var WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  data.forEach(function (r) {
    inc(byStaff, r[col.staff_name]); inc(byStage, r[col.crop_stage]);
    inc(byCond, r[col.condition]); inc(byDist, r[col.district]);
    var raw = r[col.visit_date];
    var ds = (raw instanceof Date) ? raw.toISOString().slice(0,10) : String(raw).slice(0,10);
    if (ds) { inc(perDay, ds); inc(perWeek, mondayOf(ds)); var wd = new Date(ds).getDay(); if (!isNaN(wd)) inc(byWeekday, WD[wd]); }
    var fid = r[col.farmer_id]; if (fid) { (farmerDates[fid] = farmerDates[fid] || []).push(ds); }
    var la = r[col.lat], lo = r[col.lon];
    if (la !== "" && lo !== "" && la != null && lo != null)
      points.push({ lat: la, lon: lo, condition: r[col.condition], farmer_name: r[col.farmer_name], village: r[col.village], crop: r[col.crop], visit_date: ds });
  });
  var visitCounts = { "1 visit": 0, "2 visits": 0, "3+ visits": 0 }, gapSum = 0, gapN = 0;
  Object.keys(farmerDates).forEach(function (fid) {
    var d = farmerDates[fid].slice().sort(), n = d.length;
    if (n === 1) visitCounts["1 visit"]++; else if (n === 2) visitCounts["2 visits"]++; else visitCounts["3+ visits"]++;
    for (var i = 1; i < n; i++) { var g = (new Date(d[i]) - new Date(d[i-1])) / 86400000; if (g >= 0) { gapSum += g; gapN++; } }
  });
  var days = Object.keys(perDay).sort().slice(-14).map(function (d) { return { date: d, count: perDay[d] }; });
  var weeks = Object.keys(perWeek).sort().slice(-8).map(function (w) { return { week: w, count: perWeek[w] }; });
  var today2 = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var lastVisit = {}; Object.keys(farmerDates).forEach(function (fid) { var dd = farmerDates[fid].slice().sort(); lastVisit[fid] = dd[dd.length - 1]; });
  var attention = []; var rs2 = ss.getSheetByName(REVIEWS);
  if (rs2 && rs2.getLastRow() > 1) {
    var rd2 = rs2.getDataRange().getValues(); var rh2 = rd2.shift(); var rc2 = {}; rh2.forEach(function (h, i) { rc2[h] = i; });
    rd2.forEach(function (r) {
      var nvd = fmtDate(r[rc2.next_visit_date]); if (!nvd || nvd >= today2) return;
      var done = String(r[rc2.actions_done]).toLowerCase() === "yes"; var fid = String(r[rc2.farmer_id]);
      var revisited = lastVisit[fid] && lastVisit[fid] > nvd;
      if (!done || !revisited) attention.push({ farmer_id: fid, farmer_name: r[rc2.farmer_name], village: r[rc2.village], next_visit_date: nvd, actions: r[rc2.actions], done: done, revisited: !!revisited, days_overdue: Math.round((new Date(today2) - new Date(nvd)) / 86400000) });
    });
  }
  return json({ status: "ok", total: data.length, byStaff: byStaff, byStage: byStage, byCondition: byCond, byDistrict: byDist,
    perDay: days, farmers: Object.keys(farmerDates).length, visitCounts: visitCounts, perWeek: weeks, byWeekday: byWeekday,
    avgRevisitDays: gapN ? Math.round(gapSum / gapN) : 0, visitedIds: Object.keys(farmerDates), points: points.slice(-300), attention: attention });
}
function mondayOf(ds) { var dt = new Date(ds); var day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day); return dt.toISOString().slice(0,10); }
function inc(o, k) { k = (k === "" || k == null) ? "—" : k; o[k] = (o[k] || 0) + 1; }

/* ---------- native Google-Sheet dashboard (run from the editor or menu) ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu("Dashboard").addItem("Build / refresh", "buildDashboard").addToParent();
}
function buildDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName(VISITS); if (!src) return;
  var dash = ss.getSheetByName("Dashboard") || ss.insertSheet("Dashboard");
  dash.clear(); dash.getCharts().forEach(function (c) { dash.removeChart(c); });
  dash.getRange("A1").setValue("Field visit dashboard — refreshed " + new Date()).setFontWeight("bold");
  // summary tables via QUERY on the Visits sheet
  dash.getRange("A3").setValue("Visits by staff");
  dash.getRange("A4").setFormula('=QUERY(' + VISITS + '!A:Z,"select E, count(A) where E is not null group by E order by count(A) desc label count(A) \'visits\'",1)');
  dash.getRange("D3").setValue("Visits by crop stage");
  dash.getRange("D4").setFormula('=QUERY(' + VISITS + '!A:Z,"select O, count(A) where O is not null group by O label count(A) \'visits\'",1)');
  dash.getRange("G3").setValue("Visits by condition");
  dash.getRange("G4").setFormula('=QUERY(' + VISITS + '!A:Z,"select P, count(A) where P is not null group by P label count(A) \'visits\'",1)');
  SpreadsheetApp.flush();
  var chart = dash.newChart().asColumnChart()
    .addRange(dash.getRange("A4:B20")).setPosition(20, 1, 0, 0)
    .setOption("title", "Visits by staff").build();
  dash.insertChart(chart);
}

function photosList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(); var sheet = ss.getSheetByName(VISITS);
  if (!sheet || sheet.getLastRow() < 2) return json({ status: "ok", items: [] });
  var data = sheet.getDataRange().getValues(); var head = data.shift(); var col = {}; head.forEach(function (h, i) { col[h] = i; });
  var items = [];
  for (var j = data.length - 1; j >= 0 && items.length < 300; j--) {
    var r = data[j];
    ["photo1","photo2","photo3"].forEach(function (p) {
      var u = col[p] === undefined ? "" : r[col[p]];
      if (u) items.push({
        url: driveThumb(String(u), 400), full: driveThumb(String(u), 1200), open: String(u),
        farmer_name: r[col.farmer_name], village: r[col.village], crop: r[col.crop], seed_variety: r[col.seed_variety],
        area_ha: r[col.area_ha], lat: r[col.lat], lon: r[col.lon], visit_date: fmtDate(r[col.visit_date]),
        crop_stage: r[col.crop_stage], condition: r[col.condition]
      });
    });
  }
  return json({ status: "ok", items: items });
}
function driveThumb(u, size) { var m = u.match(/[-\w]{25,}/); return m ? "https://drive.google.com/thumbnail?id=" + m[0] + "&sz=w" + (size || 1000) : u; }
function fmtDate(d) { return d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10); }

/* ---------- reviews: visits list (with reviews + photos) and upsert ---------- */
function visitsList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(); var sheet = ss.getSheetByName(VISITS);
  if (!sheet || sheet.getLastRow() < 2) return json({ status: "ok", items: [] });
  var data = sheet.getDataRange().getValues(); var head = data.shift(); var col = {}; head.forEach(function (h, i) { col[h] = i; });
  var rev = {}; var rs = ss.getSheetByName(REVIEWS);
  if (rs && rs.getLastRow() > 1) {
    var rd = rs.getDataRange().getValues(); var rh = rd.shift(); var rc = {}; rh.forEach(function (h, i) { rc[h] = i; });
    rd.forEach(function (r) { rev[String(r[rc.visit_id])] = { comment: r[rc.comment], condition_review: r[rc.condition_review], actions: r[rc.actions], next_visit_date: fmtDate(r[rc.next_visit_date]), actions_done: r[rc.actions_done], reviewer: r[rc.reviewer] }; });
  }
  var items = [];
  for (var j = data.length - 1; j >= 0 && items.length < 300; j--) {
    var r = data[j];
    var photos = ["photo1","photo2","photo3"].map(function (p) { var u = col[p] === undefined ? "" : r[col[p]]; return u ? driveThumb(String(u), 600) : ""; }).filter(Boolean);
    var vid = String(r[col.visit_id]);
    items.push({ visit_id: vid, staff_id: r[col.staff_id], farmer_id: r[col.farmer_id], farmer_name: r[col.farmer_name], village: r[col.village], district: r[col.district], block: r[col.block],
      visit_date: fmtDate(r[col.visit_date]), crop_stage: r[col.crop_stage], condition: r[col.condition], staff_name: r[col.staff_name],
      immediate_actions: col.immediate_actions !== undefined ? r[col.immediate_actions] : "", photos: photos, review: rev[vid] || null });
  }
  return json({ status: "ok", items: items });
}
function saveReview(rev) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(REVIEWS) || ss.insertSheet(REVIEWS);
  if (s.getLastRow() === 0) s.appendRow(R_HEADERS);
  var data = s.getDataRange().getValues(); var head = data.shift(); var ci = {}; head.forEach(function (h, i) { ci[h] = i; });
  var rowIdx = -1; for (var k = 0; k < data.length; k++) { if (String(data[k][ci.visit_id]) === String(rev.visit_id)) { rowIdx = k + 2; break; } }
  var row = R_HEADERS.map(function (h) { return h === "updated_at" ? new Date() : (rev[h] !== undefined ? rev[h] : ""); });
  if (rowIdx > 0) s.getRange(rowIdx, 1, 1, R_HEADERS.length).setValues([row]); else s.appendRow(row);
  try { CacheService.getScriptCache().removeAll(["stats", "visits"]); } catch (e) {}
  return json({ status: "ok", visit_id: rev.visit_id });
}

/* ---------- daily backup of the whole Sheet to Drive ---------- */
function backupNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var it = DriveApp.getFoldersByName("Field Visit Backups");
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder("Field Visit Backups");
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd_HH-mm");
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + " backup " + stamp, folder);
  // keep only the 30 most recent backups
  var files = folder.getFiles(), arr = []; while (files.hasNext()) arr.push(files.next());
  arr.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = 30; i < arr.length; i++) arr[i].setTrashed(true);
}
function setupDailyBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "backupNow") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("backupNow").timeBased().everyDays(1).atHour(1).create();
}

function json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
