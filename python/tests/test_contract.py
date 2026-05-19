import json
import math
from pathlib import Path

import pytest

from standard_ranklist_utils import (
    EnumTheme,
    alphabet_to_number,
    convert_to_static_ranklist,
    format_time_duration,
    number_to_alphabet,
    pre_zero_fill,
    regenerate_ranklist_by_solutions,
    regenerate_rows_by_incremental_solutions,
    resolve_color,
    resolve_contributor,
    resolve_style,
    resolve_text,
    resolve_theme_color,
    resolve_user_markers,
    sec_to_time_str,
    sort_rows,
)
from standard_ranklist_utils.constants import MIN_REGEN_SUPPORTED_VERSION, SRK_SUPPORTED_VERSIONS

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "contract-fixtures.json").read_text(encoding="utf-8"))


def make_ranklist(**overrides):
    ranklist = {
        "type": "general",
        "version": "0.3.9",
        "contest": {
            "title": "Contest",
            "startAt": "2026-01-01T00:00:00+08:00",
            "duration": [5, "h"],
        },
        "problems": [{"alias": "A"}, {"alias": "B"}],
        "series": [{"title": "Rank", "rule": {"preset": "Normal"}}],
        "rows": [],
        "sorter": {
            "algorithm": "ICPC",
            "config": {},
        },
    }
    ranklist.update(overrides)
    return ranklist


def make_row(user_id, score=None, statuses=None, user=None):
    return {
        "user": {"id": user_id, "name": user_id, **(user or {})},
        "score": score if score is not None else {"value": 0, "time": [0, "ms"]},
        "statuses": statuses
        if statuses is not None
        else [{"result": None, "solutions": []}, {"result": None, "solutions": []}],
    }


def test_constants_and_enums_match_js_contract():
    assert MIN_REGEN_SUPPORTED_VERSION == FIXTURES["constants"]["minRegenSupportedVersion"]
    assert SRK_SUPPORTED_VERSIONS == FIXTURES["constants"]["srkSupportedVersions"]
    assert EnumTheme.light.value == FIXTURES["constants"]["enumTheme"]["light"]
    assert EnumTheme.dark.value == FIXTURES["constants"]["enumTheme"]["dark"]


def test_formatters_match_js_contract():
    expected = FIXTURES["formatters"]

    assert format_time_duration([1.5, "h"], "min") == expected["formatTimeDuration"]["hoursToMinutes"]
    assert format_time_duration([61, "s"], "min", math.ceil) == expected["formatTimeDuration"]["secondsToMinutesCeil"]
    assert (
        format_time_duration([2, "s"], "ms", lambda _: 0)
        == expected["formatTimeDuration"]["secondsToMillisecondsIgnoresFormatter"]
    )

    with pytest.raises(ValueError):
        format_time_duration([-1, "s"])
    with pytest.raises(ValueError):
        format_time_duration([math.inf, "s"])
    with pytest.raises(ValueError):
        format_time_duration([1, "week"])
    with pytest.raises(ValueError):
        format_time_duration([1, "s"], "week")

    assert pre_zero_fill(7, 3) == expected["preZeroFill"]["short"]
    assert pre_zero_fill(1234, 3) == expected["preZeroFill"]["long"]
    assert sec_to_time_str(3661, fill_hour=True) == expected["secToTimeStr"]["fillHour"]
    assert sec_to_time_str(90061, show_day=True) == expected["secToTimeStr"]["showDay"]
    assert sec_to_time_str(-1) == expected["secToTimeStr"]["negative"]
    assert number_to_alphabet(0) == expected["alphabet"]["zero"]
    assert number_to_alphabet(25) == expected["alphabet"]["z"]
    assert number_to_alphabet(26) == expected["alphabet"]["aa"]
    assert number_to_alphabet("28") == expected["alphabet"]["acFromString"]
    assert number_to_alphabet(701) == expected["alphabet"]["zz"]
    assert number_to_alphabet(702) == expected["alphabet"]["aaa"]
    assert alphabet_to_number("A") == expected["alphabet"]["numberA"]
    assert alphabet_to_number("AA") == expected["alphabet"]["numberAA"]
    assert alphabet_to_number("ac") == expected["alphabet"]["numberLowerAc"]
    assert alphabet_to_number("") == expected["alphabet"]["numberEmpty"]


