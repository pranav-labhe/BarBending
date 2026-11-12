"""Pure OpenXML DrawingML generator for native Excel vector rebar shapes in columns F:I."""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
import zipfile
from typing import Iterable

from app.models import ShapeSpec

XDR_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

DRAWING_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"
DRAWING_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.drawing+xml"

# Approximate EMU column offsets for F..I (cols 5..8)
COL_WIDTH_EMU = 660_000
LINE_RGB = "1F4E79"


class _IdGen:
    def __init__(self, start: int = 1) -> None:
        self._id = start

    def next(self) -> int:
        val = self._id
        self._id += 1
        return val


def _line_cxn(
    id_gen: _IdGen,
    name: str,
    x: int,
    y: int,
    cx: int,
    cy: int,
    flip_h: bool = False,
    flip_v: bool = False,
    width_emu: int = 25400,
) -> ET.Element:
    cxn = ET.Element(f"{{{XDR_NS}}}cxnSp", {"macro": ""})
    nv = ET.SubElement(cxn, f"{{{XDR_NS}}}nvCxnSpPr")
    ET.SubElement(nv, f"{{{XDR_NS}}}cNvPr", {"id": str(id_gen.next()), "name": name})
    ET.SubElement(nv, f"{{{XDR_NS}}}cNvCxnSpPr")

    sp_pr = ET.SubElement(cxn, f"{{{XDR_NS}}}spPr")
    xfrm_attr = {}
    if flip_h:
        xfrm_attr["flipH"] = "1"
    if flip_v:
        xfrm_attr["flipV"] = "1"
    xfrm = ET.SubElement(sp_pr, f"{{{A_NS}}}xfrm", xfrm_attr)
    ET.SubElement(xfrm, f"{{{A_NS}}}off", {"x": str(x), "y": str(y)})
    ET.SubElement(xfrm, f"{{{A_NS}}}ext", {"cx": str(max(0, cx)), "cy": str(max(0, cy))})

    geom = ET.SubElement(sp_pr, f"{{{A_NS}}}prstGeom", {"prst": "line"})
    ET.SubElement(geom, f"{{{A_NS}}}avLst")
    ln = ET.SubElement(sp_pr, f"{{{A_NS}}}ln", {"w": str(width_emu)})
    sf = ET.SubElement(ln, f"{{{A_NS}}}solidFill")
    ET.SubElement(sf, f"{{{A_NS}}}srgbClr", {"val": LINE_RGB})
    return cxn


def _prst_shape(
    id_gen: _IdGen,
    name: str,
    prst: str,
    x: int,
    y: int,
    cx: int,
    cy: int,
    width_emu: int = 25400,
    rot: int | None = None,
) -> ET.Element:
    sp = ET.Element(f"{{{XDR_NS}}}sp", {"macro": "", "textlink": ""})
    nv = ET.SubElement(sp, f"{{{XDR_NS}}}nvSpPr")
    ET.SubElement(nv, f"{{{XDR_NS}}}cNvPr", {"id": str(id_gen.next()), "name": name})
    ET.SubElement(nv, f"{{{XDR_NS}}}cNvSpPr")

    sp_pr = ET.SubElement(sp, f"{{{XDR_NS}}}spPr")
    xfrm_attr = {"rot": str(rot)} if rot is not None else {}
    xfrm = ET.SubElement(sp_pr, f"{{{A_NS}}}xfrm", xfrm_attr)
    ET.SubElement(xfrm, f"{{{A_NS}}}off", {"x": str(x), "y": str(y)})
    ET.SubElement(xfrm, f"{{{A_NS}}}ext", {"cx": str(max(1, cx)), "cy": str(max(1, cy))})

    geom = ET.SubElement(sp_pr, f"{{{A_NS}}}prstGeom", {"prst": prst})
    ET.SubElement(geom, f"{{{A_NS}}}avLst")
    ET.SubElement(sp_pr, f"{{{A_NS}}}noFill")
    ln = ET.SubElement(sp_pr, f"{{{A_NS}}}ln", {"w": str(width_emu)})
    sf = ET.SubElement(ln, f"{{{A_NS}}}solidFill")
    ET.SubElement(sf, f"{{{A_NS}}}srgbClr", {"val": LINE_RGB})
    return sp


