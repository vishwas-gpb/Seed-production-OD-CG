/* Field Visit Log — offline PWA with admin-approved PIN login. */
const ENDPOINT = "https://script.google.com/macros/s/AKfycbzL6g-AoOtaXSKjvrqyYK3r_-7zvfz05eDu1REVwS3-Anhp5YY9E6biZCrjbP5XYb_LMw/exec";

const STAGES    = ["Germination","Vegetative","Flowering","Podset","Harvesting"];
const CONDITION = ["Good","Average","Poor"];
const PURPOSES  = ["Routine monitoring","Pest / disease check","Roguing guidance","Crop stage assessment","Harvest assessment","Input / advisory","Other"];
const FCOLS = ["district","block","gp","village","farmer_name","father_name","mobile","farmer_id","gender","caste","crop","seed_variety","seed_class","seed_qty_kg","area_ha","date_distribution","date_sowing"];

let FARMERS = [], photos = [null,null,null], selectedFarmer = null, SESSION = null;

function el(id){ return document.getElementById(id); }
function toast(m){ const t=el("toast"); t.textContent=m; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2400); }
function deviceId(){ let id=localStorage.getItem("device_id"); if(!id){id="dev-"+Math.random().toString(36).slice(2,8);localStorage.setItem("device_id",id);} return id; }
function api(payload){ return fetch(ENDPOINT,{method:"POST",body:JSON.stringify(payload)}).then(r=>r.json()); }

/* ---------- PIN hashing (matches Apps Script: SHA-256 of salt+":"+pin) ---------- */
async function hashPin(pin, salt){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt+":"+pin));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

/* ---------- auth ---------- */
function authTab(which){
  el("pane-signin").classList.toggle("hidden", which!=="signin");
  el("pane-register").classList.toggle("hidden", which!=="register");
  el("tab-signin").classList.toggle("active", which==="signin");
  el("tab-register").classList.toggle("active", which==="register");
}
function saveProfile(p){ localStorage.setItem("profile:"+p.staff_id, JSON.stringify(p)); }
function getProfile(id){ try{ return JSON.parse(localStorage.getItem("profile:"+id)); }catch(e){ return null; } }

async function register(){
  const name=el("rg_name").value.trim(), id=el("rg_id").value.trim(), phone=el("rg_phone").value.trim();
  const pin=el("rg_pin").value.trim(), pin2=el("rg_pin2").value.trim();
  if(!name||!id||!pin){ el("rg_msg").textContent="Fill name, Staff ID and PIN."; return; }
  if(pin.length<4){ el("rg_msg").textContent="PIN must be at least 4 digits."; return; }
  if(pin!==pin2){ el("rg_msg").textContent="PINs do not match."; return; }
  if(ENDPOINT.indexOf("PASTE_YOUR")===0){ el("rg_msg").textContent="App not configured (ENDPOINT)."; return; }
  if(!navigator.onLine){ el("rg_msg").textContent="You need internet to create a profile."; return; }
  el("rg_msg").textContent="Submitting...";
  try{
    const out=await api({action:"register", staff_id:id, name, phone, pin});
    if(out.status==="ok") el("rg_msg").textContent="Profile submitted. An admin must approve it before you can sign in.";
    else el("rg_msg").textContent=out.message||"Could not register.";
  }catch(e){ el("rg_msg").textContent="Network error — try again."; }
}

async function signIn(){
  const id=el("si_id").value.trim(), pin=el("si_pin").value.trim();
  if(!id||!pin){ el("si_msg").textContent="Enter Staff ID and PIN."; return; }
  el("si_msg").textContent="Checking...";
  if(navigator.onLine && ENDPOINT.indexOf("PASTE_YOUR")!==0){
    try{
      const out=await api({action:"login", staff_id:id, pin});
      if(out.status==="ok"){
        const prof={staff_id:id, name:out.name, salt:out.salt, pin_hash:out.pin_hash};
        saveProfile(prof); enterApp(prof); return;
      }
      if(out.status==="pending"){ el("si_msg").textContent="Your profile is awaiting admin approval."; return; }
      if(out.status==="rejected"){ el("si_msg").textContent="Your profile was not approved."; return; }
      el("si_msg").textContent=out.message||"Sign in failed."; return;
    }catch(e){ /* fall through to offline check */ }
  }
  // offline sign-in against a previously-approved profile saved on this device
  const prof=getProfile(id);
  if(prof && await hashPin(pin, prof.salt)===prof.pin_hash){ enterApp(prof); toast("Signed in offline"); return; }
  el("si_msg").textContent = navigator.onLine ? "Sign in failed." : "Offline: no approved profile saved on this device yet.";
}