def test_resolvers_match_js_contract():
    expected = FIXTURES["resolvers"]

    assert resolve_text(None) == expected["text"]["undefined"]
    assert resolve_text("plain") == expected["text"]["plain"]
    assert (
        resolve_text({"fallback": "Fallback", "en-US": "English", "zh-CN": "中文"}, ["zh-CN"])
        == expected["text"]["zhCN"]
    )
    assert (
        resolve_text({"fallback": "Fallback", "en-US": "English", "zh-CN": "中文"}, ["en-GB"])
        == expected["text"]["enGB"]
    )
    assert resolve_text({"fallback": "Fallback", "zh-CN": "中文"}, ["zh-Hans-CN"]) == expected["text"]["zhHansCN"]
    assert resolve_text({"fallback": "Fallback", "en-US": "English"}, ["fr-FR"]) == expected["text"]["fallback"]
    assert resolve_text({"fallback": "Fallback", "en-US": ""}, ["en-US"]) == expected["text"]["emptyMatch"]

    assert resolve_contributor(None) == expected["contributor"]["missing"]
    assert resolve_contributor("Alice") == expected["contributor"]["nameOnly"]
    assert resolve_contributor("Bob <bob@example.com>") == expected["contributor"]["nameEmail"]
    assert resolve_contributor("bLue <mail@example.com> (https://example.com/)") == expected["contributor"]["full"]
    assert resolve_contributor("John Smith (https://example.com/)") == expected["contributor"]["nameUrl"]

    assert resolve_color("#123456") == expected["color"]["string"]
    assert resolve_color("") is None
    assert resolve_color([1, 2, 3, 0.5]) == expected["color"]["rgbaTuple"]
    assert resolve_theme_color("#abcdef") == expected["themeColor"]["single"]
    assert resolve_theme_color({"light": "#ffffff", "dark": "#000000"}) == expected["themeColor"]["pair"]
    assert resolve_style({"textColor": "#111111", "backgroundColor": "#eeeeee"}) == expected["style"]["explicit"]
    assert resolve_style({"backgroundColor": {"light": "#ffffff", "dark": "#000000"}}) == expected["style"]["auto"]
    assert resolve_style({"backgroundColor": "#00c000"}) == expected["style"]["autoGreen"]
    assert resolve_style({"backgroundColor": "#0c0"}) == expected["style"]["autoShortHex"]

    markers = [
        {"id": "official", "label": "Official", "style": "blue"},
        {"id": "girls", "label": "Girls", "style": "pink"},
    ]
    assert (
        resolve_user_markers({"id": "u1", "name": "U1", "marker": "official", "markers": ["girls", "none"]}, markers)
        == expected["markers"]["modernPrecedence"]
    )
    assert (
        resolve_user_markers({"id": "u2", "name": "U2", "marker": "official", "markers": []}, markers)
        == expected["markers"]["emptyModern"]
    )
    assert (
        resolve_user_markers({"id": "u2", "name": "U2", "marker": "official"}, markers) == expected["markers"]["legacy"]
    )
    assert (
        resolve_user_markers({"id": "u3", "name": "U3", "markers": ["girls"]}, None)
        == expected["markers"]["missingConfig"]
    )


def test_ranklist_helpers_match_js_contract():
    expected = FIXTURES["ranklist"]

    sorted_rows = sort_rows(
        [
            make_row("slow", {"value": 1, "time": [30, "min"]}),
            make_row("fast", {"value": 1, "time": [20, "min"]}),
            make_row("solved-more", {"value": 2, "time": [90, "min"]}),
        ]
    )
    assert [row["user"]["id"] for row in sorted_rows] == expected["sortedRows"]


