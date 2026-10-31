const $ = s => document.querySelector(s);
const fileName = b => `Bitacora_${pad(b.numero, 3)}_${MESES[b.mes - 1]}_${b.anio}.xlsx`;
let CFG, STATE, SCHED;

async function getJson(p) { const r = await fetch(p, { cache: "no-store" }); if (!r.ok) throw new Error(p); return r.json(); }

function status(b) {
  const h = STATE.historial.find(x => x.numero === b.numero);
  if (h) return h.estado === "enviada" ? ["Enviada", "ok"] : ["Error", "bad"];
  return new Date(b.envio + "-05:00") <= new Date() ? ["Pendiente (se envía hoy)", "warn"] : ["Programada", "info"];
}

function render() {
  const next = SCHED.find(b => !STATE.historial.some(h => h.numero === b.numero && h.estado === "enviada"));
  $("#auto").textContent = CFG.activo ? "Activa" : "Pausada";
  $("#auto").className = "pill " + (CFG.activo ? "ok" : "bad");
  $("#next").textContent = next ? `N.º ${pad(next.numero, 3)} · ${next.envio.replace("T", " ")} (hora Bogotá)` : "Todas enviadas";
  $("#dest").textContent = CFG.destinatarios.join(", ");
  $("#subject").textContent = CFG.asunto;
  $("#rows").innerHTML = SCHED.map(b => {
    const [t, c] = status(b);
    return `<tr><td>${pad(b.numero, 3)}</td><td>${MESES[b.mes - 1]} ${b.anio}</td><td>${fmt(b.desde)} – ${fmt(b.hasta)}</td>
      <td>${b.envio.replace("T", " ")}</td><td><span class="pill ${c}">${t}</span></td>
      <td><button data-n="${b.numero}">Descargar Excel</button></td></tr>`;
  }).join("");
  $("#hist").innerHTML = STATE.historial.length ? STATE.historial.map(h =>
    `<tr><td>${pad(h.numero, 3)}</td><td>${h.periodo}</td><td>${h.enviado || "—"}</td><td>${h.estado}${h.error ? ": " + h.error : ""}</td><td>${h.destinatarios.join(", ")}</td></tr>`
  ).join("") : `<tr><td colspan="5">Aún no hay envíos registrados.</td></tr>`;
}

document.addEventListener("click", async e => {
  const n = e.target.dataset && e.target.dataset.n; if (!n) return;
  try {
    const b = SCHED.find(x => x.numero === +n);
    const buf = await (await fetch("templates/bitacora.xlsx")).arrayBuffer();
    const blob = await generateXlsx(buf, b), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fileName(b); a.click();
  } catch (err) { alert("No se pudo generar el Excel: " + err.message); }
});

(async () => {
  try { [CFG, STATE] = await Promise.all([getJson("data/config.json"), getJson("data/state.json")]); SCHED = buildSchedule(CFG); render(); }
  catch (e) { $("#err").hidden = false; $("#err").textContent = "No se pudieron cargar los datos. Abre el panel desde GitHub Pages o con un servidor local (python -m http.server)."; }
})();
