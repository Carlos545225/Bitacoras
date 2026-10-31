"""Servidor local ligero para el panel de bitácoras.
Permite abrir http://localhost:8080 y guardar cambios directamente en data/config.json
y subirlos a GitHub (git commit + git push) usando las credenciales locales de Git."""
import http.server
import json
import subprocess
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8080


class PanelHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path.startswith("/api/ping"):
            self._send_json(200, {"ok": True, "mode": "local-git"})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/save"):
            try:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length).decode("utf-8")
                payload = json.loads(raw)
                cfg = payload.get("config")
                state = payload.get("state")
                msg = payload.get("message") or "Actualizar configuración desde el panel"

                files_to_stage = []
                if isinstance(cfg, dict):
                    cfg_path = ROOT / "data" / "config.json"
                    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    files_to_stage.append("data/config.json")

                if isinstance(state, dict):
                    st_path = ROOT / "data" / "state.json"
                    st_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    files_to_stage.append("data/state.json")

                pushed = False
                git_err = None
                if files_to_stage:
                    subprocess.run(["git", "add"] + files_to_stage, cwd=ROOT, check=False)
                    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT)
                    if diff.returncode != 0:
                        subprocess.run(["git", "commit", "-m", msg], cwd=ROOT, check=True)
                    push_res = subprocess.run(
                        ["git", "push", "origin", "main"],
                        cwd=ROOT,
                        capture_output=True,
                        text=True
                    )
                    if push_res.returncode == 0:
                        pushed = True
                    else:
                        git_err = (push_res.stderr or push_res.stdout or "Error en git push").strip()

                self._send_json(200, {"ok": True, "pushed": pushed, "git_error": git_err})
            except Exception as e:
                self._send_json(500, {"ok": False, "error": str(e)})
            return
        self._send_json(404, {"ok": False, "error": "Ruta no encontrada"})

    def _send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    url = f"http://localhost:{PORT}"
    print(f"Panel de bitacoras corriendo en {url}")
    print("Al darle 'Guardar cambios' en el navegador, se guardara en data/config.json y se subira a GitHub automaticamente.")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), PanelHandler) as httpd:
        httpd.serve_forever()

