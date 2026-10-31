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
        raw = (ROOT / p).read_text(encoding="utf-8").strip()
        return json.loads(raw) if raw else default
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def parse_hora(val):
    if isinstance(val, str) and ":" in val:
        parts = val.split(":")
        return time(int(parts[0]), int(parts[1]))
    return time(int(val or 0), 0)


def schedule(cfg, target_num=None):
    c, out = cfg["calendario"], []
    y, m = int(c["anio_inicio"]), int(c["mes_inicio"])
    num_inicio = int(c["numero_inicio"])
    is_eterno = c.get("eterno", False) or "cantidad" not in c or not c["cantidad"]
    if is_eterno:
        now = datetime.now(TZ)
        elapsed = (now.year - y) * 12 + (now.month - m) + 1
        count = max(elapsed + 12, 12)
    else:
        count = int(c["cantidad"])
    if target_num is not None:
        needed = target_num - num_inicio + 1
        if needed > count:
            count = needed

    hora_default = parse_hora(c.get("hora_envio", 0))
    ajustes = cfg.get("ajustes") or {}
    for i in range(count):
        n = num_inicio + i
        ov = ajustes.get(f"{n:03d}") or ajustes.get(str(n)) or {}
        desde = date.fromisoformat(ov["desde"]) if ov.get("desde") else date(y, m, 1)
        hasta = date.fromisoformat(ov["hasta"]) if ov.get("hasta") else date(y, m, calendar.monthrange(y, m)[1])
        if ov.get("envio"):
            envio_dt = datetime.fromisoformat(ov["envio"])
        else:
            envio_dt = datetime.combine(hasta, hora_default)
        if envio_dt.tzinfo is None:
            envio_dt = envio_dt.replace(tzinfo=TZ)
        out.append(dict(
            numero=n, anio=y, mes=m, desde=desde, hasta=hasta,
            entrega=hasta, envio=envio_dt, omitir=bool(ov.get("omitir", False))
        ))
        m, y = (1, y + 1) if m == 12 else (m + 1, y)
    return out


def render(t, b):
    return (t.replace("{numero}", f"{b['numero']:03d}").replace("{mes}", MESES[b["mes"] - 1])
             .replace("{anio}", str(b["anio"])).replace("{desde}", f"{b['desde']:%d/%m/%Y}")
             .replace("{hasta}", f"{b['hasta']:%d/%m/%Y}"))


def clean_emails(lst):
    if isinstance(lst, str):
        lst = lst.split(",")
    return [x.strip() for x in (lst or []) if x and x.strip()]


def send_mail(cfg, b, path, to, subject, body, user, pwd, cc, reply_to=None):
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = reply_to or user, ", ".join(to), subject
    if reply_to and reply_to.lower() != user.lower():
        msg["Reply-To"] = reply_to
    if cc:
        msg["Cc"] = ", ".join(cc)
    mid = make_msgid(domain="bitacoras.local")
    msg["Message-ID"] = mid
    msg.set_content(body)
    msg.add_attachment(path.read_bytes(), maintype="application",
                       subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=path.name)
    last = None
    login_candidates = [reply_to, user] if (reply_to and reply_to.lower() != user.lower()) else [user]
    for wait in (0, 15, 45):  # 3 intentos con espera creciente
        T.sleep(wait)
        try:
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=60) as s:
                logged_in = False
                last_auth_err = None
                for cand in login_candidates:
                    if not cand:
                        continue
                    try:
                        s.login(cand, pwd)
                        logged_in = True
                        break
                    except smtplib.SMTPAuthenticationError as ae:
                        last_auth_err = ae
                if not logged_in and last_auth_err:
                    raise last_auth_err
                s.send_message(msg)
            return mid
        except smtplib.SMTPAuthenticationError:
            raise  # reintentar no sirve: credenciales inválidas
        except Exception as e:  # red, timeouts, etc.
            last = e
            print(f"Intento fallido: {e}", file=sys.stderr)
    raise RuntimeError(f"No se pudo enviar tras 3 intentos: {last}")


