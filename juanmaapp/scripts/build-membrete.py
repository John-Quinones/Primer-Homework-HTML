#!/usr/bin/env python3
"""Builds the letterhead Word files of the App from John's template «Plantilla Membrete_Pie_Encab_Pagina».

  python3 scripts/build-membrete.py <plantilla.docx>

Writes public/membrete-base.docx (empty body: logo, QR, footer, page border, faded logo watermark, «Página X de Y»; used by
markdownToDocx) and refreshes the header/footer of public/recibo-base.docx (receipt) with the same letterhead, keeping its body.
Also writes public/membrete-assets.js (images for the PDF letterhead, see public/membrete.js).
"""
import base64, io, re, shutil, sys, zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
tpl = Path(sys.argv[1])
FONT = "Century Gothic"

z = zipfile.ZipFile(tpl)
parts = {n: z.read(n) for n in z.namelist()}

# Faded Tecjuridicos logo (16 % opacity), as the signature stamp already uses.
logo = Image.open(io.BytesIO(parts["word/media/image1.png"])).convert("RGBA")
wm = logo.resize((1040, round(1040 * logo.height / logo.width)), Image.LANCZOS)
wm.putalpha(wm.getchannel("A").point(lambda a: round(a * 0.16)))
buf = io.BytesIO(); wm.save(buf, "PNG", optimize=True); WM = buf.getvalue()
WM_CX = 4500000
WM_CY = round(WM_CX * wm.height / wm.width)

