"""Data models for parsed CAD schedules, BBS calculation settings, and workbook rows."""

from typing import Literal, Optional
from pydantic import BaseModel, Field

DIAMETER_COLUMNS: tuple[int, ...] = (8, 10, 12, 16, 20, 25, 32, 36, 40)

ShapeKind = Literal[
    "u_bar",
    "straight",
    "l_bar",
    "stirrup_rect",
    "center_link",
    "combined_loop",
    "chair",
]


class ShapeSpec(BaseModel):
    """Vector rebar shape descriptor rendered in Excel columns F:I and UI previews."""

    kind: ShapeKind = "straight"
    labels: dict[str, str] = Field(default_factory=dict)


class ScheduleFootRow(BaseModel):
    """Structured footing/column schedule row extracted from the CAD PDF."""

    mark: str
    kind: Literal["box_footing", "shear_wall", "combined_footing"] = "box_footing"
    excavation_size: str = ""
    pcc_thk_mm: int = 125
    footing_b_mm: int = 0
    footing_l_mm: int = 0
    depth_mm: int = 650
    long_lower_nos: int = 0
    long_lower_dia: int = 12
    long_lower_spacing: Optional[int] = None
    long_lower_text: str = ""
    short_upper_nos: int = 0
    short_upper_dia: int = 12
    short_upper_spacing: Optional[int] = None
    short_upper_text: str = ""
    side_bars_nos: int = 0
    side_bars_dia: int = 10
    col_b_mm: int = 0
    col_l_mm: int = 0
    vert_nos: int = 0
    vert_dia: int = 16
    vert_text: str = ""
    ties_dia: int = 8
    ties_spacing: int = 150
    ties_legs: int = 4
    remarks: str = ""
    box_count: int = 0
    total_col_count: int = 0
    combined_count: int = 0
    shaft_inner_b_mm: Optional[int] = None
    shaft_inner_l_mm: Optional[int] = None
    l_shape_segments: list[dict[str, float | str]] = Field(default_factory=list)


class BbsRow(BaseModel):
    """Single row of the generated Bar Bending Schedule sheet."""

    id: str
    sr_no: Optional[int] = None
    group_key: str = ""
    bar_mark: str
    description: str
    span_expr: Optional[str] = None
    span_mm: float = 0.0
    dia_mm: float = 12.0
    shape: ShapeSpec = Field(default_factory=ShapeSpec)
    spacing_mm: Optional[float] = None
    nos_expr: Optional[str] = None
    nos: float = 0.0
    multiple_expr: Optional[str] = None
    multiple_no: float = 1.0
    total_nos: float = 0.0
    cut_length_expr: Optional[str] = None
    cut_length_mm: float = 0.0
    coupler: float = 0.0
    weight_kg: float = 0.0
    param_z: Optional[float] = None
    param_aa: Optional[float] = None
    param_ab: Optional[float] = None
    param_ac: Optional[float] = None
    param_ad: Optional[float] = None
    param_ae: str = ""
    remark: str = ""
    inferred: bool = False
    source_note: str = ""


class CalcSettings(BaseModel):
    """Calculation rules and engineering constants controlling BBS generation."""

    mode: Literal["sample_compat", "strict_geometry"] = "sample_compat"
    round_up_nos: bool = False
    footing_cover_mm: float = 50.0
    column_cover_mm: float = 40.0
    column_height_mm: float = 4550.0
    ld_vertical_mm: float = 450.0
    hook_mult: float = 8.0
    hook_min_mm: float = 75.0
    unit_wt_divisor: float = 162.0
    scale_divisor: float = 1000.0
    shear_wall_ht_cf1_mm: float = 1650.0
    shear_wall_ht_cf2_mm: float = 3000.0
    sw_dowel_mm: float = 300.0
    sw_inner_offset_mm: float = 80.0
    compat_tie_ht_mm: float = 4500.0
    tie_step_div_ge16: float = 6.0
    tie_step_div_lt16: float = 5.0
    include_chairs_spacers: bool = True


class BbsDocument(BaseModel):
    """Complete parsed and calculated Bar Bending Schedule payload."""

    project_name: str = "PROJECT"
    drawing_no: str = "SH_FOOTING_01"
    location: str = ""
    date_str: str = ""
    structure: str = "G+9 (Footing Level 0 to 4550)"
    note_footer: str = (
        "NOTE :-Wastages, Lap length are not considered in BBS & hence quantity "
        "may increase by 5-10% at site. Further, sample of each cutting length "
        "to be strictly checked & verified at site before processing forward."
    )
    settings: CalcSettings = Field(default_factory=CalcSettings)
    schedule: list[ScheduleFootRow] = Field(default_factory=list)
    rows: list[BbsRow] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    parse_stats: dict[str, object] = Field(default_factory=dict)
    totals_by_dia_mt: dict[int, float] = Field(default_factory=dict)
    total_weight_mt: float = 0.0