def save_state(state):
    state["historial"] = sorted(state.get("historial", []), key=lambda h: h.get("numero", 0))
    (ROOT / "data/state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def process(cfg, state, b, dry, test):
    name = f"Bitacora_{b['numero']:03d}_{MESES[b['mes']-1]}_{b['anio']}.xlsx"
    gen_dir = ROOT / "generated"
    gen_dir.mkdir(parents=True, exist_ok=True)
    out = gen_dir / name
    build_bitacora(ROOT / "templates/bitacora.xlsx", out, b["numero"], b["desde"], b["hasta"], b["entrega"])
    verify_bitacora(ROOT / "templates/bitacora.xlsx", out, b["numero"], b["desde"], b["hasta"], b["entrega"])
    assert 0 < out.stat().st_size < 20 * 1024 * 1024, "Tamaño de adjunto inválido"
    print(f"Generado y verificado: {name}")
    if dry:
        print("DRY RUN: no se envía nada.")
        return True
    mi_correo = (os.environ.get("REMITENTE") or cfg.get("remitente") or cfg.get("mi_correo") or "").strip()
    env_user = (os.environ.get("GMAIL_USER") or "").strip()
    user = env_user or mi_correo
    pwd = (os.environ.get("GMAIL_APP_PASSWORD") or "").strip()
    if not user or not pwd:
        raise SystemExit("Faltan las credenciales de correo (GMAIL_USER / GMAIL_APP_PASSWORD)")
    to = [mi_correo or user] if test else clean_emails(cfg.get("destinatarios"))
    cc = [] if test else clean_emails(cfg.get("cc"))
    if not test and cfg.get("copia_mi_correo") and (mi_correo or user):
        own = mi_correo or user
        if own.lower() not in [x.lower() for x in to + cc]:
            cc.append(own)
    if not to:
        raise SystemExit("No hay destinatarios configurados en data/config.json")
    subject = ("[PRUEBA] " if test else "") + render(cfg["asunto"], b)
    entry = dict(numero=b["numero"], periodo=f"{b['desde']:%d/%m/%Y} - {b['hasta']:%d/%m/%Y}",
                 programado=b["envio"].isoformat(), archivo=name,
                 sha256=hashlib.sha256(out.read_bytes()).hexdigest()[:16], destinatarios=to)
    try:
        entry["message_id"] = send_mail(cfg, b, out, to, subject, render(cfg["cuerpo"], b), user, pwd, cc, reply_to=mi_correo or user)
        entry.update(estado="enviada", enviado=datetime.now(TZ).isoformat(timespec="seconds"), error=None)
    except Exception as e:
        entry.update(estado="error", enviado=None, error=str(e)[:300])
    if not test:  # las pruebas no se registran, para no bloquear el envío real
        state["historial"] = [h for h in state.get("historial", []) if h.get("numero") != b["numero"]] + [entry]
        save_state(state)
        if entry["estado"] == "enviada" and isinstance(cfg.get("ajustes"), dict):
            for k in (f"{b['numero']:03d}", str(b["numero"])):
                if k in cfg["ajustes"] and isinstance(cfg["ajustes"][k], dict):
                    cfg["ajustes"][k]["estado"] = "enviada"
            (ROOT / "data/config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Bitácora {b['numero']:03d}: {entry['estado']}" + (f" - {entry['error']}" if entry["error"] else ""))
    return entry["estado"] == "enviada"


def is_already_sent(b, state, cfg):
    ajustes = cfg.get("ajustes") or {}
    ov = ajustes.get(f"{b['numero']:03d}") or ajustes.get(str(b["numero"])) or {}
    if ov.get("estado") == "pendiente":
        return False
    return any(h.get("numero") == b["numero"] and h.get("estado") == "enviada" for h in state.get("historial", []))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--numero", type=int, default=int(os.environ.get("NUMERO") or 0) or None)
    ap.add_argument("--dry-run", action="store_true", default=os.environ.get("DRY_RUN") == "true")
    ap.add_argument("--prueba", action="store_true", default=os.environ.get("PRUEBA") == "true")
    a = ap.parse_args()
    cfg = load("data/config.json")
    state = load("data/state.json", {"historial": []})
    if not isinstance(state, dict) or "historial" not in state:
        state = {"historial": []}
    if not cfg.get("activo", True) and not (a.dry_run or a.prueba):
        return print("Automatización pausada (activo=false).")
    dests = clean_emails(cfg.get("destinatarios"))
    if not a.dry_run and not a.prueba and (not dests or any("EJEMPLO" in x.upper() for x in dests)):
        raise SystemExit("Edita data/config.json: falta el correo del destinatario.")
    sched = schedule(cfg, target_num=a.numero)
    if a.numero:
        todo = [b for b in sched if b["numero"] == a.numero]
        if not todo:
            raise SystemExit(f"La bitácora {a.numero} no está en el calendario")
        if is_already_sent(todo[0], state, cfg) and not (a.dry_run or a.prueba):
            return print(f"La bitácora {a.numero:03d} ya fue enviada; no se repite.")
    else:
        now = datetime.now(TZ)
        todo = [b for b in sched if not is_already_sent(b, state, cfg) and not b.get("omitir") and b["envio"] <= now]
    if not todo:
        return print("Nada pendiente por enviar hoy.")
    for b in todo:
        if not process(cfg, state, b, a.dry_run, a.prueba):
            sys.exit(1)  # corta en el primer error para mantener el orden; queda en rojo y GitHub avisa


if __name__ == "__main__":
    main()