def anchor(rid):
    return (f'<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" '
            f'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
            f'<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>'
            f'<wp:positionV relativeFrom="page"><wp:align>center</wp:align></wp:positionV><wp:extent cx="{WM_CX}" cy="{WM_CY}"/>'
            f'<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="9101" name="Marca de agua Tecjuridicos"/><wp:cNvGraphicFramePr/>'
            f'<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9101" name="marca-de-agua.png"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{WM_CX}" cy="{WM_CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            f'</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>')

RPR = f'<w:rPr><w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}"/><w:color w:val="1F3864"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>'
def fld(code):
    return (f'<w:r>{RPR}<w:fldChar w:fldCharType="begin"/></w:r><w:r>{RPR}<w:instrText xml:space="preserve"> {code} </w:instrText></w:r>'
            f'<w:r>{RPR}<w:fldChar w:fldCharType="separate"/></w:r><w:r>{RPR}<w:t>1</w:t></w:r><w:r>{RPR}<w:fldChar w:fldCharType="end"/></w:r>')
PAGE_NO = (f'<w:p><w:pPr><w:pStyle w:val="Piedepgina"/><w:spacing w:before="60" w:after="0"/><w:jc w:val="right"/></w:pPr>'
           f'<w:r>{RPR}<w:t xml:space="preserve">Página </w:t></w:r>{fld("PAGE")}<w:r>{RPR}<w:t xml:space="preserve"> de </w:t></w:r>{fld("NUMPAGES")}</w:p>')

def letterhead(p):
    """p: dict of parts of a docx that has the template's header/footer files; adds the watermark and the page number."""
    for n in ("header1", "header2", "header3"):
        key = f"word/{n}.xml"; rels = f"word/_rels/{n}.xml.rels"
        x = p[key].decode("utf8")
        if "Marca de agua Tecjuridicos" in x: continue
        x = re.sub(r"(<w:hdr\b[^>]*>)", lambda m: m.group(1) + f'<w:p><w:pPr><w:pStyle w:val="Encabezado"/><w:spacing w:after="0"/></w:pPr>{anchor("rIdMarca")}</w:p>', x, 1)
        p[key] = x.encode("utf8")
        r = p.get(rels, b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>').decode("utf8")
        p[rels] = r.replace("</Relationships>", '<Relationship Id="rIdMarca" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/marca-de-agua.png"/></Relationships>').encode("utf8")
    for n in ("footer1", "footer2"):
        key = f"word/{n}.xml"; x = p[key].decode("utf8")
        if "NUMPAGES" in x: continue
        p[key] = x.replace("</w:ftr>", PAGE_NO + "</w:ftr>").encode("utf8")
    p["word/media/marca-de-agua.png"] = WM

def pack(p):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as o:
        o.writestr("[Content_Types].xml", p.pop("[Content_Types].xml"))
        for n, b in p.items(): o.writestr(n, b)
    return out.getvalue()

# ---- membrete-base.docx: the template with the letterhead and an empty body ----
base = dict(parts)
letterhead(base)
doc = base["word/document.xml"].decode("utf8")
base["word/document.xml"] = re.sub(r"(<w:body>).*?(<w:sectPr)", r"\1<!--BODY-->\2", doc, flags=re.S).encode("utf8")
st = base["word/styles.xml"].decode("utf8")
st = re.sub(r"<w:rPrDefault>.*?</w:rPrDefault>",
            f'<w:rPrDefault><w:rPr><w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:cs="{FONT}" w:eastAsia="{FONT}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="es-CO" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>', st, 1, flags=re.S)
for sid, sz in (("Ttulo1", 30), ("Ttulo2", 26), ("Ttulo3", 23)):
    st = re.sub(r'(<w:style [^>]*w:styleId="%s".*?<w:rPr>).*?(</w:rPr></w:style>)' % sid,
                lambda m: m.group(1) + f'<w:rFonts w:ascii="{FONT}" w:hAnsi="{FONT}" w:cs="{FONT}"/><w:b/><w:color w:val="1F3864"/><w:sz w:val="{sz}"/><w:szCs w:val="{sz}"/>' + m.group(2), st, 1, flags=re.S)
base["word/styles.xml"] = st.encode("utf8")
ct = base["[Content_Types].xml"].decode("utf8")
base["[Content_Types].xml"] = ct.encode("utf8")
(ROOT / "public/membrete-base.docx").write_bytes(pack(dict(base)))

# ---- recibo-base.docx: same letterhead, own body ----
rp = ROOT / "public/recibo-base.docx"
rz = zipfile.ZipFile(rp); rec = {n: rz.read(n) for n in rz.namelist()}
body = rec["word/document.xml"].decode("utf8")
rec = dict(parts) | {"word/document.xml": b"", "word/styles.xml": rec["word/styles.xml"], "word/numbering.xml": rec["word/numbering.xml"]}
letterhead(rec)
# header/footer references of the receipt's own document.xml keep working: same file names, same relationship ids as the template's
tdoc = parts["word/document.xml"].decode("utf8")
sect = re.search(r"<w:sectPr.*</w:sectPr>", tdoc, re.S).group(0)
rbody = re.sub(r"<w:sectPr.*</w:sectPr>", lambda m: sect, body, flags=re.S)
rec["word/document.xml"] = rbody.encode("utf8")
rec["word/_rels/document.xml.rels"] = parts["word/_rels/document.xml.rels"]
rp.write_bytes(pack(dict(rec)))

# ---- images for the PDF letterhead ----
def png_b64(img):
    b = io.BytesIO(); img.save(b, "PNG", optimize=True); return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()
logo_s = logo.resize((560, round(560 * logo.height / logo.width)), Image.LANCZOS)
qr = Image.open(io.BytesIO(parts["word/media/image2.png"])).convert("RGBA")
qr = qr.resize((315, 315), Image.NEAREST)
wm_s = logo.resize((780, round(780 * logo.height / logo.width)), Image.LANCZOS)
wm_s.putalpha(wm_s.getchannel("A").point(lambda a: round(a * 0.11)))  # the PDF draws it a little stronger than Word does
icons = {}
for n in ("pin", "tel", "web", "mail", "loc"):
    ic = Image.open(ROOT / f"scripts/membrete-iconos/{n}.png").convert("RGBA")
    bb = ic.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox(); ic = ic.crop(bb)
    ic.thumbnail((96, 96)); icons[n] = {"w": ic.width, "h": ic.height, "png": png_b64(ic)}
import json
js = (f"// Letterhead images of the PDF documents (version 2.2.3), taken from the template «Plantilla Membrete_Pie_Encab_Pagina». Built by scripts/build-membrete.py.\n"
      f"window.JuanmaMembreteAssets = {{ logo: {{ w: {logo_s.width}, h: {logo_s.height}, png: \"{png_b64(logo_s)}\" }}, qr: {{ png: \"{png_b64(qr)}\" }}, "
      f"wm: {{ w: {wm_s.width}, h: {wm_s.height}, png: \"{png_b64(wm_s)}\" }}, "
      f"icons: {json.dumps(icons)}, docx: \"{base64.b64encode((ROOT / 'public/membrete-base.docx').read_bytes()).decode()}\" }};\n")
(ROOT / "public/membrete-assets.js").write_text(js)
print("ok", len(WM), WM_CY)
