import copy
import json
import math
from pathlib import Path

import pytest

import standard_ranklist_utils as utils
from standard_ranklist_utils import (
    CCPC26ProblemLayout,
    get_ccpc26_problem_layout,
    get_ccpc26_row_problem_order,
)
from standard_ranklist_utils.types import CCPC26ProblemLayout as LayoutType

FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "contract-fixtures.json").read_text(encoding="utf-8"))


def make_ranklist(threshold, rows=None):
    return {
        "problems": [{"alias": "A"}],
        "rows": rows or [],
        "sorter": {
            "algorithm": "ICPC",
            "config": {
                "extendedAlgorithms": [{"algorithm": "CCPC26", "config": {"problemRevealAcceptedThreshold": threshold}}]
            },
        },
    }


def make_row(result=None):
    return {"user": {}, "statuses": [{"result": result}], "score": {"value": int(result in ("AC", "FB"))}}


@pytest.mark.parametrize("case", FIXTURES["ccpc26"]["layouts"], ids=lambda case: case["name"])
def test_layout_matches_js_contract_without_mutation(case):
    before = copy.deepcopy(case["ranklist"])
    assert get_ccpc26_problem_layout(case["ranklist"]) == case["expected"]
    assert case["ranklist"] == before


@pytest.mark.parametrize("case", FIXTURES["ccpc26"]["orders"], ids=lambda case: case["name"])
def test_row_order_matches_js_contract_without_mutation(case):
    before = copy.deepcopy(case)
    assert get_ccpc26_row_problem_order(case["statuses"], case["layout"]) == case["expected"]
    assert case == before


def test_ccpc26_contract_fixture_is_present():
    assert FIXTURES["ccpc26"]["layouts"]
    assert FIXTURES["ccpc26"]["orders"]


def test_public_exports_and_native_sequence_input():
    assert CCPC26ProblemLayout is LayoutType
    assert {"CCPC26ProblemLayout", "get_ccpc26_problem_layout", "get_ccpc26_row_problem_order"} <= set(utils.__all__)
    layout = CCPC26ProblemLayout(revealedProblemIndexes=[], hiddenProblemIndexes=[0, 1])
    statuses = ({"result": "FB", "time": (1, "min")}, {"result": "AC", "time": (0, "s")})
    before = copy.deepcopy((statuses, layout))
    assert get_ccpc26_row_problem_order(statuses, layout) == [1, 0]
    assert (statuses, layout) == before


@pytest.mark.parametrize("field", ["count", "ratio"])
@pytest.mark.parametrize("value", [True, False, "0", None, math.nan, math.inf, -math.inf])
def test_non_numeric_or_non_finite_thresholds_are_ignored(field, value):
    ranklist = make_ranklist({field: value})
    assert get_ccpc26_problem_layout(ranklist) == {"revealedProblemIndexes": [], "hiddenProblemIndexes": [0]}


@pytest.mark.parametrize("value", [True, False, "0", math.nan, math.inf, -math.inf, 1e308])
def test_invalid_or_overflowing_duration_values_are_unknown(value):
    statuses = [{"result": "AC", "time": [value, "s"]}, {"result": "AC", "time": [2, "s"]}]
    layout = CCPC26ProblemLayout(revealedProblemIndexes=[], hiddenProblemIndexes=[0, 1])
    assert get_ccpc26_row_problem_order(statuses, layout) == [1, 0]
    # An invalid accepted summary may still use valid accepted history.
    statuses[0]["solutions"] = [{"result": "FB", "time": [0, "s"]}]
    assert get_ccpc26_row_problem_order(statuses, layout) == [0, 1]


@pytest.mark.parametrize("rounding", ["floor", "ceil", "round"])
@pytest.mark.parametrize("ratio, revealed", [(1e308, []), (-1e308, [0])])
def test_ratio_product_overflow_matches_js_infinity(rounding, ratio, revealed):
    ranklist = make_ranklist({"ratio": ratio, "rounding": rounding}, [make_row(), make_row()])
    assert get_ccpc26_problem_layout(ranklist)["revealedProblemIndexes"] == revealed


def test_round_matches_js_half_ties_and_adjacent_float():
    cases = [
        (0.49999999999999994, [make_row()], [0]),
        (0.5, [make_row()], []),
        (0.5, [make_row("AC"), make_row("FB"), make_row(), make_row(), make_row()], []),
    ]
    for ratio, rows, expected in cases:
        ranklist = make_ranklist({"ratio": ratio, "rounding": "round"}, rows)
        before = copy.deepcopy(ranklist)
        assert get_ccpc26_problem_layout(ranklist)["revealedProblemIndexes"] == expected
        assert ranklist == before


def test_official_only_excludes_boolean_false_not_numeric_zero():
    rows = [make_row("AC"), make_row("FB")]
    rows[0]["user"]["official"] = 0
    rows[1]["user"]["official"] = False
    ranklist = make_ranklist({"count": 1, "includeOfficialOnly": True}, rows)
    assert get_ccpc26_problem_layout(ranklist)["revealedProblemIndexes"] == [0]
