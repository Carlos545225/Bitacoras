const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const pad = (n, l = 2) => String(n).padStart(l, "0");
const fmt = d => `${pad(d.d)}/${pad(d.m)}/${d.y}`;

function buildSchedule(cfg) {
  const c = cfg.calendario, out = [];
  let y = c.anio_inicio, m = c.mes_inicio;
  let count = c.cantidad;
  if (c.eterno || !count) {
    const now = new Date();
    const elapsed = (now.getFullYear() - y) * 12 + ((now.getMonth() + 1) - m) + 1;
    count = Math.max(elapsed + 12, 12);
  }
  for (let i = 0; i < count; i++) {
    const n = c.numero_inicio + i, ov = (cfg.ajustes || {})[pad(n, 3)] || {};
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // día 0 del mes siguiente = último día (maneja bisiestos)
    const parse = s => { const [Y, M, D] = s.split("-").map(Number); return { y: Y, m: M, d: D }; };
    const desde = ov.desde ? parse(ov.desde) : { y, m, d: 1 };
    const hasta = ov.hasta ? parse(ov.hasta) : { y, m, d: last };
    const envio = ov.envio || `${hasta.y}-${pad(hasta.m)}-${pad(hasta.d)}T${pad(c.hora_envio)}:00`;
    out.push({ numero: n, anio: y, mes: m, desde, hasta, entrega: hasta, envio });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}
if (typeof module !== "undefined") module.exports = { buildSchedule, fmt, pad };