def _textbox_anchor(
    id_gen: _IdGen,
    row0: int,
    col_from: int,
    col_from_off: int,
    row_from_off: int,
    col_to: int,
    col_to_off: int,
    row_to_off: int,
    text: str,
    font_sz: int = 950,
) -> ET.Element:
    anc = ET.Element(f"{{{XDR_NS}}}twoCellAnchor")
    fr = ET.SubElement(anc, f"{{{XDR_NS}}}from")
    ET.SubElement(fr, f"{{{XDR_NS}}}col").text = str(col_from)
    ET.SubElement(fr, f"{{{XDR_NS}}}colOff").text = str(col_from_off)
    ET.SubElement(fr, f"{{{XDR_NS}}}row").text = str(row0)
    ET.SubElement(fr, f"{{{XDR_NS}}}rowOff").text = str(row_from_off)

    to = ET.SubElement(anc, f"{{{XDR_NS}}}to")
    ET.SubElement(to, f"{{{XDR_NS}}}col").text = str(col_to)
    ET.SubElement(to, f"{{{XDR_NS}}}colOff").text = str(col_to_off)
    ET.SubElement(to, f"{{{XDR_NS}}}row").text = str(row0)
    ET.SubElement(to, f"{{{XDR_NS}}}rowOff").text = str(row_to_off)

    sp = ET.SubElement(anc, f"{{{XDR_NS}}}sp", {"macro": "", "textlink": ""})
    nv = ET.SubElement(sp, f"{{{XDR_NS}}}nvSpPr")
    nid = id_gen.next()
    ET.SubElement(nv, f"{{{XDR_NS}}}cNvPr", {"id": str(nid), "name": f"Label_{nid}"})
    ET.SubElement(nv, f"{{{XDR_NS}}}cNvSpPr", {"txBox": "1"})

    sp_pr = ET.SubElement(sp, f"{{{XDR_NS}}}spPr")
    xfrm = ET.SubElement(sp_pr, f"{{{A_NS}}}xfrm")
    ET.SubElement(xfrm, f"{{{A_NS}}}off", {"x": "0", "y": "0"})
    ET.SubElement(xfrm, f"{{{A_NS}}}ext", {"cx": "450000", "cy": "180000"})
    geom = ET.SubElement(sp_pr, f"{{{A_NS}}}prstGeom", {"prst": "rect"})
    ET.SubElement(geom, f"{{{A_NS}}}avLst")
    ET.SubElement(sp_pr, f"{{{A_NS}}}noFill")
    ln = ET.SubElement(sp_pr, f"{{{A_NS}}}ln", {"w": "9525"})
    ET.SubElement(ln, f"{{{A_NS}}}noFill")

    tx = ET.SubElement(sp, f"{{{XDR_NS}}}txBody")
    ET.SubElement(
        tx,
        f"{{{A_NS}}}bodyPr",
        {"vertOverflow": "clip", "horzOverflow": "clip", "wrap": "none", "rtlCol": "0", "anchor": "ctr"},
    )
    ET.SubElement(tx, f"{{{A_NS}}}lstStyle")
    p = ET.SubElement(tx, f"{{{A_NS}}}p")
    ET.SubElement(p, f"{{{A_NS}}}pPr", {"algn": "ctr"})
    r = ET.SubElement(p, f"{{{A_NS}}}r")
    rpr = ET.SubElement(r, f"{{{A_NS}}}rPr", {"lang": "en-IN", "sz": str(font_sz), "b": "1"})
    sf = ET.SubElement(rpr, f"{{{A_NS}}}solidFill")
    ET.SubElement(sf, f"{{{A_NS}}}srgbClr", {"val": "111827"})
    t = ET.SubElement(r, f"{{{A_NS}}}t")
    t.text = text

    ET.SubElement(anc, f"{{{XDR_NS}}}clientData")
    return anc


