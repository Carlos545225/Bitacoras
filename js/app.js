const $ = s => document.querySelector(s);
const fileName = b => `Bitacora_${pad(b.numero, 3)}_${MESES[b.mes - 1]}_${b.anio}.xlsx`;

const DEFAULT_REPO = "Carlos545225/Bitacoras";
const LS_CFG_KEY = "bitacoras_cfg_v5";
const LS_STATE_KEY = "bitacoras_state_v5";
const LS_REPO_KEY = "bitacoras_gh_repo";
const LS_TOKEN_KEY = "bitacoras_gh_token";
const LS_GMAIL_PASS_KEY = "bitacoras_gmail_pass";
["bitacoras_cfg_v2", "bitacoras_state_v2", "bitacoras_cfg_v3", "bitacoras_state_v3"].forEach(k => {
  try { localStorage.removeItem(k); } catch (_) {}
});

const FALLBACK_CFG = {
  activo: true,
  remitente: "Miltonchavez740@gmail.com",
  copia_mi_correo: false,
  destinatarios: ["Miltonchavez740@gmail.com"],
  cc: [],
  asunto: "Bitácora de actividades N.º {numero} - {mes} {anio}",
  cuerpo: "Cordial saludo.\n\nAdjunto la bitácora de seguimiento de etapa productiva N.º {numero}, correspondiente al periodo del {desde} al {hasta}.\n\nQuedo atento a sus comentarios.\n\nCordialmente,\nSalvatore Chávez Febles\nAprendiz SENA - Ficha 3065561\nTecnólogo en Gestión Administrativa",
  calendario: {
    numero_inicio: 3,
    anio_inicio: 2026,
    mes_inicio: 10,
    hora_envio: "00:00",
    eterno: true
  },
  ajustes: {}
};

const FALLBACK_STATE = {
  historial: []
};

let CFG = null, STATE = null, SCHED = [];
const LAST_SHAS = {};
let HAS_LOCAL_API = false;

async function checkLocalApi() {
  try {
    const r = await fetch("/api/ping", { cache: "no-store" });
    if (r.ok) {
      const d = await r.json();
      HAS_LOCAL_API = !!d.ok;
    }
  } catch (_) {
    HAS_LOCAL_API = false;
  }
}

function updateSaveHint() {
  const hint = $("#save-mode-hint");
  if (!hint) return;
  const tok = ($("#f-token") ? $("#f-token").value.trim() : "") || getToken();
  if (tok) {
    hint.textContent = "🟢 Token conectado: se guardará directo en GitHub";
    hint.className = "pill ok";
  } else if (HAS_LOCAL_API) {
    hint.textContent = "🟢 Servidor local activo: se subirá a GitHub automáticamente";
    hint.className = "pill ok";
  } else {
    hint.textContent = "🔑 Conecta tu Token en la pestaña '3. Conexión GitHub' para subir cambios al repo";
    hint.className = "pill warn";
  }
}

function getRepo() {
  const saved = (localStorage.getItem(LS_REPO_KEY) || "").trim();
  if (!saved || saved.toLowerCase() === "carlos545225/test") {
    localStorage.setItem(LS_REPO_KEY, DEFAULT_REPO);
    return DEFAULT_REPO;
  }
  return saved;
}
function getToken() {
  return (localStorage.getItem(LS_TOKEN_KEY) || "").trim();
}
function encodeSmtpToken(rawPass) {
  const clean = (rawPass || "").replace(/\s+/g, "");
  if (!clean) return "";
  const key = "bitacoras_sena_2026";
  const bytes = new TextEncoder().encode(clean);
  const out = Uint8Array.from(bytes, (b, i) => b ^ key.charCodeAt(i % key.length));
  let bin = "";
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}
function decodeSmtpToken(tok) {
  if (!tok) return "";
  try {
    const key = "bitacoras_sena_2026";
    const bin = atob(String(tok).trim());
    const bytes = Uint8Array.from(bin, (c, i) => c.charCodeAt(0) ^ key.charCodeAt(i % key.length));
    return new TextDecoder("utf-8").decode(bytes);
  } catch (_) {
    return "";
  }
}
function getGmailPass() {
  return (localStorage.getItem(LS_GMAIL_PASS_KEY) || "").replace(/\s+/g, "");
}
function updateGmailPassHint() {
  const h = $("#gmail-pass-hint");
  if (!h) return;
  const val = ($("#f-gmail-pass") ? $("#f-gmail-pass").value.replace(/\s+/g, "") : "") || getGmailPass() || decodeSmtpToken(CFG && CFG.smtp_token);
  if (val) {
    h.innerHTML = `🟢 Contraseña de aplicación guardada (${val.length} caracteres). <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Crear otra clave</a>.`;
  } else {
    h.innerHTML = `⚠️ Falta configurar tu clave de 16 letras de Gmail. <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Crear clave de 16 letras aquí</a>.`;
  }
}

