"""Genera y envía las bitácoras pendientes. Pensado para correr a diario en GitHub Actions."""
import argparse, calendar, hashlib, json, os, smtplib, ssl, sys, time as T
from datetime import date, datetime, time
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent))
from excel_xml import build_bitacora, verify_bitacora

ROOT = Path(__file__).resolve().parent.parent
TZ = ZoneInfo("America/Bogota")
MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
         "Septiembre", "Octubre", "Noviembre", "Diciembre"]


def load(p, default=None):
    try:
        return json.loads((ROOT / p).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def schedule(cfg, target_num=None):
    c, out = cfg["calendario"], []
    y, m = c["anio_inicio"], c["mes_inicio"]
    is_eterno = c.get("eterno", False) or "cantidad" not in c or c["cantidad"] is None
    if is_eterno:
        now = datetime.now(TZ)
        elapsed = (now.year - y) * 12 + (now.month - m) + 1
        count = max(elapsed + 12, 12)
        if target_num is not None:
            needed = target_num - c["numero_inicio"] + 1
            if needed > count:
                count = needed
    else:
        count = c["cantidad"]
        if target_num is not None:
            needed = target_num - c["numero_inicio"] + 1
            if needed > count:
                count = needed

    for i in range(count):
        n = c["numero_inicio"] + i
        ov = cfg.get("ajustes", {}).get(f"{n:03d}", {})
        desde = date.fromisoformat(ov["desde"]) if "desde" in ov else date(y, m, 1)
        hasta = date.fromisoformat(ov["hasta"]) if "hasta" in ov else date(y, m, calendar.monthrange(y, m)[1])
        envio = datetime.fromisoformat(ov["envio"]) if "envio" in ov else datetime.combine(hasta, time(c["hora_envio"]))
        out.append(dict(numero=n, anio=y, mes=m, desde=desde, hasta=hasta, entrega=hasta, envio=envio.replace(tzinfo=TZ)))
        m, y = (1, y + 1) if m == 12 else (m + 1, y)
    return out


def render(t, b):
    return (t.replace("{numero}", f"{b['numero']:03d}").replace("{mes}", MESES[b["mes"] - 1])
             .replace("{anio}", str(b["anio"])).replace("{desde}", f"{b['desde']:%d/%m/%Y}")
             .replace("{hasta}", f"{b['hasta']:%d/%m/%Y}"))


def send_mail(cfg, b, path, to, subject, body, user, pwd, cc):
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = user, ", ".join(to), subject
    if cc:
        msg["Cc"] = ", ".join(cc)
    mid = make_msgid(domain="bitacoras.local")
    msg["Message-ID"] = mid
    msg.set_content(body)
    msg.add_attachment(path.read_bytes(), maintype="application",
                       subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=path.name)
    last = None
    for wait in (0, 15, 45):  # 3 intentos con espera creciente
        T.sleep(wait)
        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=60) as s:
                s.login(user, pwd)
                s.send_message(msg)
            return mid
        except smtplib.SMTPAuthenticationError:
            raise  # reintentar no sirve: credenciales inválidas
        except Exception as e:  # red, timeouts, etc.
            last = e
            print(f"Intento fallido: {e}", file=sys.stderr)
    raise RuntimeError(f"No se pudo enviar tras 3 intentos: {last}")


def process(cfg, state, b, dry, test):
    name = f"Bitacora_{b['numero']:03d}_{MESES[b['mes']-1]}_{b['anio']}.xlsx"
    out = ROOT / "generated" / name
    build_bitacora(ROOT / "templates/bitacora.xlsx", out, b["numero"], b["desde"], b["hasta"], b["entrega"])
    verify_bitacora(ROOT / "templates/bitacora.xlsx", out, b["numero"], b["desde"], b["hasta"], b["entrega"])
    assert 0 < out.stat().st_size < 20 * 1024 * 1024, "Tamaño de adjunto inválido"
    print(f"Generado y verificado: {name}")
    if dry:
        print("DRY RUN: no se envía nada.")
        return True
    user, pwd = os.environ.get("GMAIL_USER"), os.environ.get("GMAIL_APP_PASSWORD")
    if not user or not pwd:
        raise SystemExit("Faltan los Secrets GMAIL_USER / GMAIL_APP_PASSWORD")
    to = [user] if test else cfg["destinatarios"]
    cc = [] if test else cfg.get("cc", [])
    subject = ("[PRUEBA] " if test else "") + render(cfg["asunto"], b)
    entry = dict(numero=b["numero"], periodo=f"{b['desde']:%d/%m/%Y} - {b['hasta']:%d/%m/%Y}",
                 programado=b["envio"].isoformat(), archivo=name,
                 sha256=hashlib.sha256(out.read_bytes()).hexdigest()[:16], destinatarios=to)
    try:
        entry["message_id"] = send_mail(cfg, b, out, to, subject, render(cfg["cuerpo"], b), user, pwd, cc)
        entry.update(estado="enviada", enviado=datetime.now(TZ).isoformat(timespec="seconds"), error=None)
    except Exception as e:
        entry.update(estado="error", enviado=None, error=str(e)[:300])
    if not test:  # las pruebas no se registran, para no bloquear el envío real
        state["historial"] = [h for h in state["historial"] if h["numero"] != b["numero"]] + [entry]
        (ROOT / "data/state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Bitácora {b['numero']:03d}: {entry['estado']}" + (f" - {entry['error']}" if entry["error"] else ""))
    return entry["estado"] == "enviada"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--numero", type=int, default=int(os.environ.get("NUMERO") or 0) or None)
    ap.add_argument("--dry-run", action="store_true", default=os.environ.get("DRY_RUN") == "true")
    ap.add_argument("--prueba", action="store_true", default=os.environ.get("PRUEBA") == "true")
    a = ap.parse_args()
    cfg, state = load("data/config.json"), load("data/state.json", {"historial": []})
    if not cfg.get("activo", True) and not (a.dry_run or a.prueba):
        return print("Automatización pausada (activo=false).")
    if not a.dry_run and not a.prueba and any("EJEMPLO" in x.upper() for x in cfg["destinatarios"]):
        raise SystemExit("Edita data/config.json: falta el correo del destinatario.")
    sched = schedule(cfg, target_num=a.numero)
    enviadas = {h["numero"] for h in state["historial"] if h["estado"] == "enviada"}
    if a.numero:
        todo = [b for b in sched if b["numero"] == a.numero]
        if not todo:
            raise SystemExit(f"La bitácora {a.numero} no está en el calendario")
        if a.numero in enviadas and not (a.dry_run or a.prueba):
            raise SystemExit(f"La bitácora {a.numero:03d} ya fue enviada; no se repite.")
    else:
        now = datetime.now(TZ)
        todo = [b for b in sched if b["numero"] not in enviadas and b["envio"] <= now]  # incluye atrasadas, en orden
    if not todo:
        return print("Nada pendiente por enviar hoy.")
    for b in todo:
        if not process(cfg, state, b, a.dry_run, a.prueba):
            sys.exit(1)  # corta en el primer error para mantener el orden; queda en rojo y GitHub avisa


if __name__ == "__main__":
    main()
