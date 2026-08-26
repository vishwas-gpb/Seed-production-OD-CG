/* Field Visit Log — offline PWA, admin-approved PIN login, roles, SVG graphs. */
const ENDPOINT = "https://script.google.com/macros/library/d/1v3S8wI1cGzNHeJoEnRKNYnBM7wNqK7SBOOqy7x_9HVikUS22MIfHdt5U/3";

const STAGES    = ["Germination","Vegetative","Flowering","Podset","Harvesting"];
const CONDITION = ["Good","Average","Poor"];
const PURPOSES  = ["Routine monitoring","Pest / disease check","Roguing guidance","Crop stage assessment","Harvest assessment","Input / advisory","Other"];

let FARMERS = [], photos = [null,null,null], selectedFarmer = null, SESSION = null;

function el(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function toast(m){ const t=el("toast"); t.textContent=m; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2600); }
function deviceId(){ let id=localStorage.getItem("device_id"); if(!id){id="dev-"+Math.random().toString(36).slice(2,8);localStorage.setItem("device_id",id);} return id; }
function api(payload){ return fetch(ENDPOINT,{method:"POST",body:JSON.stringify(payload)}).then(r=>r.json()); }
async function apiRead(payload,tries){ tries=tries||3; let err;
  for(let i=0;i<tries;i++){ try{ const r=await fetch(ENDPOINT,{method:"POST",body:JSON.stringify(payload)}); if(!r.ok) throw new Error("HTTP "+r.status); return await r.json(); }
    catch(e){ err=e; if(i<tries-1) await new Promise(res=>setTimeout(res,700*(i+1))); } }
  throw err; }
function cacheSet(k,v){ try{ localStorage.setItem("cache:"+k,JSON.stringify(v)); }catch(e){} }
function cacheGet(k){ try{ return JSON.parse(localStorage.getItem("cache:"+k)); }catch(e){ return null; } }
function getGPS(){ return new Promise(res=>{ if(!navigator.geolocation){ res(null); return; }
  navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude.toFixed(6),lon:p.coords.longitude.toFixed(6)}), ()=>res(null), {enableHighAccuracy:true,timeout:15000,maximumAge:0}); }); }

async function hashPin(pin, salt){ const buf=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt+":"+pin)); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join(""); }

/* ---------- auth ---------- */
function authTab(w){ el("pane-signin").classList.toggle("hidden",w!=="signin"); el("pane-register").classList.toggle("hidden",w!=="register"); el("tab-signin").classList.toggle("active",w==="signin"); el("tab-register").classList.toggle("active",w==="register"); }
function saveProfile(p){ localStorage.setItem("profile:"+p.staff_id, JSON.stringify(p)); }
function getProfile(id){ try{ return JSON.parse(localStorage.getItem("profile:"+id)); }catch(e){ return null; } }
async function register(){
  const name=el("rg_name").value.trim(),id=el("rg_id").value.trim(),phone=el("rg_phone").value.trim(),pin=el("rg_pin").value.trim(),pin2=el("rg_pin2").value.trim();
  if(!name||!id||!pin){ el("rg_msg").textContent="Fill name, Staff ID and PIN."; return; }
  if(pin.length<4){ el("rg_msg").textContent="PIN must be at least 4 digits."; return; }
  if(pin!==pin2){ el("rg_msg").textContent="PINs do not match."; return; }
  if(ENDPOINT.indexOf("PASTE_YOUR")===0){ el("rg_msg").textContent="App not configured (ENDPOINT)."; return; }
  if(!navigator.onLine){ el("rg_msg").textContent="You need internet to create a profile."; return; }
  el("rg_msg").textContent="Submitting...";
  try{ const out=await api({action:"register",staff_id:id,name,phone,pin});
    el("rg_msg").textContent = out.status==="ok" ? "Profile submitted. An admin must approve it before you can sign in." : (out.message||"Could not register."); }
  catch(e){ el("rg_msg").textContent="Network error - try again."; }
}
async function signIn(){
  const id=el("si_id").value.trim(),pin=el("si_pin").value.trim();
  if(!id||!pin){ el("si_msg").textContent="Enter Staff ID and PIN."; return; }
  el("si_msg").textContent="Checking...";
  if(navigator.onLine && ENDPOINT.indexOf("PASTE_YOUR")!==0){
    try{ const out=await api({action:"login",staff_id:id,pin});
      if(out.status==="ok"){ const prof={staff_id:id,name:out.name,salt:out.salt,pin_hash:out.pin_hash,role:out.role||"staff"}; saveProfile(prof); enterApp(prof); return; }
      if(out.status==="pending"){ el("si_msg").textContent="Your profile is awaiting admin approval."; return; }
      if(out.status==="rejected"){ el("si_msg").textContent="Your profile was not approved."; return; }
      el("si_msg").textContent=out.message||"Sign in failed."; return;
    }catch(e){ /* fall through to offline */ }
  }
  const prof=getProfile(id);
  if(prof && await hashPin(pin,prof.salt)===prof.pin_hash){ enterApp(prof); toast("Signed in offline"); return; }
  el("si_msg").textContent = navigator.onLine ? "Sign in failed." : "Offline: no approved profile saved on this device yet.";
}
function applyRole(role){ const viewer=(role==="viewer"); el("tab-new").style.display=viewer?"none":""; el("tab-rec").style.display=viewer?"none":""; el("tab-farmers").style.display=viewer?"":"none"; if(viewer){ GALLERY_SOURCE="team"; const gs=el("gal_source"); if(gs) gs.value="team"; el("who").textContent+=" (management)"; showView("farmers"); } }
function enterApp(prof){ SESSION=prof; localStorage.setItem("session",JSON.stringify({staff_id:prof.staff_id,name:prof.name})); el("auth").classList.add("hidden"); el("app").classList.remove("hidden"); el("who").textContent=prof.name||prof.staff_id; applyRole(prof.role||"staff"); initApp(); renderIcons(document); }
function signOut(){ localStorage.removeItem("session"); location.reload(); }