function enterApp(prof){
  SESSION=prof; localStorage.setItem("session", JSON.stringify({staff_id:prof.staff_id, name:prof.name}));
  el("auth").classList.add("hidden"); el("app").classList.remove("hidden");
  el("who").textContent=prof.name || prof.staff_id;
  initApp();
}
function signOut(){ localStorage.removeItem("session"); location.reload(); }

/* ---------- IndexedDB ---------- */
let _db;
function db(){ if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{ const r=indexedDB.open("fieldvisit",1);
    r.onupgradeneeded=e=>{ const d=e.target.result; if(!d.objectStoreNames.contains("visits")) d.createObjectStore("visits",{keyPath:"id",autoIncrement:true}); };
    r.onsuccess=()=>{_db=r.result;res(_db);}; r.onerror=()=>rej(r.error); }); }
function st(m){ return db().then(d=>d.transaction("visits",m).objectStore("visits")); }
function idbAll(){ return st("readonly").then(s=>new Promise((res,rej)=>{const r=s.getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);})); }
function idbPut(v){ return st("readwrite").then(s=>new Promise((res,rej)=>{const r=s.put(v);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);})); }
function idbDel(id){ return st("readwrite").then(s=>new Promise((res,rej)=>{const r=s.delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);})); }

/* ---------- helpers ---------- */
function fillSelect(id,opts,blank){ const s=el(id); s.innerHTML=""; (blank?[""].concat(opts):opts).forEach(o=>{const op=document.createElement("option");op.value=o;op.textContent=o||"- any -";s.appendChild(op);}); }
function uniqueSorted(a){ return Array.from(new Set(a.filter(x=>x!==undefined&&x!==""))).sort(); }
function setNet(){ const p=el("net"); if(!p) return; if(navigator.onLine){p.textContent="online";p.classList.remove("off");} else {p.textContent="offline";p.classList.add("off");} }
function showView(v){ ["new","rec","dash"].forEach(k=>{ el("view-"+k).classList.toggle("hidden",k!==v); el("tab-"+k).classList.toggle("active",k===v); }); if(v==="rec") render(); if(v==="dash") dashboard(); }

