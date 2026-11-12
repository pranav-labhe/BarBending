"""Safe deterministic spreadsheet formula resolver & arithmetic evaluator.

Translates symbolic row/constant tokens (@SELF:D, @PREV:D, @ID:<id>:K, $S$2..$Y$4)
into exact Excel A1 formulas AND evaluates unrounded floating-point values for UI
calculation parity. Never uses Python eval().
"""

from __future__ import annotations

import math
import re
from typing import Optional

from app.models import BbsRow, CalcSettings

GLOBAL_CONST_CELLS: dict[str, tuple[str, str]] = {
    "$S$2": ("footing_cover_mm", "Footing Cover"),
    "$U$2": ("column_cover_mm", "Col Cover"),
    "$W$2": ("column_height_mm", "Col Height"),
    "$Y$2": ("ld_vertical_mm", "Vert. Ld"),
    "$P$3": ("sw_dowel_mm", "SW Dowel"),
    "$S$3": ("hook_mult", "Hook Mult"),
    "$U$3": ("hook_min_mm", "Min Hook"),
    "$W$3": ("unit_wt_divisor", "Unit Wt Div"),
    "$Y$3": ("scale_divisor", "Kg/MT Scale"),
    "$O$4": ("sw_inner_offset_mm", "SW Inner Off"),
    "$S$4": ("shear_wall_ht_cf1_mm", "CF1 SW Ht"),
    "$U$4": ("shear_wall_ht_cf2_mm", "CF2 SW Ht"),
    "$W$4": ("tie_step_div_ge16", "Tie Div (>=16)"),
    "$Y$4": ("tie_step_div_lt16", "Tie Div (<16)"),
}

_ROW_COL_ATTR: dict[str, str] = {
    "D": "span_mm",
    "E": "dia_mm",
    "J": "spacing_mm",
    "K": "nos",
    "L": "multiple_no",
    "M": "total_nos",
    "N": "cut_length_mm",
    "Z": "param_z",
    "AA": "param_aa",
    "AB": "param_ab",
    "AC": "param_ac",
    "AD": "param_ad",
}

_TOKEN_RE = re.compile(
    r"\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/(),]))"
)
_SYM_TOKEN_RE = re.compile(
    r"@(SELF|PREV):([A-Z]{1,2})|@ID:([A-Za-z0-9_]+):([A-Z]{1,2})|(\$[A-Z]+\$\d+)"
)


def _format_calc_arg(val: float) -> str:
    """Pass full lossless floating-point representation into formula evaluator."""
    if val == 0:
        return "0"
    if abs(val - round(val)) < 1e-12:
        return str(int(round(val)))
    return repr(float(val))


def format_exact(val: float) -> str:
    """Format floating-point value cleanly without artificial rounding of real decimals."""
    if val == 0:
        return "0"
    if abs(val - round(val)) < 1e-11:
        return str(int(round(val)))
    s = f"{val:.12g}"
    return "0" if s == "-0" else s


def _get_row_col_val(row: BbsRow, col: str) -> float:
    attr = _ROW_COL_ATTR.get(col)
    if not attr:
        return 0.0
    v = getattr(row, attr, 0.0)
    return 0.0 if v is None else float(v)


def _ceil_clean(val: float) -> float:
    nearest = round(val)
    if abs(val - nearest) < 1e-11:
        return float(nearest)
    return float(math.ceil(val))


def _eval_arithmetic(expr: str) -> float:
    """Safely parse and evaluate spreadsheet math expression without eval()."""
    s = expr.lstrip()
    if s.startswith("="):
        s = s[1:]
    if s.startswith("+"):
        s = s[1:]

    tokens: list[tuple[str, str]] = []
    pos = 0
    n = len(s)
    while pos < n:
        if s[pos].isspace():
            pos += 1
            continue
        m = _TOKEN_RE.match(s, pos)
        if not m:
            raise ValueError(f"Unsupported token near {s[pos:]!r} in {expr!r}")
        num_t, id_t, op_t = m.groups()
        if num_t is not None:
            tokens.append(("NUM", num_t))
        elif id_t is not None:
            tokens.append(("IDENT", id_t.upper()))
        else:
            tokens.append(("OP", op_t))
        pos = m.end()

    idx = 0

    def peek() -> Optional[tuple[str, str]]:
        return tokens[idx] if idx < len(tokens) else None

    def consume() -> tuple[str, str]:
        nonlocal idx
        tok = tokens[idx]
        idx += 1
        return tok

    def parse_expr() -> float:
        val = parse_term()
        while (tok := peek()) is not None and tok[0] == "OP" and tok[1] in ("+", "-"):
            op = consume()[1]
            rhs = parse_term()
            val = val + rhs if op == "+" else val - rhs
        return val

    def parse_term() -> float:
        val = parse_factor()
        while (tok := peek()) is not None and tok[0] == "OP" and tok[1] in ("*", "/"):
            op = consume()[1]
            rhs = parse_factor()
            if op == "/":
                if rhs == 0:
                    raise ZeroDivisionError(f"Division by zero in {expr!r}")
                val /= rhs
            else:
                val *= rhs
        return val

    def parse_factor() -> float:
        tok = peek()
        if tok is None:
            raise ValueError(f"Unexpected end of expression in {expr!r}")
        if tok[0] == "OP" and tok[1] == "+":
            consume()
            return parse_factor()
        if tok[0] == "OP" and tok[1] == "-":
            consume()
            return -parse_factor()
        if tok[0] == "OP" and tok[1] == "(":
            consume()
            val = parse_expr()
            if peek() != ("OP", ")"):
                raise ValueError(f"Unmatched '(' in {expr!r}")
            consume()
            return val
        if tok[0] == "NUM":
            consume()
            return float(tok[1])
        if tok[0] == "IDENT":
            fn = consume()[1]
            if peek() != ("OP", "("):
                raise ValueError(f"Unexpected identifier {fn} in {expr!r}")
            consume()
            args: list[float] = []
            if peek() != ("OP", ")"):
                args.append(parse_expr())
                while peek() == ("OP", ","):
                    consume()
                    args.append(parse_expr())
            if peek() != ("OP", ")"):
                raise ValueError(f"Expected ')' in {expr!r}")
            consume()
            if fn == "MAX":
                return max(args)
            if fn == "MIN":
                return min(args)
            if fn == "ROUNDUP":
                if not args:
                    return 0.0
                digits = int(args[1]) if len(args) > 1 else 0
                if digits == 0:
                    return _ceil_clean(args[0])
                factor = 10.0**digits
                return _ceil_clean(args[0] * factor) / factor
            raise ValueError(f"Unsupported function {fn} in {expr!r}")
        raise ValueError(f"Unexpected token {tok} in {expr!r}")

    out = parse_expr()
    if idx != len(tokens):
        raise ValueError(f"Trailing tokens in {expr!r}: {tokens[idx:]}")
    return out