def _group_anchor(
    id_gen: _IdGen,
    row0: int,
    col_from: int,
    col_from_off: int,
    row_from_off: int,
    col_to: int,
    col_to_off: int,
    row_to_off: int,
    ch_w: int,
    ch_h: int,
    children: list[ET.Element],
) -> ET.Element:
    anc = ET.Element(f"{{{XDR_NS}}}twoCellAnchor")
    fr = ET.SubElement(anc, f"{{{XDR_NS}}}from")
    ET.SubElement(fr, f"{{{XDR_NS}}}col").text = str(col_from)
    ET.SubElement(fr, f"{{{XDR_NS}}}colOff").text = str(col_from_off)
    ET.SubElement(fr, f"{{{XDR_NS}}}row").text = str(row0)
    ET.SubElement(fr, f"{{{XDR_NS}}}rowOff").text = str(row_from_off)

    to = ET.SubElement(anc, f"{{{XDR_NS}}}to")
    ET.SubElement(to, f"{{{XDR_NS}}}col").text = str(col_to)
    ET.SubElement(to, f"{{{XDR_NS}}}colOff").text = str(col_to_off)
    ET.SubElement(to, f"{{{XDR_NS}}}row").text = str(row0)
    ET.SubElement(to, f"{{{XDR_NS}}}rowOff").text = str(row_to_off)

    grp = ET.SubElement(anc, f"{{{XDR_NS}}}grpSp")
    nv = ET.SubElement(grp, f"{{{XDR_NS}}}nvGrpSpPr")
    gid = id_gen.next()
    ET.SubElement(nv, f"{{{XDR_NS}}}cNvPr", {"id": str(gid), "name": f"ShapeGroup_{gid}"})
    ET.SubElement(nv, f"{{{XDR_NS}}}cNvGrpSpPr")

    gsp = ET.SubElement(grp, f"{{{XDR_NS}}}grpSpPr")
    xfrm = ET.SubElement(gsp, f"{{{A_NS}}}xfrm")
    ET.SubElement(xfrm, f"{{{A_NS}}}off", {"x": "0", "y": "0"})
    ET.SubElement(xfrm, f"{{{A_NS}}}ext", {"cx": str(ch_w), "cy": str(ch_h)})
    ET.SubElement(xfrm, f"{{{A_NS}}}chOff", {"x": "0", "y": "0"})
    ET.SubElement(xfrm, f"{{{A_NS}}}chExt", {"cx": str(ch_w), "cy": str(ch_h)})

    for ch in children:
        grp.append(ch)

    ET.SubElement(anc, f"{{{XDR_NS}}}clientData")
    return anc