def test_ranklist_regeneration_matches_js_contract():
    expected = FIXTURES["ranklist"]
    original = make_ranklist(
        rows=[
            make_row("u1"),
            make_row("u2"),
            make_row("u3", {"value": 0, "time": [0, "ms"]}, user={"official": False}),
        ],
        problems=[{"alias": "A", "statistics": {"accepted": 0, "submitted": 0}}, {"alias": "B"}],
    )
    solutions = [
        ["u1", 0, "WA", [10, "min"]],
        ["u1", 0, "CE", [15, "min"]],
        ["u3", 0, "AC", [20, "min"]],
        ["u2", 0, "AC", [30, "min"]],
        ["u1", 0, "AC", [50, "min"]],
        ["u2", 1, "WA", [100, "min"]],
        ["u1", 1, "AC", [120, "min"]],
    ]
    assert regenerate_ranklist_by_solutions(original, solutions) == expected["regenerated"]

    default_no_penalty = make_ranklist(
        problems=[{"alias": "A"}],
        rows=[make_row("u1", {"value": 0, "time": [0, "ms"]}, [{"result": None, "solutions": []}])],
    )
    assert (
        regenerate_ranklist_by_solutions(
            default_no_penalty,
            [
                ["u1", 0, "WA", [10, "min"]],
                ["u1", 0, "CE", [15, "min"]],
                ["u1", 0, "WA", [20, "min"]],
                ["u1", 0, "?", [25, "min"]],
                ["u1", 0, "AC", [30, "min"]],
            ],
        )
        == expected["defaultNoPenalty"]
    )

    custom_no_penalty = make_ranklist(
        problems=[{"alias": "A"}],
        rows=[make_row("u1", {"value": 0, "time": [0, "ms"]}, [{"result": None, "solutions": []}])],
        sorter={"algorithm": "ICPC", "config": {"noPenaltyResults": ["FB", "AC", "?", "NOUT", "UKE", None]}},
    )
    assert (
        regenerate_ranklist_by_solutions(
            custom_no_penalty, [["u1", 0, "CE", [10, "min"]], ["u1", 0, "AC", [30, "min"]]]
        )
        == expected["customNoPenalty"]
    )

    post_ac = make_ranklist(
        problems=[{"alias": "A"}],
        rows=[make_row("u1", {"value": 0, "time": [0, "ms"]}, [{"result": None, "solutions": []}])],
    )
    assert (
        regenerate_ranklist_by_solutions(
            post_ac,
            [
                ["u1", 0, "WA", [10, "min"]],
                ["u1", 0, "AC", [20, "min"]],
                ["u1", 0, "WA", [30, "min"]],
                ["u1", 0, "FB", [40, "min"]],
            ],
        )
        == expected["postAc"]
    )


