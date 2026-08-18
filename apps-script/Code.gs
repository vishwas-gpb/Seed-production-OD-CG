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

var V_HEADERS = ["visit_id","visit_date","visit_time","staff_id","staff_name","state","agency","farmer_id","farmer_name",
  "district","block","gp","village","crop","seed_variety","seed_class",
  "crop_stage","condition","purpose","immediate_actions","lat","lon","notes",
  "photo1","photo2","photo3","logged_at","device_id","received_at"];
var U_HEADERS = ["staff_id","name","phone","salt","pin_hash","status","role","registered_at","approved_at"];

function doPost(e) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || "visit";
    if (action === "register") return register(body);
    if (action === "login")    return login(body);
    if (action === "stats")    return stats();
    return saveVisit(body.visit);
  } catch (err) {
    return json({ status: "error", message: String(err) });
  } finally { lock.releaseLock(); }
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
  if (!sheet || sheet.getLastRow() < 2) return json({ status: "ok", total: 0, byStaff: {}, byStage: {}, byCondition: {}, byDistrict: {}, perDay: [], farmers: 0 });
  var data = sheet.getDataRange().getValues(); var head = data.shift();
  var col = {}; head.forEach(function (h, i) { col[h] = i; });
  var byStaff = {}, byStage = {}, byCond = {}, byDist = {}, perDay = {}, farmers = {};
  data.forEach(function (r) {
    inc(byStaff, r[col.staff_name]); inc(byStage, r[col.crop_stage]);
    inc(byCond, r[col.condition]); inc(byDist, r[col.district]);
    inc(perDay, r[col.visit_date]); if (r[col.farmer_id]) farmers[r[col.farmer_id]] = 1;
  });
  var days = Object.keys(perDay).sort().slice(-14).map(function (d) { return { date: d, count: perDay[d] }; });
  return json({ status: "ok", total: data.length, byStaff: byStaff, byStage: byStage,
    byCondition: byCond, byDistrict: byDist, perDay: days, farmers: Object.keys(farmers).length });
}
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

function json(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
