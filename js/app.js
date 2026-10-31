const $ = s => document.querySelector(s);
const fileName = b => `Bitacora_${pad(b.numero, 3)}_${MESES[b.mes - 1]}_${b.anio}.xlsx`;

const DEFAULT_REPO = "Carlos545225/test";
const LS_CFG_KEY = "bitacoras_cfg_v2";
const LS_STATE_KEY = "bitacoras_state_v2";
const LS_REPO_KEY = "bitacoras_gh_repo";
const LS_TOKEN_KEY = "bitacoras_gh_token";

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
  historial: [
    {
      numero: 3,
      periodo: "01/10/2026 - 31/10/2026",
      programado: "2026-10-31T00:00:00-05:00",
      archivo: "Bitacora_003_Octubre_2026.xlsx",
      sha256: "1ff1950ffc3da6ec",
      destinatarios: ["Miltonchavez740@gmail.com"],
      message_id: "<179342480039.1869.10753606241969512000@bitacoras.local>",
      estado: "enviada",
      enviado: "2026-10-31T00:33:25-05:00",
      error: null
    }
  ]
};

let CFG = null, STATE = null, SCHED = [];

function getRepo() {
  return (localStorage.getItem(LS_REPO_KEY) || DEFAULT_REPO).trim();
}
function getToken() {
  return (localStorage.getItem(LS_TOKEN_KEY) || "").trim();
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
  const headers = { "Accept": "application/vnd.github.v3+json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?t=${Date.now()}`, {
    headers,
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const data = await res.json();
  return {
    json: JSON.parse(b64DecodeUtf8(data.content)),
    sha: data.sha
  };
}

async function putGhFile(path, obj, commitMsg) {
  const repo = getRepo();
  const token = getToken();
  if (!repo || !token) throw new Error("Falta el Token de GitHub para guardar en el repositorio remoto.");
  let sha = undefined;
  try {
    const cur = await fetchGhFile(path);
    sha = cur.sha;
  } catch (_) {}
  const body = {
    message: commitMsg,
    content: b64EncodeUtf8(JSON.stringify(obj, null, 2) + "\n")
  };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Error al guardar en GitHub (${res.status}): ${errTxt.slice(0, 140)}`);
  }
  return res.json();
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

  if (preferRemote && remoteCfg) {
    CFG = remoteCfg;
    localStorage.setItem(LS_CFG_KEY, JSON.stringify(CFG));
  } else {
    CFG = lsCfg || remoteCfg || localCfg || structuredClone(FALLBACK_CFG);
  }

  const mergedHist = mergeHistories(
    FALLBACK_STATE.historial,
    mergeHistories(
      (localState && localState.historial) || [],
      mergeHistories(
        (lsState && lsState.historial) || [],
        (remoteState && remoteState.historial) || []
      )
    )
  );
  if (preferRemote && remoteState && Array.isArray(remoteState.historial)) {
    STATE = { historial: mergeHistories(remoteState.historial, (localState && localState.historial) || []) };
  } else {
    STATE = { historial: mergedHist };
  }
  localStorage.setItem(LS_STATE_KEY, JSON.stringify(STATE));

  if (remoteCfg || remoteState) {
    setSyncBadge("Conectado a GitHub en vivo", "ok");
  } else if (localCfg) {
    setSyncBadge("Modo local activo", "ok");
  } else {
    setSyncBadge("Memoria local activa", "warn");
  }

  SCHED = buildSchedule(CFG);
  render();
  fillFormFromCfg();
}

function status(b) {
  const h = STATE.historial.find(x => x.numero === b.numero);
  if (h) return h.estado === "enviada" ? ["Enviada", "ok"] : ["Error", "bad"];
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
  const next = SCHED.find(b => !b.omitir && !STATE.historial.some(h => h.numero === b.numero && h.estado === "enviada"));
  $("#auto").textContent = CFG.activo ? "Activa" : "Pausada";
  $("#auto").className = "pill " + (CFG.activo ? "ok" : "bad");
  $("#next").textContent = next ? `N.º ${pad(next.numero, 3)} · ${next.envio.replace("T", " ")} (Bogotá)` : "Todas enviadas";
  const miCorreo = (CFG.remitente || CFG.mi_correo || "Miltonchavez740@gmail.com").trim();
  if ($("#sender")) $("#sender").textContent = miCorreo + (CFG.copia_mi_correo ? " (con copia)" : "");
  $("#dest").textContent = (CFG.destinatarios || []).join(", ") || "Sin destinatario";
  $("#subject").textContent = CFG.asunto;

  $("#rows").innerHTML = SCHED.map(b => {
    const [t, c] = status(b);
    const badgeAjuste = b.tieneAjuste ? ` <small class="mut" title="Fechas personalizadas">⚙️</small>` : "";
    return `<tr>
      <td><b>${pad(b.numero, 3)}</b>${badgeAjuste}</td>
      <td>${MESES[b.mes - 1]} ${b.anio}</td>
      <td>${fmt(b.desde)} – ${fmt(b.hasta)}</td>
      <td>${b.envio.replace("T", " ")}</td>
      <td><span class="pill ${c}">${t}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-secondary" data-edit="${b.numero}">✏️ Editar</button>
          <button type="button" data-n="${b.numero}">⬇️ Excel</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  $("#hist").innerHTML = STATE.historial.length ? STATE.historial.map(h =>
    `<tr>
      <td><b>${pad(h.numero, 3)}</b></td>
      <td>${h.periodo || "—"}</td>
      <td>${(h.enviado || "—").replace("T", " ")}</td>
      <td><span class="pill ${h.estado === "enviada" ? "ok" : "bad"}">${h.estado}${h.error ? ": " + h.error : ""}</span></td>
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

  return {
    activo: $("#f-activo").value === "true",
    remitente: ($("#f-remitente").value || "").trim(),
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
  localStorage.setItem(LS_CFG_KEY, JSON.stringify(CFG));
  localStorage.setItem(LS_STATE_KEY, JSON.stringify(STATE));
  if ($("#f-repo")) localStorage.setItem(LS_REPO_KEY, $("#f-repo").value.trim() || DEFAULT_REPO);
  if ($("#f-token")) localStorage.setItem(LS_TOKEN_KEY, $("#f-token").value.trim());

  SCHED = buildSchedule(CFG);
  render();

  const token = getToken();
  if (token) {
    try {
      setSyncBadge("Guardando en GitHub…", "info");
      await putGhFile("data/config.json", CFG, commitMessage);
      if (saveStateToo) {
        await putGhFile("data/state.json", STATE, commitMessage);
      }
      const newAppPass = $("#f-gmail-pass") ? $("#f-gmail-pass").value.replace(/\s+/g, "") : "";
      let secretsMsg = "";
      if (newAppPass) {
        if (CFG.remitente) await putGhSecret("GMAIL_USER", CFG.remitente);
        const okPass = await putGhSecret("GMAIL_APP_PASSWORD", newAppPass);
        if (okPass) {
          $("#f-gmail-pass").value = "";
          secretsMsg = " y se actualizaron tus credenciales GMAIL_USER / GMAIL_APP_PASSWORD en GitHub Secrets";
        }
      }
      setSyncBadge("Guardado en GitHub ✓", "ok");
      showToast(`✅ Cambios guardados en tu navegador y sincronizados directamente en GitHub (data/config.json)${secretsMsg}.`);
      return;
    } catch (err) {
      setSyncBadge("Guardado local (error GitHub)", "warn");
      showToast(`Guardado en el navegador, pero falló la subida a GitHub: ${err.message}`, true);
      return;
    }
  }

  showToast("✅ Parametrización guardada en este navegador. (Agrega un Token de GitHub si quieres que se suba sola al repositorio remoto).");
}

function openOverrideEditor(num) {
  const b = SCHED.find(x => x.numero === num);
  if (!b) return;
  $("#ov-num").value = String(b.numero);
  $("#ov-title").textContent = `✏️ Ajustar Bitácora N.º ${pad(b.numero, 3)} (${MESES[b.mes - 1]} ${b.anio})`;
  $("#ov-desde").value = `${b.desde.y}-${pad(b.desde.m)}-${pad(b.desde.d)}`;
  $("#ov-hasta").value = `${b.hasta.y}-${pad(b.hasta.m)}-${pad(b.hasta.d)}`;
  $("#ov-envio").value = b.envio.slice(0, 16);
  $("#ov-estado-hist").value = "keep";
  $("#ov-panel").hidden = false;
  $("#ov-panel").scrollIntoView({ behavior: "smooth", block: "center" });
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

async function triggerWorkflow(prueba = false) {
  const repo = getRepo();
  const token = getToken();
  if (!token) {
    window.open(`https://github.com/${repo}/actions/workflows/send.yml`, "_blank");
    showToast("Se abrió GitHub Actions en otra pestaña. (Si configuras tu Token de GitHub en Parametrización, podrás dispararlo con 1 clic sin salir de aquí).");
    return;
  }
  try {
    const miCorreo = ($("#f-remitente") && $("#f-remitente").value.trim()) || (CFG && CFG.remitente) || "";
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
          remitente: miCorreo
        }
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast(prueba
      ? "🧪 Envío de prueba disparado en GitHub Actions. Revisa tu bandeja en ~30 segundos."
      : "🚀 Envío real disparado en GitHub Actions. En ~30 segundos se actualizará el estado.");
    setTimeout(() => loadData(true), 25000);
  } catch (err) {
    showToast(`No se pudo disparar el workflow: ${err.message}`, true);
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
  }
});

