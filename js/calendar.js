const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const pad = (n, l = 2) => String(n).padStart(l, "0");
const fmt = d => `${pad(d.d)}/${pad(d.m)}/${d.y}`;

function formatHoraEnvio(val) {
  if (typeof val === "string" && val.includes(":")) {
    const [h, m] = val.split(":");
    return `${pad(Number(h) || 0)}:${pad(Number(m) || 0)}`;
  }
  return `${pad(Number(val) || 0)}:00`;
}

function buildSchedule(cfg) {
  const c = cfg.calendario || {}, out = [];
  let y = Number(c.anio_inicio) || 2026, m = Number(c.mes_inicio) || 1;
  const numInicio = Number(c.numero_inicio) || 1;
  let count = Number(c.cantidad) || 0;
  if (c.eterno || !count) {
    const now = new Date();
    const elapsed = (now.getFullYear() - y) * 12 + ((now.getMonth() + 1) - m) + 1;
    count = Math.max(elapsed + 12, 12);
  }
  const horaStr = formatHoraEnvio(c.hora_envio);
  const ajustes = cfg.ajustes || {};
  for (let i = 0; i < count; i++) {
    const n = numInicio + i;
    const ov = ajustes[pad(n, 3)] || ajustes[String(n)] || {};
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const parse = s => { const [Y, M, D] = s.split("-").map(Number); return { y: Y, m: M, d: D }; };
    const desde = ov.desde ? parse(ov.desde) : { y, m, d: 1 };
    const hasta = ov.hasta ? parse(ov.hasta) : { y, m, d: last };
    const envio = ov.envio || `${hasta.y}-${pad(hasta.m)}-${pad(hasta.d)}T${horaStr}`;
    out.push({
      numero: n, anio: y, mes: m, desde, hasta, entrega: hasta,
      envio, omitir: Boolean(ov.omitir), tieneAjuste: Boolean(ov.desde || ov.hasta || ov.envio || ov.omitir)
    });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
if (typeof module !== "undefined") module.exports = { buildSchedule, fmt, pad, formatHoraEnvio };
