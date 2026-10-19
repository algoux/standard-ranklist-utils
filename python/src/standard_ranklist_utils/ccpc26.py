"""Pure CCPC26 problem visibility and per-row display order helpers."""

import math
from collections.abc import Sequence
from typing import Any, Optional

from .formatters import format_time_duration
from .types import CCPC26ProblemLayout, Ranklist, RankProblemStatus


def get_ccpc26_problem_layout(ranklist: Ranklist) -> Optional[CCPC26ProblemLayout]:
    """Compute revealed/hidden original indexes from the complete current snapshot.

    Return None unless the ICPC sorter contains the standard nested CCPC26
    configuration. The caller controls activation and freeze timing, and must
    apply display-only row filters after this calculation.
    """
    sorter = ranklist.get("sorter")
    if not isinstance(sorter, dict) or sorter.get("algorithm") != "ICPC":
        return None
    config = sorter.get("config")
    algorithms = config.get("extendedAlgorithms") if isinstance(config, dict) else None
    algorithm = (
        next(
            (item for item in algorithms if isinstance(item, dict) and item.get("algorithm") == "CCPC26"),
            None,
        )
        if isinstance(algorithms, list)
        else None
    )
    config = algorithm.get("config") if algorithm is not None else None
    threshold = config.get("problemRevealAcceptedThreshold") if isinstance(config, dict) else None
    if not isinstance(threshold, dict):
        return None

    accepted_counts = [0] * len(ranklist["problems"])
    denominator_count = 0
    for row in ranklist["rows"]:
        if threshold.get("includeOfficialOnly") and row["user"].get("official") is False:
            continue
        statuses = row["statuses"]
        denominator = threshold.get("denominator")
        if denominator == "submitted":
            contributes = any(_has_submission(status) for status in statuses)
        elif denominator == "scored":
            contributes = row["score"]["value"] > 0
        else:
            contributes = True
        denominator_count += int(contributes)
        for index in range(len(accepted_counts)):
            if index < len(statuses) and _is_accepted(statuses[index]):
                accepted_counts[index] += 1

    count = threshold.get("count")
    count_threshold = count if _is_finite_number(count) else None
    ratio = threshold.get("ratio")
    ratio_threshold = (
        _round_threshold(denominator_count * float(ratio), threshold.get("rounding"))
        if _is_finite_number(ratio)
        else None
    )
    layout: CCPC26ProblemLayout = {"revealedProblemIndexes": [], "hiddenProblemIndexes": []}
    for index, accepted in enumerate(accepted_counts):
        revealed = (count_threshold is not None and accepted >= count_threshold) or (
            ratio_threshold is not None and accepted >= ratio_threshold
        )
        layout["revealedProblemIndexes" if revealed else "hiddenProblemIndexes"].append(index)
    return layout


def get_ccpc26_row_problem_order(statuses: Sequence[RankProblemStatus], layout: CCPC26ProblemLayout) -> list[int]:
    """Return original indexes in revealed, accepted, attempted, untouched order.

    Unknown times follow known times within a group, with original indexes as
    tie-breakers. The layout determines columns, including missing statuses.
    Neither the layout nor any status or solution history is modified.
    """

    def sort_key(index: int) -> tuple[int, bool, float, int]:
        status = statuses[index] if 0 <= index < len(statuses) else None
        accepted = _is_accepted(status)
        group = 0 if accepted else 1 if _has_submission(status) else 2
        time = _get_accepted_time(status) if accepted else _get_last_submission_time(status)
        if group == 2:
            time = None
        return group, time is None, time if time is not None else 0, index

    return [*layout["revealedProblemIndexes"], *sorted(layout["hiddenProblemIndexes"], key=sort_key)]


def _is_accepted(status: Optional[RankProblemStatus]) -> bool:
    return status is not None and status.get("result") in ("AC", "FB")


def _has_submission(status: Optional[RankProblemStatus]) -> bool:
    return bool(
        status and (status.get("solutions") or status.get("result") is not None or (status.get("tries") or 0) > 0)
    )


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _round_threshold(value: float, rounding: Any) -> float:
    # Finite ratios can overflow when multiplied by the population. JS keeps
    # that infinity; Python's floor/ceil would otherwise raise an exception.
    if not math.isfinite(value):
        return value
    if rounding == "ceil":
        return math.ceil(value)
    base = math.floor(value)
    if rounding == "round":
        # Math.round resolves ties toward +infinity, unlike Python round.
        # Avoid floor(value + .5), which rounds the float just below .5 to 1.
        return base + int(value - base >= 0.5)
    return base


def _get_time(time: Any) -> Optional[float]:
    if not isinstance(time, Sequence) or isinstance(time, (str, bytes)) or len(time) < 2:
        return None
    if not _is_finite_number(time[0]):
        return None
    try:
        value = format_time_duration((float(time[0]), time[1]))
        return value if _is_finite_number(value) else None
    except (ValueError, TypeError, IndexError, OverflowError):
        return None


def _get_accepted_time(status: Optional[RankProblemStatus]) -> Optional[float]:
    if status is None:
        return None
    summary_time = _get_time(status.get("time"))
    if summary_time is not None:
        return summary_time
    earliest = None
    for solution in status.get("solutions") or []:
        if solution.get("result") not in ("AC", "FB"):
            continue
        time = _get_time(solution.get("time"))
        if time is not None and (earliest is None or time < earliest):
            earliest = time
    return earliest


def _get_last_submission_time(status: Optional[RankProblemStatus]) -> Optional[float]:
    if status is None:
        return None
    solutions = status.get("solutions")
    if not solutions:
        return _get_time(status.get("time"))
    latest = None
    for solution in solutions:
        time = _get_time(solution.get("time"))
        if time is not None and (latest is None or time > latest):
            latest = time
    return latest