def test_ranklist_precision_incremental_and_static_match_js_contract():
    expected = FIXTURES["ranklist"]

    assert (
        regenerate_ranklist_by_solutions(
            make_ranklist(
                problems=[{"alias": "A"}],
                rows=[make_row("u1", {"value": 0, "time": [0, "ms"]}, [{"result": None, "solutions": []}])],
                sorter={"algorithm": "ICPC", "config": {"timePrecision": "min", "timeRounding": "ceil"}},
            ),
            [["u1", 0, "AC", [125, "s"]]],
        )
        == expected["timePrecision"]
    )

    ranking_precision = regenerate_ranklist_by_solutions(
        make_ranklist(
            problems=[{"alias": "A"}],
            rows=[
                make_row("slow-original-first", {"value": 0, "time": [0, "ms"]}, [{"result": None, "solutions": []}]),
                make_row("fast-original-second", {"value": 0, "time": [0, "ms"]}, [{"result": None, "solutions": []}]),
            ],
            sorter={"algorithm": "ICPC", "config": {"rankingTimePrecision": "h", "rankingTimeRounding": "floor"}},
        ),
        [["slow-original-first", 0, "AC", [359, "min"]], ["fast-original-second", 0, "AC", [301, "min"]]],
    )
    assert [row["user"]["id"] for row in ranking_precision["rows"]] == expected["rankingPrecisionOrder"]

    incremental = make_ranklist(
        problems=[{"alias": "A"}],
        rows=[
            make_row("u1", {"value": 0, "time": [0, "ms"]}, [{"result": None, "solutions": []}]),
            make_row("u2", {"value": 0, "time": [0, "ms"]}, [{"result": None, "solutions": []}]),
        ],
    )
    assert (
        regenerate_rows_by_incremental_solutions(
            incremental,
            [
                ["u1", 0, "WA", [10, "min"]],
                ["u1", 0, "CE", [15, "min"]],
                ["u2", 0, "AC", [20, "min"]],
                ["u1", 0, "AC", [35, "min"]],
            ],
        )
        == expected["incrementalRows"]
    )

    incremental_post_ac = make_ranklist(
        problems=[{"alias": "A"}],
        rows=[
            make_row(
                "u1",
                {"value": 1, "time": [20, "min"]},
                [
                    {
                        "result": "AC",
                        "time": [20, "min"],
                        "tries": 1,
                        "solutions": [{"result": "AC", "time": [20, "min"]}],
                    }
                ],
            )
        ],
    )
    assert (
        regenerate_rows_by_incremental_solutions(
            incremental_post_ac,
            [["u1", 0, "WA", [30, "min"]], ["u1", 0, "AC", [40, "min"]]],
        )
        == expected["incrementalPostAcRows"]
    )

    static_ranklist = make_ranklist(
        series=[
            {"title": "Overall", "rule": {"preset": "Normal"}},
            {"title": "Official", "rule": {"preset": "Normal", "options": {"includeOfficialOnly": True}}},
            {"title": "School", "rule": {"preset": "UniqByUserField", "options": {"field": "organization"}}},
            {
                "title": "Medals",
                "segments": [{"title": "Gold"}, {"title": "Silver"}],
                "rule": {"preset": "ICPC", "options": {"count": {"value": [1, 1], "noTied": True}}},
            },
        ],
        rows=[
            make_row("u1", {"value": 2, "time": [100, "min"]}, user={"organization": "School A"}),
            make_row("u2", {"value": 2, "time": [100, "min"]}, user={"organization": "School A"}),
            make_row("u3", {"value": 1, "time": [50, "min"]}, user={"organization": "School B", "official": False}),
            make_row("u4", {"value": 1, "time": [60, "min"]}, user={"organization": "School B"}),
        ],
    )
    assert [row["rankValues"] for row in convert_to_static_ranklist(static_ranklist)["rows"]] == expected[
        "staticRankValues"
    ]

    marker_ranklist = make_ranklist(
        series=[
            {
                "title": "Girls",
                "segments": [{"title": "Gold"}, {"title": "Silver"}],
                "rule": {"preset": "ICPC", "options": {"filter": {"byMarker": "girls"}, "count": {"value": [1, 1]}}},
            }
        ],
        rows=[
            make_row("modern-marker", {"value": 3, "time": [10, "min"]}, user={"markers": ["girls"]}),
            make_row(
                "empty-modern-marker",
                {"value": 2, "time": [20, "min"]},
                user={"marker": "girls", "markers": []},
            ),
            make_row("legacy-marker", {"value": 1, "time": [30, "min"]}, user={"marker": "girls"}),
        ],
    )
    assert [row["rankValues"][0] for row in convert_to_static_ranklist(marker_ranklist)["rows"]] == expected[
        "markerRankValues"
    ]

    invalid_filter = make_ranklist(
        series=[
            {
                "title": "Invalid filter",
                "segments": [{"title": "Gold"}],
                "rule": {
                    "preset": "ICPC",
                    "options": {
                        "filter": {"byUserFields": [{"field": "organization", "rule": "("}]},
                        "count": {"value": [1]},
                    },
                },
            }
        ],
        rows=[make_row("u1", {"value": 1, "time": [10, "min"]}, user={"organization": "SDUT"})],
    )
    assert convert_to_static_ranklist(invalid_filter)["rows"][0]["rankValues"][0] == expected["invalidFilterRankValue"]

    ratio_ranklist = make_ranklist(
        series=[
            {
                "title": "Ratio",
                "segments": [{"title": "A"}, {"title": "B"}],
                "rule": {"preset": "ICPC", "options": {"ratio": {"value": [0.1, 0.2], "rounding": "ceil"}}},
            }
        ],
        rows=[make_row(f"ratio-u{index + 1}", {"value": 10 - index, "time": [index, "min"]}) for index in range(10)],
    )
    assert [row["rankValues"][0] for row in convert_to_static_ranklist(ratio_ranklist)["rows"]] == expected[
        "ratioRankValues"
    ]

    strict_id_ranklist = make_ranklist(
        series=[
            {
                "title": "Strict ID",
                "segments": [{"title": "Only"}],
                "rule": {"preset": "ICPC", "options": {"filter": {"byMarker": "girls"}, "count": {"value": [2]}}},
            }
        ],
        rows=[
            make_row(
                "fallback-a", {"value": 2, "time": [10, "min"]}, user={"id": None, "name": "No ID A", "marker": "girls"}
            ),
            make_row("fallback-b", {"value": 1, "time": [20, "min"]}, user={"id": None, "name": "No ID B"}),
        ],
    )
    assert [row["rankValues"][0] for row in convert_to_static_ranklist(strict_id_ranklist)["rows"]] == expected[
        "strictIdRankValues"
    ]