def _build_shape_anchors(id_gen: _IdGen, excel_row: int, spec: ShapeSpec) -> list[ET.Element]:
    """Build native DrawingML shape + dimension callout anchors for one spreadsheet row."""
    row0 = excel_row - 1
    anchors: list[ET.Element] = []
    kind = spec.kind
    labels = spec.labels

    if kind == "u_bar":
        w, h = 1_500_000, 320_000
        lines = [
            _line_cxn(id_gen, "U_Left", 0, 0, 0, h),
            _line_cxn(id_gen, "U_Bot", 0, h, w, 0),
            _line_cxn(id_gen, "U_Right", w, 0, 0, h),
        ]
        anchors.append(_group_anchor(id_gen, row0, 5, 160_000, 120_000, 8, 260_000, 440_000, w, h, lines))
        if labels.get("span"):
            anchors.append(_textbox_anchor(id_gen, row0, 6, 120_000, 180_000, 7, 360_000, 420_000, labels["span"]))
        if labels.get("leg"):
            anchors.append(_textbox_anchor(id_gen, row0, 8, 120_000, 80_000, 8, 560_000, 320_000, labels["leg"]))

    elif kind == "straight":
        w, h = 1_550_000, 20_000
        lines = [_line_cxn(id_gen, "Straight_Bar", 0, 10_000, w, 0)]
        anchors.append(_group_anchor(id_gen, row0, 5, 160_000, 260_000, 8, 280_000, 280_000, w, h, lines))
        if labels.get("text"):
            anchors.append(_textbox_anchor(id_gen, row0, 5, 360_000, 50_000, 8, 160_000, 250_000, labels["text"], font_sz=900))

    elif kind == "l_bar":
        w, h = 280_000, 340_000
        lines = [
            _line_cxn(id_gen, "L_Vert", w, 0, 0, h),
            _line_cxn(id_gen, "L_Hook", 0, h, w, 0),
        ]
        anchors.append(_group_anchor(id_gen, row0, 6, 260_000, 60_000, 7, 40_000, 400_000, w, h, lines))
        if labels.get("height"):
            anchors.append(_textbox_anchor(id_gen, row0, 7, 50_000, 80_000, 8, 150_000, 300_000, labels["height"]))
        if labels.get("ld"):
            anchors.append(_textbox_anchor(id_gen, row0, 6, 40_000, 340_000, 7, 40_000, 540_000, labels["ld"]))

    elif kind == "stirrup_rect":
        w, h = 880_000, 450_000
        shapes = [
            _prst_shape(id_gen, "Tie_Body", "roundRect", 60_000, 60_000, w - 120_000, h - 120_000),
            _line_cxn(id_gen, "Tie_Hook1", 60_000, 60_000, 120_000, 110_000),
            _line_cxn(id_gen, "Tie_Hook2", 95_000, 40_000, 120_000, 110_000),
        ]
        anchors.append(_group_anchor(id_gen, row0, 5, 340_000, 140_000, 7, 360_000, 620_000, w, h, shapes))
        if labels.get("a"):
            anchors.append(_textbox_anchor(id_gen, row0, 6, 80_000, 560_000, 7, 200_000, 780_000, labels["a"]))
        if labels.get("b"):
            anchors.append(_textbox_anchor(id_gen, row0, 7, 350_000, 260_000, 8, 180_000, 480_000, labels["b"]))
        if labels.get("hook"):
            anchors.append(_textbox_anchor(id_gen, row0, 5, 160_000, 40_000, 6, 120_000, 240_000, labels["hook"], font_sz=850))

    elif kind == "center_link":
        w, h = 240_000, 500_000
        shapes = [
            _line_cxn(id_gen, "Center_Stem", 120_000, 40_000, 0, h - 80_000),
            _prst_shape(id_gen, "Center_ArcTop", "arc", 40_000, 0, 80_000, 80_000),
            _prst_shape(id_gen, "Center_ArcBot", "arc", 120_000, h - 80_000, 80_000, 80_000),
        ]
        anchors.append(_group_anchor(id_gen, row0, 6, 220_000, 150_000, 6, 460_000, 680_000, w, h, shapes))
        if labels.get("a"):
            anchors.append(_textbox_anchor(id_gen, row0, 6, 460_000, 280_000, 7, 280_000, 500_000, labels["a"]))
        if labels.get("hook"):
            anchors.append(_textbox_anchor(id_gen, row0, 5, 360_000, 80_000, 6, 220_000, 260_000, labels["hook"], font_sz=850))

    elif kind == "combined_loop":
        w, h = 1_560_000, 380_000
        hook_w = 240_000
        lines = [
            _line_cxn(id_gen, "CF_Bot", 0, h, w, 0),
            _line_cxn(id_gen, "CF_Left", 0, 0, 0, h),
            _line_cxn(id_gen, "CF_Right", w, 0, 0, h),
            _line_cxn(id_gen, "CF_TopL", 0, 0, hook_w, 0),
            _line_cxn(id_gen, "CF_TopR", w - hook_w, 0, hook_w, 0),
            _line_cxn(id_gen, "CF_Mid", 0, 40_000, w, 0),
        ]
        anchors.append(_group_anchor(id_gen, row0, 5, 160_000, 160_000, 8, 280_000, 560_000, w, h, lines))
        if labels.get("span"):
            anchors.append(_textbox_anchor(id_gen, row0, 6, 100_000, 260_000, 7, 360_000, 500_000, labels["span"]))
        if labels.get("leg"):
            anchors.append(_textbox_anchor(id_gen, row0, 8, 160_000, 160_000, 8, 560_000, 420_000, labels["leg"]))

    elif kind == "chair":
        w, h = 1_400_000, 340_000
        lines = [
            _line_cxn(id_gen, "Chair_FootL", 0, h, 300_000, 0),
            _line_cxn(id_gen, "Chair_LegL", 300_000, 0, 0, h),
            _line_cxn(id_gen, "Chair_Top", 300_000, 0, 800_000, 0),
            _line_cxn(id_gen, "Chair_LegR", 1_100_000, 0, 0, h),
            _line_cxn(id_gen, "Chair_FootR", 1_100_000, h, 300_000, 0),
        ]
        anchors.append(_group_anchor(id_gen, row0, 5, 220_000, 220_000, 8, 180_000, 580_000, w, h, lines))

    return anchors