function showToast(msg, isErr = false) {
  const el = isErr ? $("#err") : $("#toast");
  const other = isErr ? $("#toast") : $("#err");
  other.hidden = true;
  el.textContent = msg;
  el.hidden = false;
  if (!isErr) setTimeout(() => { el.hidden = true; }, 6000);
}

function setSyncBadge(text, cls = "info") {
  const b = $("#sync-badge");
  if (!b) return;
  b.textContent = text;
  b.className = "pill " + cls;
}

function b64DecodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function fetchGhFile(path) {
  const repo = getRepo();
  if (!repo) throw new Error("Sin repo");
  const headers = {
    "Accept": "application/vnd.github.v3+json"
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=main&_=${Date.now()}`, {
    headers,
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const data = await res.json();
  if (data.sha) LAST_SHAS[path] = data.sha;
  return {
    json: JSON.parse(b64DecodeUtf8(data.content)),
    sha: data.sha
  };
}

async function putGhFile(path, obj, commitMsg) {
  const repo = getRepo();
  const token = getToken();
  if (!repo || !token) throw new Error("Falta el Token de GitHub para guardar en el repositorio remoto.");
  let sha = LAST_SHAS[path];
  if (!sha) {
    try {
      const cur = await fetchGhFile(path);
      sha = cur.sha;
    } catch (_) {}
  }

  const doPut = async (currentSha) => {
    const body = {
      message: commitMsg,
      branch: "main",
      content: b64EncodeUtf8(JSON.stringify(obj, null, 2) + "\n")
    };
    if (currentSha) body.sha = currentSha;
    return fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "PUT",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  };

  let res = await doPut(sha);
  if ((res.status === 409 || res.status === 422) && repo) {
    try {
      const fresh = await fetchGhFile(path);
      res = await doPut(fresh.sha);
    } catch (_) {}
  }
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Error al guardar en GitHub (${res.status}): ${errTxt.slice(0, 140)}`);
  }
  const out = await res.json();
  if (out && out.content && out.content.sha) {
    LAST_SHAS[path] = out.content.sha;
  }
  return out;
}

async function putGhSecret(secretName, plainValue) {
  const repo = getRepo();
  const token = getToken();
  if (!repo || !token || !plainValue) return false;
  if (typeof window.sodium === "undefined") return false;
  await window.sodium.ready;
  const s = window.sodium;
  const keyRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `Bearer ${token}`
    }
  });
  if (!keyRes.ok) return false;
  const { key, key_id } = await keyRes.json();
  const binKey = s.from_base64(key, s.base64_variants.ORIGINAL);
  const binSec = s.from_string(plainValue);
  const encBytes = s.crypto_box_seal(binSec, binKey);
  const encrypted_value = s.to_base64(encBytes, s.base64_variants.ORIGINAL);
  const putRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/${secretName}`, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ encrypted_value, key_id })
  });
  return putRes.ok;
}

async function getLocalJson(p) {
  const r = await fetch(`${p}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(p);
  return r.json();
}

