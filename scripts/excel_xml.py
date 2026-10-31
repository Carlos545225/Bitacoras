"""Edita la plantilla GFPI-F-147 tocando SOLO las celdas necesarias de sheet1.xml.
No usa OpenPyXL para guardar (perdería la lista desplegable y otros elementos)."""
import re, zipfile, warnings
from datetime import date

SHEET = "xl/worksheets/sheet1.xml"  # hoja "Formato Bitácora Individual"
FECHAS_INICIO = ["F47", "F49", "F51", "F53", "F55"]
FECHAS_FIN = ["G47", "G49", "G51", "G53", "G55"]


def serial(d: date) -> int:
    return (d - date(1899, 12, 30)).days


def _set_cell(xml, ref, num=None, text=None):
    pat = re.compile(r'<c r="%s"([^>]*?)(?:/>|>.*?</c>)' % ref, re.S)
    m = pat.search(xml)
    if not m:
        raise ValueError(f"No se encontró la celda {ref}")
    attrs = re.sub(r'\s+t="[^"]*"', "", m.group(1))
    if text is not None:
        new = f'<c r="{ref}"{attrs} t="inlineStr"><is><t>{text}</t></is></c>'
    else:
        new = f'<c r="{ref}"{attrs}><v>{num}</v></c>'
    return xml[:m.start()] + new + xml[m.end():]


def periodo_texto(desde: date, hasta: date) -> str:
    return f"Desde {desde:%d/%m/%Y} hasta {hasta:%d/%m/%Y}"


def edit_sheet_xml(xml, numero, desde, hasta, entrega):
    xml = _set_cell(xml, "B11", num=numero)
    xml = _set_cell(xml, "E11", text=periodo_texto(desde, hasta))
    for r in FECHAS_INICIO:
        xml = _set_cell(xml, r, num=serial(desde))
    for r in FECHAS_FIN:
        xml = _set_cell(xml, r, num=serial(hasta))
    return _set_cell(xml, "H71", num=serial(entrega))


def build_bitacora(template, out, numero, desde, hasta, entrega):
    with zipfile.ZipFile(template) as zin, zipfile.ZipFile(out, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == SHEET:
                data = edit_sheet_xml(data.decode("utf-8"), numero, desde, hasta, entrega).encode("utf-8")
            zout.writestr(info, data, compress_type=info.compress_type)


def verify_bitacora(template, out, numero, desde, hasta, entrega):
    """Lanza AssertionError si algo difiere de lo esperado."""
    with zipfile.ZipFile(template) as a, zipfile.ZipFile(out) as b:
        assert b.testzip() is None, "ZIP corrupto"
        assert a.namelist() == b.namelist(), "Cambió la lista de archivos del ZIP"
        for n in a.namelist():
            if n != SHEET:
                assert a.read(n) == b.read(n), f"Se alteró {n}"
        assert b"x14:dataValidation" in b.read(SHEET), "Se perdió la lista desplegable"
    import openpyxl
    warnings.simplefilter("ignore")
    ws = openpyxl.load_workbook(out)["Formato Bitácora Individual"]
    assert int(ws["B11"].value) == numero, "B11"
    assert ws["E11"].value == periodo_texto(desde, hasta), "E11"
    for r in FECHAS_INICIO:
        assert ws[r].value.date() == desde, r
    for r in FECHAS_FIN:
        assert ws[r].value.date() == hasta, r
    assert ws["H71"].value.date() == entrega, "H71"