/* ---------- IndexedDB ---------- */
let _db;
function db(){ if(_db) return Promise.resolve(_db);
  return new Promise((res,rej)=>{ const r=indexedDB.open("fieldvisit",1);
    r.onupgradeneeded=e=>{ const d=e.target.result; if(!d.objectStoreNames.contains("visits")) d.createObjectStore("visits",{keyPath:"id",autoIncrement:true}); };
    r.onsuccess=()=>{_db=r.result;res(_db);}; r.onerror=()=>rej(r.error); }); }
function stv(m){ return db().then(d=>d.transaction("visits",m).objectStore("visits")); }
function idbAll(){ return stv("readonly").then(s=>new Promise((res,rej)=>{const r=s.getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);})); }
function idbPut(v){ return stv("readwrite").then(s=>new Promise((res,rej)=>{const r=s.put(v);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);})); }
function idbDel(id){ return stv("readwrite").then(s=>new Promise((res,rej)=>{const r=s.delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);})); }

/* ---------- helpers ---------- */
function fillSelect(id,opts,blank){ const s=el(id); s.innerHTML=""; (blank?[""].concat(opts):opts).forEach(o=>{const op=document.createElement("option");op.value=o;op.textContent=o||"- any -";s.appendChild(op);}); }
function fillSelectKeep(id,opts,keep){ const s=el(id); s.innerHTML=""; [""].concat(opts).forEach(o=>{const op=document.createElement("option");op.value=o;op.textContent=o||"- any -";s.appendChild(op);}); s.value=(keep&&opts.indexOf(keep)>=0)?keep:""; }
function fillSelectPH(id,opts,ph){ const s=el(id); s.innerHTML=""; const o0=document.createElement("option"); o0.value=""; o0.textContent=ph; s.appendChild(o0); opts.forEach(o=>{const op=document.createElement("option");op.value=o;op.textContent=o;s.appendChild(op);}); s.value=""; }
function localDate(d){ d=d||new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function uniqueSorted(a){ return Array.from(new Set(a.filter(x=>x!==undefined&&x!==""))).sort(); }
function setNet(){ const p=el("net"); if(!p) return; if(navigator.onLine){p.innerHTML=ic("wifi",13)+" online";p.classList.remove("off");} else {p.innerHTML=ic("wifi-off",13)+" offline";p.classList.add("off");} }
function showView(v){ ["new","rec","farmers","photos","dash"].forEach(k=>{ const s=el("view-"+k); if(s) s.classList.toggle("hidden",k!==v); const t=el("tab-"+k); if(t) t.classList.toggle("active",k===v); }); if(v==="rec") render(); if(v==="dash") dashboard(); if(v==="photos") loadGallery(); if(v==="farmers") renderFarmerDir(); }

/* ---------- SVG graphs ---------- */
function bars(id,counts,limit,ordered){
  const c=el(id); if(!c) return; c.innerHTML="";
  let keys=Object.keys(counts); if(!ordered) keys=keys.sort((a,b)=>counts[b]-counts[a]); if(limit) keys=keys.slice(0,limit);
  if(!keys.length){ c.innerHTML="<span class='muted'>No data yet</span>"; return; }
  const max=Math.max(...keys.map(k=>counts[k]))||1, rowH=24, W=340, labW=115, barMax=W-labW-42;
  const svg=['<svg viewBox="0 0 '+W+' '+(keys.length*rowH+6)+'" width="100%" style="max-width:'+W+'px;display:block">'];
  keys.forEach((k,i)=>{ const y=i*rowH+4, bw=Math.max(2,counts[k]/max*barMax);
    svg.push('<text x="0" y="'+(y+13)+'" font-size="11" fill="#5c6660">'+esc(String(k)).slice(0,17)+'</text>');
    svg.push('<rect x="'+labW+'" y="'+y+'" width="'+bw.toFixed(1)+'" height="15" rx="3" fill="#2e7d32"/>');
    svg.push('<text x="'+(labW+bw+4).toFixed(1)+'" y="'+(y+12)+'" font-size="11" fill="#1c211e">'+counts[k]+'</text>'); });
  svg.push('</svg>'); c.innerHTML=svg.join("");
}

/* ---------- farmers + cascading filters + merged search/select ---------- */
function parseCSV(t){ const rows=[]; let row=[],f="",q=false;
  for(let i=0;i<t.length;i++){ const c=t[i];
    if(q){ if(c==='"'){ if(t[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else { if(c==='"') q=true; else if(c===","){row.push(f);f="";} else if(c==="\n"){row.push(f);rows.push(row);row=[];f="";} else if(c==="\r"){} else f+=c; } }
  if(f.length||row.length){ row.push(f); rows.push(row); } return rows; }
async function loadFarmers(){
  try{ const res=await fetch("farmers.csv",{cache:"no-cache"}); if(!res.ok) throw 0;
    const rows=parseCSV(await res.text()).filter(r=>r.length>1); const head=rows.shift().map(h=>h.trim().toLowerCase());
    FARMERS=rows.map(r=>{const o={}; head.forEach((h,i)=>o[h]=(r[i]||"").trim()); return o;}); initFilters(); farmersDashboard();
  }catch(e){ toast("Could not load farmers.csv"); } }
function initFilters(){
  fillSelectKeep("f_state",uniqueSorted(FARMERS.map(f=>f.state)),""); ["f_agency","f_district","f_block","f_gp","f_village"].forEach(id=>fillSelect(id,[],true)); onFilter();
  if(el("fd_state")){ fillSelectKeep("fd_state",uniqueSorted(FARMERS.map(f=>f.state)),""); ["fd_agency","fd_district","fd_block","fd_gp","fd_village"].forEach(id=>fillSelect(id,[],true)); fdFilter(); }
}
function cascadeFill(p){
  const levels=["state","agency","district","block","gp","village"];
  const sel={}; levels.forEach(l=>sel[l]=el(p+l).value);
  levels.forEach(lvl=>{
    const others=FARMERS.filter(f=>levels.every(k=>k===lvl||!sel[k]||f[k]===sel[k]));
    const opts=uniqueSorted(others.map(f=>f[lvl]));
    let keep=sel[lvl]; if(!keep && opts.length===1) keep=opts[0]; // auto-fill when only one possibility (e.g. village -> its district)
    fillSelectKeep(p+lvl,opts,keep); sel[lvl]=el(p+lvl).value;
  });
}
function poolFor(p){ const st=el(p+"state").value,ag=el(p+"agency").value,d=el(p+"district").value,b=el(p+"block").value,g=el(p+"gp").value,v=el(p+"village").value;
  return FARMERS.filter(f=>(!st||f.state===st)&&(!ag||f.agency===ag)&&(!d||f.district===d)&&(!b||f.block===b)&&(!g||f.gp===g)&&(!v||f.village===v)); }
function currentPool(){ return poolFor("f_"); }
function fdFilter(){ cascadeFill("fd_"); el("fd_card").classList.add("hidden"); renderFarmerDir(); }
function onFilter(){ cascadeFill("f_"); selectedFarmer=null; el("farmercard").classList.add("hidden"); onFarmerSearch(); }
function onFarmerSearch(){
  const q=el("farmer_search").value.trim().toLowerCase(), pool=currentPool();
  const list=pool.filter(f=>!q||(f.farmer_name||"").toLowerCase().includes(q)||(f.farmer_id||"").toLowerCase().includes(q)).slice(0,40);
  const box=el("farmer_results");
  if(!list.length){ box.innerHTML="<div class='res muted'>No matching farmer</div>"; box.classList.remove("hidden"); return; }
  box.innerHTML=list.map(f=>"<div class='res' data-i='"+FARMERS.indexOf(f)+"'>"+esc(f.farmer_name||"?")+" - "+esc(f.village||"")+" - "+esc(f.farmer_id||"")+"</div>").join("");
  box.querySelectorAll(".res[data-i]").forEach(r=>r.addEventListener("click",()=>selectFarmer(Number(r.dataset.i))));
  box.classList.remove("hidden");
}
function selectFarmer(idx){ selectedFarmer=FARMERS[idx]; el("farmer_search").value=(selectedFarmer.farmer_name||selectedFarmer.farmer_id||""); el("farmer_results").classList.add("hidden"); showFarmerCard(); captureGPS(); }
function farmerCardHTML(f){
  const shown={farmer_name:1,farmer_id:1,father_name:1,village:1,gp:1,block:1,district:1,state:1,agency:1,crop:1,seed_variety:1,seed_class:1,date_sowing:1,area_ha:1,mobile:1};
  let extra=""; Object.keys(f).forEach(k=>{ if(!shown[k]&&f[k]) extra+="<br>"+esc(k.replace(/_/g," "))+": "+esc(f[k]); });
  return "<b>"+esc(f.farmer_name||"")+"</b> ("+esc(f.farmer_id||"")+")<br>"+(f.father_name?("F/H: "+esc(f.father_name)+"<br>"):"")+
    (f.mobile?("Mobile: "+esc(f.mobile)+"<br>"):"")+
    esc([f.village,f.gp,f.block,f.district,f.state].filter(Boolean).join(", "))+(f.agency?" - "+esc(f.agency):"")+
    "<br>Crop: "+esc(f.crop||"-")+" - Variety: "+esc(f.seed_variety||"-")+" - Class: "+esc(f.seed_class||"-")+
    "<br>Sown: "+esc(f.date_sowing||"-")+" - Area: "+esc(f.area_ha||"-")+" ha"+extra;
}
function showFarmerCard(){ const f=selectedFarmer; if(!f){ el("farmercard").classList.add("hidden"); return; }
  el("farmercard").classList.remove("hidden"); el("farmercard").innerHTML=farmerCardHTML(f); }

/* ---------- GPS (device sensor, works offline) + photos ---------- */
function captureGPS(){
  if(!navigator.geolocation){ toast("This device has no GPS"); return; }
  el("gps_display").value="locating..."; el("gps_display").classList.add("locating");
  navigator.geolocation.getCurrentPosition(
    p=>{ window._lat=p.coords.latitude.toFixed(6); window._lon=p.coords.longitude.toFixed(6); el("gps_display").value=window._lat+", "+window._lon; el("gps_display").classList.remove("locating"); },
    err=>{ el("gps_display").classList.remove("locating"); el("gps_display").value=""; if(err.code===1) toast("Allow location access for this site, then tap Capture GPS"); else toast("Turn ON your phone's location, then tap Capture GPS"); },
    {enableHighAccuracy:true,timeout:15000,maximumAge:0});
}
function onPhoto(input,slot){ const file=input.files[0]; if(!file) return; const reader=new FileReader();
  reader.onload=e=>{ const img=new Image(); img.onload=()=>{ const max=1000; let w=img.width,h=img.height;
    if(w>h&&w>max){h=Math.round(h*max/w);w=max;} else if(h>max){w=Math.round(w*max/h);h=max;}
    const cv=document.createElement("canvas"); cv.width=w; cv.height=h; cv.getContext("2d").drawImage(img,0,0,w,h);
    photos[slot]=cv.toDataURL("image/jpeg",0.6); el("slot"+slot).innerHTML="<img src='"+photos[slot]+"'><button class='x' onclick='removePhoto("+slot+")'>x</button>"; }; img.src=e.target.result; };
  reader.readAsDataURL(file); }
function removePhoto(slot){ photos[slot]=null; el("slot"+slot).innerHTML="<label for='cam"+slot+"'>"+ic("camera",22)+"</label><input id='cam"+slot+"' type='file' accept='image/*' capture='environment' class='hidden' onchange='onPhoto(this,"+slot+")'>"; }

/* ---------- visits ---------- */
function resetVisit(){ el("farmer_search").value=""; el("farmer_results").classList.add("hidden"); el("farmercard").classList.add("hidden"); selectedFarmer=null;
  el("crop_stage").selectedIndex=0; el("condition").selectedIndex=0; el("purpose").selectedIndex=0; el("immediate_actions").value=""; el("notes").value=""; el("gps_display").value=""; window._lat=""; window._lon=""; [0,1,2].forEach(removePhoto); }
async function saveVisit(){
  if(!selectedFarmer){ toast("Select a farmer first"); return; }
  if(!window._lat||!window._lon){ toast("Getting GPS - allow location..."); const g=await getGPS(); if(g){ window._lat=g.lat; window._lon=g.lon; el("gps_display").value=g.lat+", "+g.lon; } }
  if(!window._lat||!window._lon){ toast("GPS is required. Turn ON location & allow access, then Save again."); return; }
  const stage=el("crop_stage").value, cond=el("condition").value, pur=el("purpose").value, ia=el("immediate_actions").value.trim(), nt=el("notes").value.trim();
  if(!stage){ toast("Select crop stage"); return; }
  if(!cond){ toast("Select condition"); return; }
  if(!pur){ toast("Select purpose of visit"); return; }
  if(!ia){ toast("Enter immediate actions"); return; }
  if(!nt){ toast("Enter notes"); return; }
  const now=new Date(), f=selectedFarmer, today=localDate(now);
  if((await idbAll()).some(x=>x.farmer_id===f.farmer_id && x.visit_date===today)){ toast("This farmer is already recorded today."); return; }
  const v={ synced:false, device_id:deviceId(), visit_id:"V-"+now.getTime().toString(36)+"-"+Math.random().toString(36).slice(2,5),
    staff_id:SESSION.staff_id, staff_name:SESSION.name||SESSION.staff_id,
    state:f.state||"", agency:f.agency||"", farmer_id:f.farmer_id||"", farmer_name:f.farmer_name||"", district:f.district||"", block:f.block||"", gp:f.gp||"", village:f.village||"",
    crop:f.crop||"", seed_variety:f.seed_variety||"", seed_class:f.seed_class||"",
    visit_date:today, visit_time:now.toTimeString().slice(0,8), lat:window._lat||"", lon:window._lon||"",
    crop_stage:stage, condition:cond, purpose:pur, immediate_actions:ia, notes:nt, logged_at:now.toISOString(), photos:photos.filter(Boolean) };
  await idbPut(v); flashCheck(); toast("Visit saved on this device"); resetVisit(); updateCounts(); syncNow(false);
}
async function render(){ const all=(await idbAll()).sort((a,b)=>(b.logged_at||"").localeCompare(a.logged_at||"")); const tb=el("rows"); tb.innerHTML="";
  all.forEach(v=>{ const tr=document.createElement("tr");
    tr.innerHTML="<td>"+v.visit_date+"</td><td>"+esc(v.farmer_name||"")+"</td><td>"+esc(v.village||"")+"</td><td>"+esc(v.crop_stage||"")+"</td><td>"+esc(v.condition||"")+"</td><td>"+(v.synced?ic("check",16,"okic"):"<span class='badge'>"+ic("cloud-off",12)+" pending</span>")+"</td><td><button class='btn danger small' data-id='"+v.id+"'>"+ic("trash-2",14)+"</button></td>";
    tb.appendChild(tr); });
  tb.querySelectorAll("button[data-id]").forEach(b=>b.addEventListener("click",async()=>{await idbDel(Number(b.dataset.id));render();updateCounts();toast("Deleted");})); const ev=el("empty_visits"); if(ev) ev.classList.toggle("hidden",all.length>0); updateCounts(); }
async function updateCounts(){ const all=await idbAll(),pend=all.filter(v=>!v.synced).length; el("count").textContent=all.length+" visits"; const u=el("unsynced"); if(u){ u.textContent=pend+" not uploaded"; u.style.display=pend?"":"none"; } }
async function exportCSV(){ const all=await idbAll(); if(!all.length){ toast("No visits"); return; }
  const cols=["visit_id","visit_date","visit_time","staff_id","staff_name","state","agency","farmer_id","farmer_name","district","block","gp","village","crop","seed_variety","seed_class","crop_stage","condition","purpose","immediate_actions","lat","lon","notes","logged_at","device_id","synced"];
  const q=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"'; const csv=[cols.join(",")].concat(all.map(r=>cols.map(c=>q(r[c])).join(","))).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download="field-visits-"+new Date().toISOString().slice(0,10)+".csv"; a.click(); URL.revokeObjectURL(a.href); }

/* ---------- sync ---------- */
let TEAM_VISITED=new Set(), syncing=false;
async function syncNow(manual){
  if(syncing) return;
  if(!navigator.onLine){ if(manual) toast("Offline - will upload later"); return; }
  if(ENDPOINT.indexOf("PASTE_YOUR")===0){ if(manual) toast("Set ENDPOINT in app.js"); return; }
  const pending=(await idbAll()).filter(v=>!v.synced); if(!pending.length){ if(manual) toast("All uploaded"); return; }
  syncing=true; if(manual) toast("Uploading "+pending.length+"..."); let ok=0;
  try{ for(const v of pending){ try{ const out=await api({action:"visit",visit:v}); if(out&&(out.status==="ok"||out.status==="duplicate")){ v.synced=true; await idbPut(v); ok++; } }catch(e){ break; } }
    if(manual) toast("Uploaded "+ok+" of "+pending.length); }
  finally{ syncing=false; render(); updateCounts(); } }

/* ---------- dashboards ---------- */
function mondayLocal(ds){ if(!ds) return ""; const dt=new Date(ds); if(isNaN(dt)) return ""; const day=(dt.getDay()+6)%7; dt.setDate(dt.getDate()-day); return dt.toISOString().slice(0,10); }
function orderWeekday(o){ const r={}; ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach(d=>{ if(o[d]!=null) r[d]=o[d]; }); return r; }
function sumBy(rows,keyField,valField){ const o={}; rows.forEach(r=>{ const k=(r[keyField]||"-"); const n=parseFloat(r[valField]); if(!isNaN(n)) o[k]=Math.round(((o[k]||0)+n)*10)/10; }); return o; }
function countBy(rows,key){ const o={}; rows.forEach(r=>{ const k=r[key]||"-"; o[k]=(o[k]||0)+1; }); return o; }
function farmersDashboard(){
  if(!FARMERS.length){ el("fm_stats").innerHTML="<span class='muted'>Load farmers.csv to see coverage.</span>"; return; }
  const totalArea=Math.round(FARMERS.reduce((s,f)=>s+(parseFloat(f.area_ha)||0),0)*10)/10;
  const crops=new Set(FARMERS.map(f=>f.crop).filter(Boolean)).size, villages=new Set(FARMERS.map(f=>f.village).filter(Boolean)).size;
  el("fm_stats").innerHTML=
    "<div class='kpi' style='border-left:4px solid #2e7d32'><div class='kpi-v'>"+FARMERS.length+"</div><div class='kpi-l'>registered farmers</div></div>"+
    "<div class='kpi' style='border-left:4px solid #00897b'><div class='kpi-v'>"+totalArea+"</div><div class='kpi-l'>total area (ha)</div></div>"+
    "<div class='kpi' style='border-left:4px solid #1565c0'><div class='kpi-v'>"+crops+"</div><div class='kpi-l'>crops</div></div>"+
    "<div class='kpi' style='border-left:4px solid #8e24aa'><div class='kpi-v'>"+villages+"</div><div class='kpi-l'>villages</div></div>";
  chartDoughnut("fm_state_area", sumBy(FARMERS,"state","area_ha"));
  chartDoughnut("fm_agency_area", sumBy(FARMERS,"agency","area_ha"));
  chartBar("fm_crop_area", sumBy(FARMERS,"crop","area_ha"), 0, true);
  chartBar("fm_block_area", sumBy(FARMERS,"block","area_ha"), 0, true);
  chartBar("fm_variety_area", sumBy(FARMERS,"seed_variety","area_ha"), 10, true);
}
async function dashboard(){ farmersDashboard(); renderMap(LAST_TEAM_POINTS); if(navigator.onLine) loadTeam(false); const all=await idbAll();
  const uf=new Set(all.map(v=>v.farmer_id).filter(Boolean)).size, days=new Set(all.map(v=>v.visit_date)).size, pd=days?(all.length/days).toFixed(1):"0";
  el("stats").innerHTML="<span class='stat'><b>"+all.length+"</b>visits (device)</span><span class='stat'><b>"+uf+"</b>farmers</span><span class='stat'><b>"+pd+"</b>per active day</span>";
  bars("by_stage",countBy(all,"crop_stage")); bars("by_cond",countBy(all,"condition"));
  const wk={}; all.forEach(v=>{ const m=mondayLocal(v.visit_date); if(m){ const k=m.slice(5); wk[k]=(wk[k]||0)+1; } }); bars("dev_perweek",wk,0,true); renderNotVisited(); }
function condColor(c){ c=String(c||"").toLowerCase(); return c==="good"?"#2e7d32":c==="average"?"#f9a825":c==="poor"?"#c62828":"#607d8b"; }
function trendArrow(cur,prev){ if(prev==null||cur===prev) return ""; const up=cur>prev; return " <span style='font-size:14px;color:"+(up?"#2e7d32":"#c62828")+"'>"+(up?"\u25B2":"\u25BC")+"</span>"; }
function kpiCard(v,l,extra,color){ return "<div class='kpi' style='border-left:4px solid "+(color||"#2e7d32")+"'><div class='kpi-v'>"+v+(extra||"")+"</div><div class='kpi-l'>"+l+"</div></div>"; }
function renderKPI(s){
  const reg=FARMERS.length, vis=s.farmers||0, pct=reg?Math.round(vis/reg*100):0, pending=Math.max(0,reg-vis);
  const pw=s.perWeek||[]; const thisW=pw.length?pw[pw.length-1].count:0, lastW=pw.length>1?pw[pw.length-2].count:null;
  el("kpi").innerHTML=kpiCard(s.total||0,"total visits","","#2e7d32")+kpiCard(thisW,"visits this week",trendArrow(thisW,lastW),"#00897b")+kpiCard(pct+"%","farmers covered","","#1565c0")+kpiCard(pending,"not yet visited","","#ef6c00")+kpiCard(s.avgRevisitDays||0,"avg days / revisit","","#8e24aa");
}
let MAP=null, MAP_LAYER=null;
async function renderMap(teamPoints){
  const div=el("map"); if(!div||typeof L==="undefined") return;
  if(!MAP){ MAP=L.map("map",{scrollWheelZoom:false}); L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"&copy; OpenStreetMap"}).addTo(MAP); MAP.setView([21,83],6); }
  if(MAP_LAYER) MAP.removeLayer(MAP_LAYER);
  MAP_LAYER=L.layerGroup(); const bounds=[];
  // villages from the farmer master list (needs village_lat / village_lon columns)
  const seen={};
  FARMERS.forEach(f=>{ const la=parseFloat(f.village_lat), lo=parseFloat(f.village_lon); if(isNaN(la)||isNaN(lo)) return;
    const key=(f.village||"")+"|"+la.toFixed(4)+"|"+lo.toFixed(4); if(seen[key]) return; seen[key]=1; bounds.push([la,lo]);
    L.circleMarker([la,lo],{radius:8,color:"#1565c0",weight:2,fillColor:"#1565c0",fillOpacity:.15})
     .bindPopup("<b>"+esc(f.village||"")+"</b><br>"+esc([f.gp,f.block,f.district,f.state].filter(Boolean).join(", "))).addTo(MAP_LAYER); });
  // visits = this device (local) + team (server)
  const local=(await idbAll()).map(v=>({lat:v.lat,lon:v.lon,condition:v.condition,farmer_name:v.farmer_name,village:v.village,crop:v.crop,visit_date:v.visit_date}));
  local.concat(teamPoints||[]).forEach(p=>{ const la=parseFloat(p.lat),lo=parseFloat(p.lon); if(isNaN(la)||isNaN(lo)) return; bounds.push([la,lo]);
    L.circleMarker([la,lo],{radius:6,color:"#fff",weight:1,fillColor:condColor(p.condition),fillOpacity:.95})
     .bindPopup("<b>"+esc(p.farmer_name||"")+"</b><br>"+esc(p.village||"")+"<br>"+esc(p.crop||"")+" - "+esc(p.condition||"")+"<br>"+esc(p.visit_date||"")).addTo(MAP_LAYER); });
  MAP_LAYER.addTo(MAP);
  if(bounds.length){ try{ MAP.fitBounds(bounds,{padding:[24,24],maxZoom:13}); }catch(e){} }
  setTimeout(()=>{ try{ MAP.invalidateSize(); }catch(e){} },150);
}
let CHARTS={};
function chartOpts(h){ return {responsive:true,maintainAspectRatio:false,indexAxis:h?"y":"x",plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{precision:0}},y:{grid:{color:"#eee"},beginAtZero:true,ticks:{precision:0}}}}; }
function mkChart(id,cfg){ if(typeof Chart==="undefined") return; if(CHARTS[id]) CHARTS[id].destroy(); const c=el(id); if(!c) return; CHARTS[id]=new Chart(c,cfg); }
const PALETTE=["#2e7d32","#43a047","#7cb342","#c0ca33","#fdd835","#fb8c00","#f4511e","#8e24aa","#3949ab","#00897b"];
function chartFallback(id,obj,limit){ const c=el(id); if(!c) return; const host=c.parentElement||c; host.style.height="auto"; const d=document.createElement("div"); d.id="fb_"+id; host.replaceChildren(d); bars("fb_"+id,obj,limit); }
function chartBar(id,obj,limit,horizontal){ if(typeof Chart==="undefined"){ chartFallback(id,obj,limit); return; }
  let keys=Object.keys(obj).sort((a,b)=>obj[b]-obj[a]); if(limit) keys=keys.slice(0,limit);
  mkChart(id,{type:"bar",data:{labels:keys,datasets:[{data:keys.map(k=>obj[k]),backgroundColor:keys.map((k,i)=>PALETTE[i%PALETTE.length]),borderRadius:5,maxBarThickness:26}]},options:Object.assign(chartOpts(horizontal),{animation:{duration:800}})}); }
function chartDoughnut(id,obj){ if(typeof Chart==="undefined"){ chartFallback(id,obj); return; }
  const keys=Object.keys(obj);
  mkChart(id,{type:"doughnut",data:{labels:keys,datasets:[{data:keys.map(k=>obj[k]),backgroundColor:keys.map((k,i)=>PALETTE[i%PALETTE.length]),borderWidth:2,borderColor:"#fff"}]},options:{responsive:true,maintainAspectRatio:false,cutout:"55%",plugins:{legend:{position:"bottom",labels:{boxWidth:12,font:{size:11}}}},animation:{animateScale:true,duration:800}}}); }
function renderCharts(s){
  if(typeof Chart==="undefined") return;
  const pw=s.perWeek||[]; mkChart("ch_week",{type:"line",data:{labels:pw.map(x=>(x.week||"").slice(5)),datasets:[{data:pw.map(x=>x.count),borderColor:"#2e7d32",backgroundColor:"rgba(46,125,50,.12)",fill:true,tension:.3,pointRadius:3,borderWidth:2}]},options:chartOpts(false)});
  const cond=s.byCondition||{}, ck=Object.keys(cond);
  mkChart("ch_cond",{type:"doughnut",data:{labels:ck,datasets:[{data:ck.map(k=>cond[k]),backgroundColor:ck.map(condColor),borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"right"}}}});
  const st=s.byStaff||{}, sk=Object.keys(st).sort((a,b)=>st[b]-st[a]).slice(0,10);
  mkChart("ch_staff",{type:"bar",data:{labels:sk,datasets:[{data:sk.map(k=>st[k]),backgroundColor:"#2e7d32",borderRadius:4}]},options:chartOpts(true)});
}
function renderTraffic(s){
  const div=el("traffic"); if(!div) return; const visited=new Set(s.visitedIds||[]); const blocks={};
  FARMERS.forEach(f=>{ const b=f.block||"-"; (blocks[b]=blocks[b]||{reg:0,vis:0}); blocks[b].reg++; if(visited.has(f.farmer_id)) blocks[b].vis++; });
  const keys=Object.keys(blocks).sort(); if(!keys.length){ div.innerHTML="<span class='muted'>No block data in farmers.csv.</span>"; return; }
  div.innerHTML=keys.map(b=>{ const o=blocks[b], pct=o.reg?Math.round(o.vis/o.reg*100):0; const col=pct>=67?"#2e7d32":pct>=34?"#f9a825":pct>0?"#ef6c00":"#c62828";
    return "<div class='tl'><span class='dot' style='background:"+col+"'></span><span class='tl-b'>"+esc(b)+"</span><span class='tl-p'>"+pct+"%</span><span class='muted'>"+o.vis+"/"+o.reg+"</span></div>"; }).join("");
}
let TEAM_LOADED=false, LAST_TEAM_POINTS=[];
function renderTeam(s){
  TEAM_VISITED=new Set(s.visitedIds||[]); LAST_TEAM_POINTS=s.points||[];
  renderKPI(s); renderMap(LAST_TEAM_POINTS); renderCharts(s); renderTraffic(s);
  el("rc_stats").innerHTML="<span class='stat'><b>"+(FARMERS.length?Math.round((s.farmers||0)/FARMERS.length*100):0)+"%</b>farmers covered</span><span class='stat'><b>"+(s.farmers||0)+"</b>of "+(FARMERS.length||"?")+" visited</span><span class='stat'><b>"+(s.avgRevisitDays||0)+"</b>avg days between revisits</span>";
  bars("rc_visitcounts", s.visitCounts||{}, 0, true);
  const wk={}; (s.perWeek||[]).forEach(x=>wk[(x.week||"").slice(5)]=x.count); bars("rc_perweek", wk, 0, true);
  bars("rc_weekday", orderWeekday(s.byWeekday||{}), 0, true);
  renderNotVisited();
}
async function loadTeam(force){
  if(ENDPOINT.indexOf("PASTE_YOUR")===0){ el("kpi").innerHTML="<span class='muted'>Set ENDPOINT first.</span>"; return; }
  if(!force && TEAM_LOADED) return;
  if(!navigator.onLine){ const c=cacheGet("stats"); if(c){ renderTeam(c); TEAM_LOADED=true; } else if(!TEAM_LOADED) el("kpi").innerHTML="<span class='muted'>Offline - connect to load the team dashboard.</span>"; return; }
  if(!TEAM_LOADED||force) el("kpi").innerHTML="<span class='muted'>Loading...</span>";
  let s;
  try{ s=await apiRead({action:"stats"},3); cacheSet("stats",s); }
  catch(e){ s=cacheGet("stats"); if(!s){ if(!TEAM_LOADED) el("kpi").innerHTML="<span class='muted'>Couldn't load - tap Refresh to retry.</span>"; return; } toast("Network slow - showing last loaded"); }
  renderTeam(s); TEAM_LOADED=true;
}

function flashCheck(){ const f=el("flash"); if(!f) return; f.querySelector(".fc").innerHTML=ic("check",50); f.classList.remove("show"); void f.offsetWidth; f.classList.add("show"); setTimeout(()=>f.classList.remove("show"),950); }
async function notVisitedList(){ const local=new Set((await idbAll()).map(v=>v.farmer_id).filter(Boolean)); const seen=new Set([...TEAM_VISITED,...local]); return FARMERS.filter(f=>f.farmer_id&&!seen.has(f.farmer_id)); }
async function renderNotVisited(){
  if(!el("nv_list")) return;
  const all=await notVisitedList(); const total=all.length;
  const q=(el("nv_search").value||"").trim().toLowerCase();
  let list=q? all.filter(f=>(f.farmer_name||"").toLowerCase().includes(q)||(f.village||"").toLowerCase().includes(q)||(f.farmer_id||"").toLowerCase().includes(q)) : all;
  el("nv_count").textContent=total+" farmers not yet visited"+(TEAM_VISITED.size?"":" (this device only - tap Refresh for program-wide)");
  const shown=list.slice(0,200);
  el("nv_list").innerHTML = shown.length ? (shown.map(f=>"<div class='res'>"+esc(f.farmer_name||"?")+" - "+esc(f.village||"")+" - "+esc(f.farmer_id||"")+" <span class='muted'>("+esc(f.agency||"")+", "+esc(f.district||"")+")</span></div>").join("")+(list.length>200?"<div class='muted' style='padding:8px'>+"+(list.length-200)+" more...</div>":"")) : "<div class='muted' style='padding:8px'>None - all matching farmers visited.</div>";
}
async function exportNotVisited(){ const list=await notVisitedList(); if(!list.length){ toast("No farmers pending"); return; }
  const cols=["state","agency","district","block","gp","village","farmer_name","father_name","mobile","farmer_id","crop","seed_variety","seed_class","area_ha","date_sowing"];
  const q=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"'; const csv=[cols.join(",")].concat(list.map(f=>cols.map(c=>q(f[c])).join(","))).join("\n");
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download="farmers-not-visited-"+new Date().toISOString().slice(0,10)+".csv"; a.click(); URL.revokeObjectURL(a.href); }
let GALLERY_SOURCE="device", GALLERY_ITEMS=[], GALLERY_SORTED=[], GALLERY_SORT="new", GALLERY_TIME="all", GALLERY_CROP="all", LB_I=0;
let GALLERY_TEAM_CACHE=null;
async function loadGallery(force){
  const sel=el("gal_source"); GALLERY_SOURCE=sel?sel.value:GALLERY_SOURCE;
  const g=el("gallery"); if(!g) return;
  if(GALLERY_SOURCE==="device"){
    const all=await idbAll(); const items=[];
    all.forEach(v=>{ (v.photos||[]).forEach(p=>items.push({url:p,full:p,farmer_name:v.farmer_name,village:v.village,crop:v.crop,seed_variety:v.seed_variety,area_ha:v.area_ha,lat:v.lat,lon:v.lon,visit_date:v.visit_date,crop_stage:v.crop_stage,condition:v.condition})); });
    GALLERY_ITEMS=items; renderBands(); renderGallery(); return;
  }
  if(ENDPOINT.indexOf("PASTE_YOUR")===0){ g.innerHTML="<span class='muted'>Set ENDPOINT first.</span>"; return; }
  if(!force && GALLERY_TEAM_CACHE){ GALLERY_ITEMS=GALLERY_TEAM_CACHE; renderBands(); renderGallery(); return; }
  if(!navigator.onLine){ const c=cacheGet("photos"); if(c&&c.length){ GALLERY_ITEMS=c; GALLERY_TEAM_CACHE=c; renderBands(); renderGallery(); } else g.innerHTML="<span class='muted'>Offline - connect to load team photos.</span>"; return; }
  if(!GALLERY_TEAM_CACHE||force) g.innerHTML="<span class='muted'>Loading photos...</span>";
  try{ const out=await apiRead({action:"photos"},3); GALLERY_ITEMS=out.items||[]; GALLERY_TEAM_CACHE=GALLERY_ITEMS; cacheSet("photos",GALLERY_ITEMS); renderBands(); renderGallery(); }
  catch(e){ const c=GALLERY_TEAM_CACHE||cacheGet("photos"); if(c&&c.length){ GALLERY_ITEMS=c; GALLERY_TEAM_CACHE=c; renderBands(); renderGallery(); toast("Network slow - showing last loaded photos"); } else g.innerHTML="<span class='muted'>Couldn't load photos - tap Reload to retry.</span>"; }
}
function sortGallery(){ const s=el("gal_sort"); GALLERY_SORT=s?s.value:"new"; renderGallery(); }
function inTime(it){ if(GALLERY_TIME==="all") return true; const d=String(it.visit_date||"").slice(0,10); if(!d) return false; const today=localDate();
  if(GALLERY_TIME==="today") return d===today; const dt=new Date(d); if(isNaN(dt)) return false;
  if(GALLERY_TIME==="week"){ const diff=(Date.now()-dt.getTime())/86400000; return diff>=0&&diff<7; } if(GALLERY_TIME==="month") return d.slice(0,7)===today.slice(0,7); return true; }
function renderBands(){
  const t=el("gal_time"); if(t){ const opts=[["all","All"],["today","Today"],["week","This week"],["month","This month"]];
    t.innerHTML=opts.map(o=>"<button class='chip"+(GALLERY_TIME===o[0]?" active":"")+"' data-t='"+o[0]+"'>"+o[1]+"</button>").join("");
    t.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ GALLERY_TIME=b.dataset.t; renderBands(); renderGallery(); })); }
  const c=el("gal_crops"); if(c){ const crops=Array.from(new Set(GALLERY_ITEMS.map(it=>it.crop).filter(Boolean))).sort();
    c.innerHTML="<button class='chip"+(GALLERY_CROP==="all"?" active":"")+"' data-c='all'>"+ic("leaf",13)+" All crops</button>"+crops.map(cr=>"<button class='chip"+(GALLERY_CROP===cr?" active":"")+"' data-c=\""+esc(cr)+"\">"+ic("leaf",13)+" "+esc(cr)+"</button>").join("");
    c.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ GALLERY_CROP=b.dataset.c; renderBands(); renderGallery(); })); }
}
function renderGallery(){
  let items=GALLERY_ITEMS.filter(it=>(GALLERY_CROP==="all"||it.crop===GALLERY_CROP)&&inTime(it)); const s=GALLERY_SORT;
  if(s==="new") items.sort((a,b)=>String(b.visit_date).localeCompare(String(a.visit_date)));
  else if(s==="old") items.sort((a,b)=>String(a.visit_date).localeCompare(String(b.visit_date)));
  else if(s==="farmer") items.sort((a,b)=>String(a.farmer_name||"").localeCompare(String(b.farmer_name||"")));
  else if(s==="crop") items.sort((a,b)=>String(a.crop||"").localeCompare(String(b.crop||"")));
  else if(s==="village") items.sort((a,b)=>String(a.village||"").localeCompare(String(b.village||"")));
  GALLERY_SORTED=items; const g=el("gallery");
  if(!items.length){ g.innerHTML="<span class='muted'>No photos"+(GALLERY_SOURCE==="device"?" on this device yet.":" found.")+"</span>"; return; }
  g.innerHTML=items.map((it,i)=>"<div class='thumb' data-i='"+i+"'><img loading='lazy' src='"+it.url+"'></div>").join("");
  g.querySelectorAll(".thumb").forEach(t=>t.addEventListener("click",()=>openLightbox(Number(t.dataset.i))));
}
function openLightbox(i){ const it=GALLERY_SORTED[i]; if(!it) return; LB_I=i;
  el("lb_img").src=it.full||it.url;
  el("lb_foot").innerHTML="<b>"+esc(it.farmer_name||"")+"</b> - "+esc(it.village||"")+"<br>"+esc(it.crop||"")+" / "+esc(it.seed_variety||"")+" - "+esc(String(it.area_ha||"-"))+" ha - "+esc(String(it.visit_date||""))+"<br>Stage: "+esc(it.crop_stage||"-")+" - Condition: "+esc(it.condition||"-")+" - GPS: "+esc(String(it.lat||"-"))+", "+esc(String(it.lon||"-"));
  el("lightbox").classList.remove("hidden");
}
function lbClose(){ el("lightbox").classList.add("hidden"); el("lb_img").src=""; }
function lbNav(d){ if(!GALLERY_SORTED.length) return; LB_I=(LB_I+d+GALLERY_SORTED.length)%GALLERY_SORTED.length; openLightbox(LB_I); }
function renderFarmerDir(){
  if(!el("fd_results")) return;
  const q=(el("fd_search").value||"").trim().toLowerCase();
  let list=poolFor("fd_").filter(f=>!q||(f.farmer_name||"").toLowerCase().includes(q)||(f.farmer_id||"").toLowerCase().includes(q)||(f.village||"").toLowerCase().includes(q));
  const total=list.length, shown=list.slice(0,100);
  el("fd_results").innerHTML = shown.length ? (shown.map(f=>"<div class='res' data-i='"+FARMERS.indexOf(f)+"'>"+esc(f.farmer_name||"?")+" - "+esc(f.village||"")+" - "+esc(f.farmer_id||"")+"</div>").join("")+(total>100?"<div class='muted' style='padding:8px'>+"+(total-100)+" more - refine search</div>":"")) : "<div class='muted' style='padding:8px'>"+(FARMERS.length?"No matching farmer":"Farmer list not loaded")+"</div>";
  el("fd_results").querySelectorAll(".res[data-i]").forEach(r=>r.addEventListener("click",()=>pickFarmerDir(Number(r.dataset.i))));
}
function pickFarmerDir(idx){ const f=FARMERS[idx]; if(!f) return; el("fd_card").classList.remove("hidden"); el("fd_card").innerHTML=farmerCardHTML(f); }
/* ---------- boot ---------- */
window.addEventListener("online",()=>{setNet();syncNow(false);});
window.addEventListener("offline",setNet);
document.addEventListener("click",e=>{ const box=el("farmer_results"); if(box&&!box.classList.contains("hidden")&&!e.target.closest("#farmer_search")&&!e.target.closest("#farmer_results")) box.classList.add("hidden"); });
function initApp(){ fillSelectPH("crop_stage",STAGES,"- select stage -"); fillSelectPH("condition",CONDITION,"- select condition -"); fillSelectPH("purpose",PURPOSES,"- select purpose -"); setNet(); updateCounts(); loadFarmers(); setTimeout(()=>syncNow(false),1500); }
(function boot(){
  if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
  let s=null; try{ s=JSON.parse(localStorage.getItem("session")); }catch(e){}
  if(s&&s.staff_id){ const prof=getProfile(s.staff_id); if(prof){ enterApp(prof); return; } }
  authTab("signin");
})();