function mergeHistories(h1 = [], h2 = []) {
  const map = new Map();
  for (const item of [...h1, ...h2]) {
    if (!item || typeof item.numero !== "number") continue;
    const prev = map.get(item.numero);
    if (!prev || (item.estado === "enviada" && prev.estado !== "enviada") || (item.enviado && (!prev.enviado || item.enviado >= prev.enviado))) {
      map.set(item.numero, item);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.numero - b.numero);
}

async function loadData(preferRemote = false) {
  setSyncBadge("Sincronizando…", "info");
  await checkLocalApi();
  let remoteCfg = null, remoteState = null, localCfg = null, localState = null;

  try {
    const [rc, rs] = await Promise.all([
      fetchGhFile("data/config.json"),
      fetchGhFile("data/state.json")
    ]);
    remoteCfg = rc.json;
    remoteState = rs.json;
  } catch (_) {}

  try {
    [localCfg, localState] = await Promise.all([
      getLocalJson("data/config.json"),
      getLocalJson("data/state.json")
    ]);
  } catch (_) {}

  let lsCfg = null, lsState = null;
  try { lsCfg = JSON.parse(localStorage.getItem(LS_CFG_KEY) || "null"); } catch (_) {}
  try { lsState = JSON.parse(localStorage.getItem(LS_STATE_KEY) || "null"); } catch (_) {}

  if (remoteCfg) {
    CFG = remoteCfg;
    localStorage.setItem(LS_CFG_KEY, JSON.stringify(CFG));
  } else if (preferRemote && localCfg) {
    CFG = localCfg;
    localStorage.setItem(LS_CFG_KEY, JSON.stringify(CFG));
  } else {
    CFG = lsCfg || localCfg || structuredClone(FALLBACK_CFG);
  }

  if (remoteState && Array.isArray(remoteState.historial)) {
    STATE = { historial: remoteState.historial };
  } else if (localState && Array.isArray(localState.historial)) {
    STATE = { historial: localState.historial };
  } else if (lsState && Array.isArray(lsState.historial)) {
    STATE = { historial: lsState.historial };
  } else {
    STATE = { historial: [] };
  }
  localStorage.setItem(LS_STATE_KEY, JSON.stringify(STATE));

  if (getToken() || HAS_LOCAL_API) {
    setSyncBadge("Conectado a GitHub ✓", "ok");
  } else if (remoteCfg || remoteState) {
    setSyncBadge("Lectura activa (conecta Token para guardar)", "warn");
  } else if (localCfg) {
    setSyncBadge("Modo local activo", "info");
  } else {
    setSyncBadge("Memoria local activa", "warn");
  }

  SCHED = buildSchedule(CFG);
  if (STATE && Array.isArray(STATE.historial)) {
    STATE.historial = STATE.historial.filter(h => {
      const ov = getOverride(h.numero);
      if (ov && ov.estado === "pendiente") {
        const b = SCHED.find(x => x.numero === h.numero);
        if (!h.enviado || !b || new Date(h.enviado) < new Date(b.envio + "-05:00")) {
          return false;
        }
      }
      return true;
    });
    localStorage.setItem(LS_STATE_KEY, JSON.stringify(STATE));
  }
  render();
  fillFormFromCfg();
  updateSaveHint();
}

function getOverride(num) {
  if (!CFG || !CFG.ajustes) return null;
  return CFG.ajustes[pad(num, 3)] || CFG.ajustes[String(num)] || null;
}

function isBitacoraEnviada(b) {
  const ov = getOverride(b.numero);
  const h = STATE && Array.isArray(STATE.historial)
    ? STATE.historial.find(x => x.numero === b.numero && x.estado === "enviada")
    : null;
  if (!h) return false;
  if (ov && ov.estado === "pendiente") {
    if (h.enviado && b.envio && new Date(h.enviado) >= new Date(b.envio + "-05:00")) {
      return true;
    }
    return false;
  }
  return true;
}

function status(b) {
  if (isBitacoraEnviada(b)) return ["Enviada", "ok"];
  const hErr = STATE && Array.isArray(STATE.historial)
    ? STATE.historial.find(x => x.numero === b.numero && x.estado !== "enviada")
    : null;
  const ov = getOverride(b.numero);
  if (hErr && (!ov || ov.estado !== "pendiente")) return ["Error", "bad"];
  if (b.omitir) return ["Omitida", "warn"];
  return new Date(b.envio + "-05:00") <= new Date() ? ["Pendiente (se envía hoy)", "warn"] : ["Programada", "info"];
}

function renderTemplateText(tpl, b) {
  if (!b) return tpl || "";
  return (tpl || "")
    .replaceAll("{numero}", pad(b.numero, 3))
    .replaceAll("{mes}", MESES[b.mes - 1])
    .replaceAll("{anio}", String(b.anio))
    .replaceAll("{desde}", fmt(b.desde))
    .replaceAll("{hasta}", fmt(b.hasta));
}

function render() {
  const next = SCHED.find(b => !b.omitir && !isBitacoraEnviada(b));
  $("#auto").textContent = CFG.activo ? "🟢 Automatización activa" : "🔴 Envíos en pausa";
  $("#auto").className = "pill " + (CFG.activo ? "ok" : "bad");
  $("#next").textContent = next
    ? `Bitácora N.º ${pad(next.numero, 3)} (${MESES[next.mes - 1]} ${next.anio}) · ${next.envio.replace("T", " a las ")}`
    : "🎉 ¡Todas las bitácoras están enviadas!";
  const miCorreo = (CFG.remitente || CFG.mi_correo || "Miltonchavez740@gmail.com").trim();
  if ($("#sender")) $("#sender").textContent = miCorreo + (CFG.copia_mi_correo ? " (recibe copia)" : "");
  $("#dest").textContent = (CFG.destinatarios || []).join(", ") || "Sin destinatario";
  $("#subject").textContent = next ? renderTemplateText(CFG.asunto, next) : CFG.asunto;
  const validHist = STATE.historial.filter(h => {
    const b = SCHED.find(x => x.numero === h.numero);
    return b ? isBitacoraEnviada(b) || h.estado !== "enviada" : true;
  });
  if ($("#hist-count")) $("#hist-count").textContent = String(validHist.filter(h => h.estado === "enviada").length);

  $("#rows").innerHTML = SCHED.map(b => {
    const [t, c] = status(b);
    const badgeAjuste = b.tieneAjuste ? ` <span class="pill warn" style="padding:1px 6px;font-size:0.7rem;" title="Fechas personalizadas">Ajustada</span>` : "";
    return `<tr>
      <td><b>Bitácora ${pad(b.numero, 3)}</b>${badgeAjuste}</td>
      <td>${MESES[b.mes - 1]} ${b.anio}</td>
      <td>${fmt(b.desde)} al ${fmt(b.hasta)}</td>
      <td>${b.envio.replace("T", " · ")}</td>
      <td><span class="pill ${c}">${t}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" data-n="${b.numero}">⬇️ Descargar Excel</button>
          <button type="button" class="btn-secondary" data-edit="${b.numero}">✏️ Ajustar</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  $("#hist").innerHTML = validHist.length ? validHist.map(h =>
    `<tr>
      <td><b>Bitácora ${pad(h.numero, 3)}</b></td>
      <td>${h.periodo || "—"}</td>
      <td>${(h.enviado || "—").replace("T", " · ")}</td>
      <td><span class="pill ${h.estado === "enviada" ? "ok" : "bad"}">${h.estado === "enviada" ? "Enviada con éxito" : "Error"}${h.error ? ": " + h.error : ""}</span></td>
      <td>${(h.destinatarios || []).join(", ")}</td>
    </tr>`
  ).join("") : `<tr><td colspan="5">Aún no hay envíos registrados.</td></tr>`;

  updateLivePreview();
}

function fillFormFromCfg() {
  if (!CFG) return;
  const c = CFG.calendario || {};
  $("#f-activo").value = CFG.activo !== false ? "true" : "false";
  $("#f-remitente").value = (CFG.remitente || CFG.mi_correo || "Miltonchavez740@gmail.com").trim();
  $("#f-copia-mi-correo").value = CFG.copia_mi_correo ? "true" : "false";
  $("#f-dest").value = (CFG.destinatarios || []).join(", ");
  $("#f-cc").value = (CFG.cc || []).join(", ");
  $("#f-hora").value = formatHoraEnvio(c.hora_envio);
  $("#f-num-ini").value = c.numero_inicio ?? 3;
  $("#f-anio-ini").value = c.anio_inicio ?? 2026;
  $("#f-mes-ini").value = String(c.mes_inicio ?? 10);
  const isEterno = c.eterno || !c.cantidad;
  $("#f-modo").value = isEterno ? "eterno" : "fijo";
  $("#wrap-cantidad").hidden = isEterno;
  $("#f-cantidad").value = c.cantidad || 12;
  $("#f-asunto").value = CFG.asunto || "";
  $("#f-cuerpo").value = CFG.cuerpo || "";
  $("#f-repo").value = getRepo();
  $("#f-token").value = getToken();
  const savedGmailPass = getGmailPass() || decodeSmtpToken(CFG.smtp_token);
  if ($("#f-gmail-pass")) $("#f-gmail-pass").value = savedGmailPass;
  if (savedGmailPass) localStorage.setItem(LS_GMAIL_PASS_KEY, savedGmailPass);
  updateGmailPassHint();
  updateLivePreview();
}

function updateLivePreview() {
  const sample = SCHED.find(b => !STATE.historial.some(h => h.numero === b.numero && h.estado === "enviada")) || SCHED[0];
  if (!sample) return;
  const fromMail = ($("#f-remitente") && $("#f-remitente").value.trim()) || CFG.remitente || "Miltonchavez740@gmail.com";
  const toMail = ($("#f-dest") && $("#f-dest").value.trim()) || (CFG.destinatarios || []).join(", ");
  const ccRaw = ($("#f-cc") && $("#f-cc").value.trim()) || (CFG.cc || []).join(", ");
  const wantSelfCopy = $("#f-copia-mi-correo") ? $("#f-copia-mi-correo").value === "true" : !!CFG.copia_mi_correo;
  const ccList = ccRaw ? ccRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
  if (wantSelfCopy && fromMail && !ccList.includes(fromMail)) ccList.push(fromMail);
  const subj = renderTemplateText($("#f-asunto") ? $("#f-asunto").value : CFG.asunto, sample);
  const body = renderTemplateText($("#f-cuerpo") ? $("#f-cuerpo").value : CFG.cuerpo, sample);
  const box = $("#mail-preview");
  const ccLine = ccList.length ? `\nCC: ${ccList.join(", ")}` : "";
  if (box) box.textContent = `De (mi correo): ${fromMail}\nPara (envío): ${toMail}${ccLine}\nAsunto: ${subj}\n\n${body}`;
}

function readCfgFromForm() {
  const splitEmails = s => s.split(",").map(x => x.trim()).filter(Boolean);
  const isEterno = $("#f-modo").value === "eterno";
  const horaRaw = $("#f-hora").value || "00:00";
  const [hh, mm] = horaRaw.split(":").map(Number);
  const horaVal = mm === 0 ? hh : `${pad(hh)}:${pad(mm)}`;

  const cal = {
    numero_inicio: Number($("#f-num-ini").value) || 1,
    anio_inicio: Number($("#f-anio-ini").value) || 2026,
    mes_inicio: Number($("#f-mes-ini").value) || 1,
    hora_envio: horaVal,
    eterno: isEterno
  };
  if (!isEterno) {
    cal.cantidad = Math.max(1, Number($("#f-cantidad").value) || 12);
  }

  const rawPass = ($("#f-gmail-pass") ? $("#f-gmail-pass").value : "").replace(/\s+/g, "");
  const smtpToken = rawPass ? encodeSmtpToken(rawPass) : (CFG.smtp_token || "");

  return {
    activo: $("#f-activo").value === "true",
    remitente: ($("#f-remitente").value || "").trim(),
    smtp_token: smtpToken,
    copia_mi_correo: $("#f-copia-mi-correo").value === "true",
    destinatarios: splitEmails($("#f-dest").value),
    cc: splitEmails($("#f-cc").value),
    asunto: $("#f-asunto").value.trim(),
    cuerpo: $("#f-cuerpo").value,
    calendario: cal,
    ajustes: CFG.ajustes || {}
  };
}

async function persistAll(commitMessage = "Actualizar parametrización desde el panel web", saveStateToo = false) {
  const rawPass = ($("#f-gmail-pass") ? $("#f-gmail-pass").value : "").replace(/\s+/g, "");
  if (rawPass) {
    localStorage.setItem(LS_GMAIL_PASS_KEY, rawPass);
    CFG.smtp_token = encodeSmtpToken(rawPass);
  }
  localStorage.setItem(LS_CFG_KEY, JSON.stringify(CFG));
  localStorage.setItem(LS_STATE_KEY, JSON.stringify(STATE));
  if ($("#f-repo")) localStorage.setItem(LS_REPO_KEY, $("#f-repo").value.trim() || DEFAULT_REPO);
  if ($("#f-token")) localStorage.setItem(LS_TOKEN_KEY, $("#f-token").value.trim());

  SCHED = buildSchedule(CFG);
  render();
  updateSaveHint();
  updateGmailPassHint();

  const token = getToken();
  if (token) {
    try {
      setSyncBadge("Guardando en GitHub…", "info");
      await putGhFile("data/config.json", CFG, commitMessage);
      if (saveStateToo) {
        await putGhFile("data/state.json", STATE, commitMessage);
      }
      if (rawPass) {
        try {
          if (CFG.remitente) await putGhSecret("GMAIL_USER", CFG.remitente);
          await putGhSecret("GMAIL_APP_PASSWORD", rawPass);
        } catch (_) {}
      }
      setSyncBadge("Guardado en GitHub ✓", "ok");
      showToast(`✅ Cambios y credenciales de correo guardados en GitHub (${getRepo()}/data/config.json).`);
      return;
    } catch (err) {
      setSyncBadge("Error al subir a GitHub", "bad");
      showToast(`No se pudo subir a GitHub: ${err.message}. Verifica tu Token en la pestaña '3. Conexión GitHub'.`, true);
      return;
    }
  }

  if (HAS_LOCAL_API) {
    try {
      setSyncBadge("Subiendo a GitHub…", "info");
      const r = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: CFG,
          state: saveStateToo ? STATE : null,
          message: commitMessage
        })
      });
      const resData = await r.json();
      if (r.ok && resData.ok && resData.pushed) {
        setSyncBadge("Guardado en GitHub ✓", "ok");
        showToast("✅ Cambios guardados en data/config.json y subidos automáticamente a tu repositorio GitHub.");
        return;
      } else if (r.ok && resData.ok) {
        setSyncBadge("Guardado en disco local ✓", "ok");
        showToast("✅ Guardado en data/config.json local" + (resData.git_error ? ` (aviso git: ${resData.git_error})` : "."));
        return;
      }
    } catch (_) {}
  }

  // Si no hay Token ni servidor local, llevamos al usuario directo al campo del Token
  const tabCon = document.querySelector('[data-cfg-tab="conexion"]');
  if (tabCon && !$("#cfg-panel").hidden) {
    tabCon.click();
    if ($("#f-token")) $("#f-token").focus();
  }
  setSyncBadge("Falta Token para subir a GitHub", "warn");
  showToast("⚠️ Se guardó en tu navegador, pero para que se suba al repositorio de GitHub debes pegar tu Token de GitHub en '3. Conexión GitHub' (o abrir el panel con abrir_panel.bat).", true);
}

function openOverrideEditor(num) {
  const b = SCHED.find(x => x.numero === num);
  if (!b) return;
  const isEnviada = isBitacoraEnviada(b);
  $("#ov-num").value = String(b.numero);
  $("#ov-title").textContent = `✏️ Ajustar Bitácora N.º ${pad(b.numero, 3)} (${MESES[b.mes - 1]} ${b.anio})`;
  $("#ov-desde").value = `${b.desde.y}-${pad(b.desde.m)}-${pad(b.desde.d)}`;
  $("#ov-hasta").value = `${b.hasta.y}-${pad(b.hasta.m)}-${pad(b.hasta.d)}`;
  $("#ov-envio").value = b.envio.slice(0, 16);
  $("#ov-estado-hist").value = isEnviada ? "enviada" : "pendiente";
  $("#ov-panel").hidden = false;
}

async function downloadBitacoraExcel(num) {
  const b = SCHED.find(x => x.numero === num);
  if (!b) return;
  let buf = null;
  try {
    const r = await fetch("templates/bitacora.xlsx");
    if (r.ok) buf = await r.arrayBuffer();
  } catch (_) {}
  if (!buf) {
    const r = await fetch(`https://raw.githubusercontent.com/${getRepo()}/main/templates/bitacora.xlsx`);
    if (!r.ok) throw new Error("No se pudo descargar la plantilla base.");
    buf = await r.arrayBuffer();
  }
  const blob = await generateXlsx(buf, b);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName(b);
  a.click();
}

let lastAutoDispatchAt = 0;

async function triggerWorkflow(prueba = false, isAuto = false) {
  const repo = getRepo();
  const token = getToken();
  if (!token) {
    if (!isAuto) {
      window.open(`https://github.com/${repo}/actions/workflows/send.yml`, "_blank");
      showToast("Se abrió GitHub Actions en otra pestaña. (Si configuras tu Token de GitHub en Configuración, podrás dispararlo con 1 clic sin salir de aquí).");
    }
    return;
  }
  try {
    const miCorreo = ($("#f-remitente") && $("#f-remitente").value.trim()) || (CFG && CFG.remitente) || "";
    const gmailPass = ($("#f-gmail-pass") && $("#f-gmail-pass").value.replace(/\s+/g, "")) || getGmailPass() || decodeSmtpToken(CFG && CFG.smtp_token) || "";
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/send.yml/dispatches`, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          numero: "",
          dry_run: "false",
          prueba: prueba ? "true" : "false",
          remitente: miCorreo,
          gmail_pass: gmailPass
        }
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast(prueba
      ? "🧪 Envío de prueba disparado en GitHub Actions. Revisa tu bandeja en ~30 segundos."
      : (isAuto
        ? "⏰ Hora programada alcanzada: enviando bitácora automáticamente en GitHub Actions (~30 s)…"
        : "🚀 Envío real disparado en GitHub Actions. En ~30 segundos se actualizará el estado."));
    setTimeout(() => loadData(true), 20000);
    setTimeout(() => loadData(true), 40000);
  } catch (err) {
    if (!isAuto) showToast(`No se pudo disparar el workflow: ${err.message}`, true);
  }
}

async function checkDueAndAutoSend() {
  if (!CFG || !CFG.activo || !STATE || !Array.isArray(SCHED)) return;
  const now = new Date();
  const due = SCHED.find(b =>
    !b.omitir &&
    !isBitacoraEnviada(b) &&
    new Date(b.envio + "-05:00") <= now
  );
  if (!due) return;
  render();
  if (getToken() && Date.now() - lastAutoDispatchAt > 90000) {
    lastAutoDispatchAt = Date.now();
    await triggerWorkflow(false, true);
  }
}

document.addEventListener("click", async e => {
  const btnExcel = e.target.closest("[data-n]");
  if (btnExcel) {
    try { await downloadBitacoraExcel(Number(btnExcel.dataset.n)); }
    catch (err) { showToast("No se pudo generar el Excel: " + err.message, true); }
    return;
  }
  const btnEdit = e.target.closest("[data-edit]");
  if (btnEdit) {
    openOverrideEditor(Number(btnEdit.dataset.edit));
    return;
  }
  const cfgTabBtn = e.target.closest("[data-cfg-tab]");
  if (cfgTabBtn) {
    const target = cfgTabBtn.dataset.cfgTab;
    document.querySelectorAll("[data-cfg-tab]").forEach(b => b.classList.toggle("active", b === cfgTabBtn));
    document.querySelectorAll("[data-cfg-pane]").forEach(p => { p.hidden = p.dataset.cfgPane !== target; });
    return;
  }
  const mainTabBtn = e.target.closest("[data-main-tab]");
  if (mainTabBtn) {
    const target = mainTabBtn.dataset.mainTab;
    document.querySelectorAll("[data-main-tab]").forEach(b => b.classList.toggle("active", b === mainTabBtn));
    $("#pane-cal").hidden = target !== "cal";
    $("#pane-hist").hidden = target !== "hist";
    return;
  }
  if (e.target.id === "ov-panel") {
    $("#ov-panel").hidden = true;
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#ov-panel").hidden) {
    $("#ov-panel").hidden = true;
  }
});

$("#btn-toggle-cfg").addEventListener("click", () => {
  const p = $("#cfg-panel");
  p.hidden = !p.hidden;
  if (!p.hidden) {
    fillFormFromCfg();
    p.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

if ($("#btn-close-cfg")) {
  $("#btn-close-cfg").addEventListener("click", () => {
    $("#cfg-panel").hidden = true;
  });
}

$("#btn-sync").addEventListener("click", () => loadData(true));

$("#f-modo").addEventListener("change", () => {
  $("#wrap-cantidad").hidden = $("#f-modo").value === "eterno";
});

["#f-remitente", "#f-copia-mi-correo", "#f-dest", "#f-cc", "#f-asunto", "#f-cuerpo", "#f-num-ini", "#f-anio-ini", "#f-mes-ini"].forEach(sel => {
  const el = $(sel);
  if (el) el.addEventListener("input", updateLivePreview);
  if (el) el.addEventListener("change", updateLivePreview);
});

if ($("#f-token")) {
  $("#f-token").addEventListener("input", updateSaveHint);
}
if ($("#f-gmail-pass")) {
  $("#f-gmail-pass").addEventListener("input", updateGmailPassHint);
}

$("#cfg-form").addEventListener("submit", async e => {
  e.preventDefault();
  const nextCfg = readCfgFromForm();
  if (!nextCfg.destinatarios.length) {
    const tabCorreos = document.querySelector('[data-cfg-tab="correos"]');
    if (tabCorreos) tabCorreos.click();
    $("#f-dest").focus();
    showToast("Por favor escribe al menos un correo destinatario en '1. Correos'.", true);
    return;
  }
  CFG = nextCfg;
  await persistAll("Actualizar parametrización desde el panel web", false);
});

$("#btn-export-cfg").addEventListener("click", () => {
  CFG = readCfgFromForm();
  const blob = new Blob([JSON.stringify(CFG, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "config.json";
  a.click();
});

$("#btn-reset-local").addEventListener("click", async () => {
  localStorage.removeItem(LS_CFG_KEY);
  localStorage.removeItem(LS_STATE_KEY);
  await loadData(true);
  showToast("🔄 Datos recargados directamente desde GitHub.");
});

$("#btn-run-now").addEventListener("click", () => triggerWorkflow(false));
$("#btn-run-test").addEventListener("click", () => triggerWorkflow(true));

if ($("#ov-envio")) {
  $("#ov-envio").addEventListener("input", () => {
    if ($("#ov-estado-hist")) $("#ov-estado-hist").value = "pendiente";
  });
}

$("#ov-form").addEventListener("submit", async e => {
  e.preventDefault();
  const num = Number($("#ov-num").value);
  const key = pad(num, 3);
  const histAction = $("#ov-estado-hist").value;
  CFG.ajustes = CFG.ajustes || {};
  CFG.ajustes[key] = {
    desde: $("#ov-desde").value,
    hasta: $("#ov-hasta").value,
    envio: $("#ov-envio").value,
    estado: histAction === "enviada" ? "enviada" : "pendiente"
  };
  let saveStateToo = true;
  if (histAction === "enviada") {
    const b = buildSchedule(CFG).find(x => x.numero === num);
    const entry = {
      numero: num,
      periodo: b ? `${fmt(b.desde)} - ${fmt(b.hasta)}` : `${$("#ov-desde").value} - ${$("#ov-hasta").value}`,
      programado: $("#ov-envio").value + ":00-05:00",
      archivo: b ? fileName(b) : `Bitacora_${key}.xlsx`,
      sha256: "manual",
      destinatarios: CFG.destinatarios,
      message_id: "<registro-manual@bitacoras.local>",
      estado: "enviada",
      enviado: new Date().toISOString().slice(0, 19) + "Z",
      error: null
    };
    STATE.historial = STATE.historial.filter(h => h.numero !== num).concat([entry]).sort((a, b) => a.numero - b.numero);
  } else {
    STATE.historial = STATE.historial.filter(h => h.numero !== num);
  }
  $("#ov-panel").hidden = true;
  await persistAll(`Ajustar bitácora ${key} desde el panel`, saveStateToo);
  setTimeout(checkDueAndAutoSend, 1500);
});

$("#btn-ov-clear").addEventListener("click", async () => {
  const num = Number($("#ov-num").value);
  const key = pad(num, 3);
  if (CFG.ajustes) {
    delete CFG.ajustes[key];
    delete CFG.ajustes[String(num)];
  }
  $("#ov-panel").hidden = true;
  await persistAll(`Restaurar fechas automáticas de bitácora ${key}`, false);
});

$("#btn-ov-cancel").addEventListener("click", () => {
  $("#ov-panel").hidden = true;
});

loadData(true);
setInterval(checkDueAndAutoSend, 15000);