/* ---------- farmers ---------- */
function parseCSV(t){ const rows=[]; let row=[],f="",q=false;
  for(let i=0;i<t.length;i++){ const c=t[i];
    if(q){ if(c==='"'){ if(t[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else { if(c==='"') q=true; else if(c===","){row.push(f);f="";} else if(c==="\n"){row.push(f);rows.push(row);row=[];f="";} else if(c==="\r"){} else f+=c; } }
  if(f.length||row.length){ row.push(f); rows.push(row); } return rows; }
async function loadFarmers(){
  try{ const res=await fetch("farmers.csv",{cache:"no-cache"}); if(!res.ok) throw 0;
    const rows=parseCSV(await res.text()).filter(r=>r.length>1); const head=rows.shift().map(h=>h.trim().toLowerCase());
    FARMERS=rows.map(r=>{const o={}; head.forEach((h,i)=>o[h]=(r[i]||"").trim()); return o;}); initFilters();
  }catch(e){ toast("Could not load farmers.csv"); } }
function initFilters(){ fillSelect("f_district",uniqueSorted(FARMERS.map(f=>f.district)),true); fillSelect("f_block",[],true); fillSelect("f_gp",[],true); fillSelect("f_village",[],true); onFilter(); }
function matchFarmers(){ const d=el("f_district").value,b=el("f_block").value,g=el("f_gp").value,v=el("f_village").value,q=el("f_search").value.trim().toLowerCase();
  return FARMERS.filter(f=>(!d||f.district===d)&&(!b||f.block===b)&&(!g||f.gp===g)&&(!v||f.village===v)&&(!q||(f.farmer_name||"").toLowerCase().includes(q)||(f.farmer_id||"").toLowerCase().includes(q))); }
function onFilter(){
  const d=el("f_district").value; const inD=FARMERS.filter(f=>!d||f.district===d);
  fillSelect("f_block",uniqueSorted(inD.map(f=>f.block)),true);
  const b=el("f_block").value; const inB=inD.filter(f=>!b||f.block===b); fillSelect("f_gp",uniqueSorted(inB.map(f=>f.gp)),true);
  const g=el("f_gp").value; const inG=inB.filter(f=>!g||f.gp===g); fillSelect("f_village",uniqueSorted(inG.map(f=>f.village)),true);
  const m=matchFarmers(), list=m.slice(0,300), s=el("farmer"); s.innerHTML="";
  const ph=document.createElement("option"); ph.value=""; ph.textContent="- select ("+m.length+" match) -"; s.appendChild(ph);
  list.forEach(f=>{const op=document.createElement("option"); op.value=String(FARMERS.indexOf(f)); op.textContent=(f.farmer_name||"?")+" - "+(f.village||"")+" - "+(f.farmer_id||""); s.appendChild(op);});
  el("farmercard").classList.add("hidden"); selectedFarmer=null; }
function onFarmerPick(){ const idx=el("farmer").value; if(idx===""){ el("farmercard").classList.add("hidden"); selectedFarmer=null; return; }
  const f=FARMERS[Number(idx)]; selectedFarmer=f; el("farmercard").classList.remove("hidden");
  const shown={farmer_name:1,farmer_id:1,father_name:1,village:1,gp:1,block:1,district:1,crop:1,seed_variety:1,seed_class:1,date_sowing:1,area_ha:1,mobile:1};
  let extra=""; Object.keys(f).forEach(k=>{ if(!shown[k] && f[k]) extra+="<br>"+k.replace(/_/g," ")+": "+f[k]; });
  el("farmercard").innerHTML="<b>"+(f.farmer_name||"")+"</b> ("+(f.farmer_id||"")+")<br>"+(f.father_name?("F/H: "+f.father_name+"<br>"):"")+
    (f.village||"")+", "+(f.gp||"")+", "+(f.block||"")+", "+(f.district||"")+"<br>Crop: "+(f.crop||"-")+" - Variety: "+(f.seed_variety||"-")+" - Class: "+(f.seed_class||"-")+"<br>Sown: "+(f.date_sowing||"-")+" - Area: "+(f.area_ha||"-")+" ha"+extra; }

/* ---------- GPS & photos ---------- */
function captureGPS(){ if(!navigator.geolocation){ toast("No geolocation"); return; } toast("Getting GPS...");
  navigator.geolocation.getCurrentPosition(p=>{ window._lat=p.coords.latitude.toFixed(6); window._lon=p.coords.longitude.toFixed(6); el("gps_display").value=window._lat+", "+window._lon; toast("GPS captured"); }, ()=>toast("Could not get GPS"), {enableHighAccuracy:true,timeout:10000}); }
function onPhoto(input,slot){ const file=input.files[0]; if(!file) return; const reader=new FileReader();
  reader.onload=e=>{ const img=new Image(); img.onload=()=>{ const max=1000; let w=img.width,h=img.height;
    if(w>h&&w>max){h=Math.round(h*max/w);w=max;} else if(h>max){w=Math.round(w*max/h);h=max;}
    const c=document.createElement("canvas"); c.width=w; c.height=h; c.getContext("2d").drawImage(img,0,0,w,h);
    photos[slot]=c.toDataURL("image/jpeg",0.6);
    el("slot"+slot).innerHTML="<img src='"+photos[slot]+"'><button class='x' onclick='removePhoto("+slot+")'>x</button>"; }; img.src=e.target.result; };
  reader.readAsDataURL(file); }
function removePhoto(slot){ photos[slot]=null; el("slot"+slot).innerHTML="<label for='cam"+slot+"'>+</label><input id='cam"+slot+"' type='file' accept='image/*' capture='environment' class='hidden' onchange='onPhoto(this,"+slot+")'>"; }

/* ---------- visits ---------- */
function resetVisit(){ el("farmer").value=""; el("farmercard").classList.add("hidden"); selectedFarmer=null;
  el("crop_stage").selectedIndex=0; el("condition").selectedIndex=0; el("purpose").selectedIndex=0; el("notes").value=""; el("gps_display").value=""; window._lat=""; window._lon=""; [0,1,2].forEach(removePhoto); }
async function saveVisit(){
  if(!selectedFarmer){ toast("Select a farmer first"); return; }
  const now=new Date(), f=selectedFarmer;
  const v={ synced:false, device_id:deviceId(),
    visit_id:"V-"+now.getTime().toString(36)+"-"+Math.random().toString(36).slice(2,5),
    staff_id:SESSION.staff_id, staff_name:SESSION.name||SESSION.staff_id,
    farmer_id:f.farmer_id||"", farmer_name:f.farmer_name||"", district:f.district||"", block:f.block||"", gp:f.gp||"", village:f.village||"",
    crop:f.crop||"", seed_variety:f.seed_variety||"", seed_class:f.seed_class||"",
    visit_date:now.toISOString().slice(0,10), visit_time:now.toTimeString().slice(0,8),
    lat:window._lat||"", lon:window._lon||"", crop_stage:el("crop_stage").value, condition:el("condition").value, purpose:el("purpose").value,
    notes:el("notes").value, logged_at:now.toISOString(), photos:photos.filter(Boolean) };
  await idbPut(v); toast("Visit saved on this device"); resetVisit(); updateCounts(); syncNow(false);
}
async function render(){ const all=(await idbAll()).sort((a,b)=>(b.logged_at||"").localeCompare(a.logged_at||"")); const tb=el("rows"); tb.innerHTML="";
  all.forEach(v=>{ const tr=document.createElement("tr");
    tr.innerHTML="<td>"+v.visit_date+"</td><td>"+(v.farmer_name||"")+"</td><td>"+(v.village||"")+"</td><td>"+(v.crop_stage||"")+"</td><td>"+(v.condition||"")+"</td><td>"+(v.synced?"OK":"<span class='badge'>pending</span>")+"</td><td><button class='btn danger small' data-id='"+v.id+"'>Del</button></td>";
    tb.appendChild(tr); });
  tb.querySelectorAll("button[data-id]").forEach(b=>b.addEventListener("click",async()=>{await idbDel(Number(b.dataset.id));render();updateCounts();toast("Deleted");})); updateCounts(); }
async function updateCounts(){ const all=await idbAll(), pend=all.filter(v=>!v.synced).length; el("count").textContent=all.length+" visits"; const u=el("unsynced"); if(u){ u.textContent=pend+" not uploaded"; u.style.display=pend?"":"none"; } }
async function exportCSV(){ const all=await idbAll(); if(!all.length){ toast("No visits"); return; }
  const cols=["visit_id","visit_date","visit_time","staff_id","staff_name","farmer_id","farmer_name","district","block","gp","village","crop","seed_variety","seed_class","crop_stage","condition","purpose","lat","lon","notes","logged_at","device_id","synced"];
  const esc=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"'; const csv=[cols.join(",")].concat(all.map(r=>cols.map(c=>esc(r[c])).join(","))).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download="field-visits-"+new Date().toISOString().slice(0,10)+".csv"; a.click(); URL.revokeObjectURL(a.href); }

/* ---------- sync ---------- */
let syncing=false;
async function syncNow(manual){
  if(syncing) return;
  if(!navigator.onLine){ if(manual) toast("Offline - will upload later"); return; }
  if(ENDPOINT.indexOf("PASTE_YOUR")===0){ if(manual) toast("Set ENDPOINT in app.js"); return; }
  const pending=(await idbAll()).filter(v=>!v.synced); if(!pending.length){ if(manual) toast("All uploaded"); return; }
  syncing=true; if(manual) toast("Uploading "+pending.length+"..."); let ok=0;
  try{ for(const v of pending){ try{ const out=await api({action:"visit", visit:v}); if(out&&out.status==="ok"){ v.synced=true; delete v.photos; await idbPut(v); ok++; } }catch(e){ break; } }
    if(manual) toast("Uploaded "+ok+" of "+pending.length); }
  finally{ syncing=false; render(); updateCounts(); } }

/* ---------- dashboards ---------- */
function bars(id,counts,limit){ const c=el(id); c.innerHTML=""; const max=Math.max(1,...Object.values(counts));
  let keys=Object.keys(counts).sort((a,b)=>counts[b]-counts[a]); if(limit) keys=keys.slice(0,limit);
  keys.forEach(k=>{ const r=document.createElement("div"); r.className="bar-row";
    r.innerHTML="<span class='lab'>"+k+"</span><span class='bar-track'><span class='bar' style='width:"+(counts[k]/max*100)+"%'></span></span><span>"+counts[k]+"</span>"; c.appendChild(r); });
  if(!Object.keys(counts).length) c.innerHTML="<span class='muted'>No data yet</span>"; }
function sumBy(rows,keyField,valField){ const o={}; rows.forEach(r=>{ const k=(r[keyField]||"-"); const n=parseFloat(r[valField]); if(!isNaN(n)) o[k]=Math.round(((o[k]||0)+n)*10)/10; }); return o; }
function farmersDashboard(){
  if(!FARMERS.length){ el("fm_stats").innerHTML="<span class='muted'>Load farmers.csv to see coverage.</span>"; return; }
  const totalArea=Math.round(FARMERS.reduce((s,f)=>s+(parseFloat(f.area_ha)||0),0)*10)/10;
  const crops=new Set(FARMERS.map(f=>f.crop).filter(Boolean)).size;
  const villages=new Set(FARMERS.map(f=>f.village).filter(Boolean)).size;
  el("fm_stats").innerHTML="<span class='stat'><b>"+FARMERS.length+"</b>registered farmers</span>"+
    "<span class='stat'><b>"+totalArea+"</b>total area (ha)</span>"+
    "<span class='stat'><b>"+crops+"</b>crops</span>"+
    "<span class='stat'><b>"+villages+"</b>villages</span>";
  bars("fm_crop_area", sumBy(FARMERS,"crop","area_ha"));
  bars("fm_block_area", sumBy(FARMERS,"block","area_ha"));
  bars("fm_variety_area", sumBy(FARMERS,"seed_variety","area_ha"), 10);
}
async function dashboard(){ farmersDashboard(); const all=await idbAll();
  const uf=new Set(all.map(v=>v.farmer_id).filter(Boolean)).size, days=new Set(all.map(v=>v.visit_date)).size, pd=days?(all.length/days).toFixed(1):"0";
  el("stats").innerHTML="<span class='stat'><b>"+all.length+"</b>visits (device)</span><span class='stat'><b>"+uf+"</b>farmers</span><span class='stat'><b>"+pd+"</b>per active day</span>";
  const cnt=k=>{const o={}; all.forEach(v=>{const x=v[k]||"-"; o[x]=(o[x]||0)+1;}); return o;};
  bars("by_stage",cnt("crop_stage")); bars("by_cond",cnt("condition")); }
async function loadTeam(){
  if(!navigator.onLine){ el("team_stats").innerHTML="<span class='muted'>Offline - connect to load team totals.</span>"; return; }
  if(ENDPOINT.indexOf("PASTE_YOUR")===0){ el("team_stats").innerHTML="<span class='muted'>Set ENDPOINT first.</span>"; return; }
  el("team_stats").innerHTML="<span class='muted'>Loading...</span>";
  try{ const s=await api({action:"stats"});
    el("team_stats").innerHTML="<span class='stat'><b>"+s.total+"</b>total visits</span><span class='stat'><b>"+s.farmers+"</b>farmers visited</span>";
    bars("team_staff",s.byStaff||{}); bars("team_stage",s.byStage||{});
    const day={}; (s.perDay||[]).forEach(d=>day[(d.date||"").slice(5)]=d.count); bars("team_day",day);
  }catch(e){ el("team_stats").innerHTML="<span class='muted'>Could not load team stats.</span>"; } }

/* ---------- boot ---------- */
window.addEventListener("online",()=>{setNet();syncNow(false);});
window.addEventListener("offline",setNet);
function initApp(){
  fillSelect("crop_stage",STAGES); fillSelect("condition",CONDITION); fillSelect("purpose",PURPOSES);
  setNet(); updateCounts(); loadFarmers(); setTimeout(()=>syncNow(false),1500);
}
(function boot(){
  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
  let s=null; try{ s=JSON.parse(localStorage.getItem("session")); }catch(e){}
  if(s && s.staff_id){ const prof=getProfile(s.staff_id); if(prof){ enterApp(prof); return; } }
  authTab("signin");
})();