$("#btn-toggle-cfg").addEventListener("click", () => {
  const p = $("#cfg-panel");
  p.hidden = !p.hidden;
  if (!p.hidden) fillFormFromCfg();
});

$("#btn-sync").addEventListener("click", () => loadData(true));

$("#f-modo").addEventListener("change", () => {
  $("#wrap-cantidad").hidden = $("#f-modo").value === "eterno";
});

["#f-remitente", "#f-copia-mi-correo", "#f-dest", "#f-cc", "#f-asunto", "#f-cuerpo", "#f-num-ini", "#f-anio-ini", "#f-mes-ini"].forEach(sel => {
  const el = $(sel);
  if (el) el.addEventListener("input", updateLivePreview);
  if (el) el.addEventListener("change", updateLivePreview);
});

$("#cfg-form").addEventListener("submit", async e => {
  e.preventDefault();
  CFG = readCfgFromForm();
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

$("#ov-form").addEventListener("submit", async e => {
  e.preventDefault();
  const num = Number($("#ov-num").value);
  const key = pad(num, 3);
  CFG.ajustes = CFG.ajustes || {};
  CFG.ajustes[key] = {
    desde: $("#ov-desde").value,
    hasta: $("#ov-hasta").value,
    envio: $("#ov-envio").value
  };
  const histAction = $("#ov-estado-hist").value;
  let saveStateToo = false;
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
    saveStateToo = true;
  } else if (histAction === "pendiente") {
    STATE.historial = STATE.historial.filter(h => h.numero !== num);
    saveStateToo = true;
  }
  $("#ov-panel").hidden = true;
  await persistAll(`Ajustar bitácora ${key} desde el panel`, saveStateToo);
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

loadData(false);