def resolve_row_formula(
    expr: Optional[str],
    row_idx: int,
    rows: list[BbsRow],
    settings: CalcSettings,
    first_tie_excel_row: Optional[int] = None,
    excel_start_row: int = 8,
) -> tuple[Optional[str], Optional[str], Optional[float]]:
    """Resolve symbolic expression into (excel_formula, substituted_math_str, value)."""
    if not expr or not expr.startswith("="):
        return None, None, None

    cur_excel = excel_start_row + row_idx
    id_to_idx = {r.id: i for i, r in enumerate(rows)}
    missing_dep = False

    # Backwards-compat normalization for any legacy symbolic placeholders
    normalized = expr
    normalized = normalized.replace("SELF_SPAN", "@SELF:D")
    normalized = normalized.replace("PREV_SPAN", "@PREV:D")
    normalized = normalized.replace("PREV_CUT", "@PREV:N")
    normalized = normalized.replace("PREV_TIE", "@PREV:D")
    if "FIRST_TIE_NOS" in normalized:
        ft_row = (
            first_tie_excel_row if first_tie_excel_row is not None else cur_excel - 1
        )
        ft_idx = ft_row - excel_start_row
        if 0 <= ft_idx < len(rows):
            normalized = normalized.replace("FIRST_TIE_NOS", f"@ID:{rows[ft_idx].id}:K")
        else:
            missing_dep = True

    if missing_dep:
        return None, None, None

    def to_excel(m: re.Match[str]) -> str:
        nonlocal missing_dep
        rel, col, ref_id, id_col, gconst = m.groups()
        if gconst:
            return gconst
        if rel == "SELF":
            return f"{col}{cur_excel}"
        if rel == "PREV":
            if cur_excel - 1 < excel_start_row:
                missing_dep = True
                return "0"
            return f"{col}{cur_excel - 1}"
        if ref_id is not None:
            t_idx = id_to_idx.get(ref_id)
            if t_idx is None:
                missing_dep = True
                return "0"
            return f"{id_col}{excel_start_row + t_idx}"
        return m.group(0)

    def to_numeric(m: re.Match[str], fmt_fn) -> str:
        nonlocal missing_dep
        rel, col, ref_id, id_col, gconst = m.groups()
        if gconst:
            meta = GLOBAL_CONST_CELLS.get(gconst)
            if not meta:
                missing_dep = True
                return "0"
            return fmt_fn(float(getattr(settings, meta[0])))
        if rel == "SELF":
            return fmt_fn(_get_row_col_val(rows[row_idx], col))
        if rel == "PREV":
            if row_idx - 1 < 0:
                missing_dep = True
                return "0"
            return fmt_fn(_get_row_col_val(rows[row_idx - 1], col))
        if ref_id is not None:
            t_idx = id_to_idx.get(ref_id)
            if t_idx is None:
                missing_dep = True
                return "0"
            return fmt_fn(_get_row_col_val(rows[t_idx], id_col))
        return m.group(0)

    excel_formula = _SYM_TOKEN_RE.sub(to_excel, normalized)
    eval_expr = _SYM_TOKEN_RE.sub(lambda m: to_numeric(m, _format_calc_arg), normalized)
    display_expr = _SYM_TOKEN_RE.sub(lambda m: to_numeric(m, format_exact), normalized)
    if missing_dep:
        return None, None, None

    try:
        val = _eval_arithmetic(eval_expr)
    except (ValueError, ZeroDivisionError):
        return excel_formula, display_expr.lstrip("="), None

    return excel_formula, display_expr.lstrip("="), float(val)