def inject_drawingml_shapes(
    xlsx_bytes: bytes,
    row_shapes: Iterable[tuple[int, ShapeSpec]],
    cached_values: dict[str, tuple[float | str, bool]] | None = None,
) -> bytes:
    """Inject xl/drawings/drawing1.xml shapes and cached <v> formula values into workbook XML."""
    ET.register_namespace("xdr", XDR_NS)
    ET.register_namespace("a", A_NS)
    ET.register_namespace("r", R_NS)

    ws_dr = ET.Element(f"{{{XDR_NS}}}wsDr")
    id_gen = _IdGen(1)
    for excel_row, spec in row_shapes:
        for anc in _build_shape_anchors(id_gen, excel_row, spec):
            ws_dr.append(anc)

    drawing_xml = ET.tostring(ws_dr, encoding="utf-8", xml_declaration=True)

    in_buf = io.BytesIO(xlsx_bytes)
    out_buf = io.BytesIO()

    with zipfile.ZipFile(in_buf, "r") as zin, zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as zout:
        existing_names = set(zin.namelist())
        rel_id = "rIdDrawing1"

        for name in zin.namelist():
            data = zin.read(name)

            if name == "[Content_Types].xml":
                ET.register_namespace("", CT_NS)
                ct_root = ET.fromstring(data)
                has_draw = any(
                    el.attrib.get("PartName") == "/xl/drawings/drawing1.xml"
                    for el in ct_root.findall(f"{{{CT_NS}}}Override")
                )
                if not has_draw:
                    ET.SubElement(
                        ct_root,
                        f"{{{CT_NS}}}Override",
                        {"PartName": "/xl/drawings/drawing1.xml", "ContentType": DRAWING_CONTENT_TYPE},
                    )
                data = ET.tostring(ct_root, encoding="utf-8", xml_declaration=True)

            elif name == "xl/worksheets/sheet1.xml":
                ET.register_namespace("", MAIN_NS)
                ET.register_namespace("r", R_NS)
                s_root = ET.fromstring(data)
                if cached_values:
                    for c_el in s_root.findall(f".//{{{MAIN_NS}}}c"):
                        ref = c_el.attrib.get("r")
                        if ref not in cached_values:
                            continue
                        val, is_str = cached_values[ref]
                        if is_str:
                            c_el.attrib["t"] = "str"
                        elif "t" in c_el.attrib and c_el.attrib["t"] != "n":
                            del c_el.attrib["t"]
                        v_el = c_el.find(f"{{{MAIN_NS}}}v")
                        if v_el is None:
                            v_el = ET.SubElement(c_el, f"{{{MAIN_NS}}}v")
                        if is_str:
                            v_el.text = str(val)
                        else:
                            fval = float(val)
                            if fval == 0:
                                v_el.text = "0"
                            elif abs(fval - round(fval)) < 1e-12:
                                v_el.text = str(int(round(fval)))
                            else:
                                v_el.text = repr(fval)
                if s_root.find(f"{{{MAIN_NS}}}drawing") is None:
                    dr_el = ET.Element(f"{{{MAIN_NS}}}drawing", {f"{{{R_NS}}}id": rel_id})
                    # Insert after pageSetup/headerFooter/pageMargins, before extLst/legacyDrawing
                    insert_idx = len(list(s_root))
                    for idx, child in enumerate(list(s_root)):
                        tag_local = child.tag.split("}")[-1]
                        if tag_local in ("legacyDrawing", "legacyDrawingHF", "picture", "extLst"):
                            insert_idx = idx
                            break
                    s_root.insert(insert_idx, dr_el)
                data = ET.tostring(s_root, encoding="utf-8", xml_declaration=True)

            elif name == "xl/worksheets/_rels/sheet1.xml.rels":
                ET.register_namespace("", REL_NS)
                r_root = ET.fromstring(data)
                if not any(el.attrib.get("Id") == rel_id for el in r_root):
                    ET.SubElement(
                        r_root,
                        f"{{{REL_NS}}}Relationship",
                        {"Id": rel_id, "Type": DRAWING_REL_TYPE, "Target": "../drawings/drawing1.xml"},
                    )
                data = ET.tostring(r_root, encoding="utf-8", xml_declaration=True)

            zout.writestr(name, data)

        if "xl/worksheets/_rels/sheet1.xml.rels" not in existing_names:
            ET.register_namespace("", REL_NS)
            r_root = ET.Element(f"{{{REL_NS}}}Relationships")
            ET.SubElement(
                r_root,
                f"{{{REL_NS}}}Relationship",
                {"Id": rel_id, "Type": DRAWING_REL_TYPE, "Target": "../drawings/drawing1.xml"},
            )
            zout.writestr(
                "xl/worksheets/_rels/sheet1.xml.rels",
                ET.tostring(r_root, encoding="utf-8", xml_declaration=True),
            )

        zout.writestr("xl/drawings/drawing1.xml", drawing_xml)

    return out_buf.getvalue()
