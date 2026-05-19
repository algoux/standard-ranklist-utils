import copy
import math
import re
from decimal import Decimal
from typing import Any, Callable, Optional

from .constants import MIN_REGEN_SUPPORTED_VERSION
from .formatters import format_time_duration

DEFAULT_NO_PENALTY_RESULTS = ["FB", "AC", "?", "NOUT", "CE", "UKE", None]
FILTERABLE_USER_FIELDS = ["id", "name", "organization"]
GROUPABLE_USER_FIELDS = ["id", "name", "organization"]


def _js_round(value: float) -> int:
    return math.floor(value + 0.5)


def _rounding_fn(name: Optional[str]) -> Callable[[float], float]:
    if name == "ceil":
        return math.ceil
    if name == "round":
        return _js_round
    return math.floor


SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


def _parse_semver(version: str) -> Optional[tuple[int, int, int, bool]]:
    match = SEMVER_RE.match(version or "")
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)), bool(match.group(4)))


def _semver_gte(version: str, minimum: str) -> bool:
    parsed_version = _parse_semver(version)
    parsed_minimum = _parse_semver(minimum)
    if parsed_version is None or parsed_minimum is None:
        return False
    version_core = parsed_version[:3]
    minimum_core = parsed_minimum[:3]
    if version_core != minimum_core:
        return version_core > minimum_core
    if parsed_version[3] and not parsed_minimum[3]:
        return False
    return True


def _user_id(user: dict[str, Any]) -> str:
    if user.get("id"):
        return str(user["id"])
    name = user.get("name")
    if isinstance(name, str):
        return name
    import json

    return json.dumps(name, ensure_ascii=False, separators=(",", ":"))


def _sorter_config(ranklist: dict[str, Any]) -> dict[str, Any]:
    config = {
        "penalty": [20, "min"],
        "noPenaltyResults": DEFAULT_NO_PENALTY_RESULTS.copy(),
        "timeRounding": "floor",
    }
    config.update(copy.deepcopy(ranklist.get("sorter", {}).get("config", {}) or {}))
    return config


def _supports_regeneration(ranklist: dict[str, Any]) -> bool:
    if not _semver_gte(ranklist.get("version", ""), MIN_REGEN_SUPPORTED_VERSION):
        return False
    return ranklist.get("sorter", {}).get("algorithm") == "ICPC"


def sort_rows(rows: list[dict[str, Any]], options: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    options = options or {}
    ranking_time_precision = options.get("rankingTimePrecision") or "ms"
    rounding = _rounding_fn(options.get("rankingTimeRounding"))

    def key(row: dict[str, Any]) -> tuple[float, float]:
        score = row["score"]
        time = format_time_duration(score["time"], ranking_time_precision, rounding) if score.get("time") else 0
        return (-score["value"], time)

    rows.sort(key=key)
    return rows


def regenerate_ranklist_by_solutions(original_ranklist: dict[str, Any], solutions: list[list[Any]]) -> dict[str, Any]:
    if not _supports_regeneration(original_ranklist):
        raise ValueError("The ranklist is not supported to regenerate")
    sorter_config = _sorter_config(original_ranklist)
    ranklist = {key: copy.deepcopy(value) for key, value in original_ranklist.items() if key != "rows"}
    ranklist["rows"] = []
    rows = []
    user_row_map: dict[str, dict[str, Any]] = {}
    problem_count = len(ranklist["problems"])
    for row in original_ranklist["rows"]:
        user_id = _user_id(row["user"])
        user_row_map[user_id] = {
            "user": copy.deepcopy(row["user"]),
            "score": {"value": 0},
            "statuses": [{"result": None, "solutions": []} for _ in range(problem_count)],
        }
    for user_id, problem_index, result, time in solutions:
        row = user_row_map.get(user_id)
        if not row:
            break
        row["statuses"][problem_index]["solutions"].append({"result": result, "time": time})

    problem_accepted_count = [0] * problem_count
    problem_submitted_count = [0] * problem_count
    for row in user_row_map.values():
        score_value = 0
        total_time_ms = 0
        for index, status in enumerate(row["statuses"]):
            for solution in status["solutions"]:
                result = solution.get("result")
                if not result:
                    continue
                is_no_penalty = result in (sorter_config.get("noPenaltyResults") or [])
                if result == "?":
                    status["result"] = result
                    if not is_no_penalty:
                        status["tries"] = (status.get("tries") or 0) + 1
                        problem_submitted_count[index] += 1
                    continue
                if result in ("AC", "FB"):
                    status["result"] = result
                    status["time"] = solution["time"]
                    status["tries"] = (status.get("tries") or 0) + 1
                    problem_accepted_count[index] += 1
                    problem_submitted_count[index] += 1
                    break
                if is_no_penalty:
                    continue
                status["result"] = "RJ"
                status["tries"] = (status.get("tries") or 0) + 1
                problem_submitted_count[index] += 1
            if status.get("result") in ("AC", "FB"):
                target_time = [
                    format_time_duration(
                        status["time"],
                        sorter_config.get("timePrecision") or "ms",
                        _rounding_fn(sorter_config.get("timeRounding")),
                    ),
                    sorter_config.get("timePrecision") or "ms",
                ]
                score_value += 1
                total_time_ms += format_time_duration(target_time, "ms") + (status["tries"] - 1) * format_time_duration(
                    sorter_config["penalty"], "ms"
                )
        row["score"] = {"value": score_value, "time": [total_time_ms, "ms"]}
        rows.append(row)
    ranklist["rows"] = sort_rows(
        rows,
        {
            "rankingTimePrecision": sorter_config.get("rankingTimePrecision"),
            "rankingTimeRounding": sorter_config.get("rankingTimeRounding"),
        },
    )
    for index, problem in enumerate(ranklist["problems"]):
        if not problem.get("statistics"):
            problem["statistics"] = {"accepted": 0, "submitted": 0}
        problem["statistics"]["accepted"] = problem_accepted_count[index]
        problem["statistics"]["submitted"] = problem_submitted_count[index]
    return ranklist


def regenerate_rows_by_incremental_solutions(
    original_ranklist: dict[str, Any],
    solutions: list[list[Any]],
) -> list[dict[str, Any]]:
    if not _supports_regeneration(original_ranklist):
        raise ValueError("The ranklist is not supported to regenerate")
    sorter_config = _sorter_config(original_ranklist)
    user_row_index_map = {_user_id(row["user"]): index for index, row in enumerate(original_ranklist["rows"])}
    rows = [copy.deepcopy(row) for row in original_ranklist["rows"]]
    cloned_statuses: set[str] = set()
    for user_id, problem_index, result, time in solutions:
        row_index = user_row_index_map.get(user_id)
        if row_index is None:
            break
        row = rows[row_index]
        status_key = f"{user_id}_{problem_index}"
        if status_key not in cloned_statuses:
            row["statuses"][problem_index] = copy.deepcopy(row["statuses"][problem_index])
            row["statuses"][problem_index]["solutions"] = list(row["statuses"][problem_index].get("solutions") or [])
            cloned_statuses.add(status_key)
        status = row["statuses"][problem_index]
        status["solutions"].append({"result": result, "time": time})
        if status.get("result") in ("AC", "FB"):
            continue
        is_no_penalty = result in (sorter_config.get("noPenaltyResults") or [])
        if result == "?":
            status["result"] = result
            if not is_no_penalty:
                status["tries"] = (status.get("tries") or 0) + 1
            continue
        if result in ("AC", "FB"):
            status["result"] = result
            status["time"] = time
            status["tries"] = (status.get("tries") or 0) + 1
            row["score"]["value"] += 1
            target_time = [
                format_time_duration(
                    status["time"],
                    sorter_config.get("timePrecision") or "ms",
                    _rounding_fn(sorter_config.get("timeRounding")),
                ),
                sorter_config.get("timePrecision") or "ms",
            ]
            total_time = format_time_duration(row["score"]["time"], "ms") if row["score"].get("time") else 0
            row["score"]["time"] = [
                total_time
                + format_time_duration(target_time, "ms")
                + (status["tries"] - 1) * format_time_duration(sorter_config["penalty"], "ms"),
                "ms",
            ]
            continue
        if is_no_penalty:
            continue
        status["result"] = "RJ"
        status["tries"] = (status.get("tries") or 0) + 1
    return sort_rows(
        rows,
        {
            "rankingTimePrecision": sorter_config.get("rankingTimePrecision"),
            "rankingTimeRounding": sorter_config.get("rankingTimeRounding"),
        },
    )


def _compare_score_equal(a: dict[str, Any], b: dict[str, Any], options: dict[str, Any]) -> bool:
    if a["value"] != b["value"]:
        return False
    ranking_time_precision = options.get("rankingTimePrecision") or "ms"
    rounding = _rounding_fn(options.get("rankingTimeRounding"))
    da = format_time_duration(a["time"], ranking_time_precision, rounding) if a.get("time") else 0
    db = format_time_duration(b["time"], ranking_time_precision, rounding) if b.get("time") else 0
    return da == db


def _gen_row_ranks(rows: list[dict[str, Any]], options: dict[str, Any]) -> dict[str, list[Optional[int]]]:
    def gen_ranks(current_rows: list[dict[str, Any]]) -> list[int]:
        ranks: list[int] = [0] * len(current_rows)
        for index, row in enumerate(current_rows):
            if index == 0:
                ranks[index] = 1
            elif _compare_score_equal(row["score"], current_rows[index - 1]["score"], options):
                ranks[index] = ranks[index - 1]
            else:
                ranks[index] = index + 1
        return ranks

    ranks = gen_ranks(rows)
    official_rows = []
    index_back_map = {}
    for index, row in enumerate(rows):
        if row["user"].get("official") is not False:
            index_back_map[index] = len(official_rows)
            official_rows.append(row)
    official_partial_ranks = gen_ranks(official_rows)
    official_ranks = [
        None if index not in index_back_map else official_partial_ranks[index_back_map[index]]
        for index in range(len(rows))
    ]
    return {"ranks": ranks, "officialRanks": official_ranks}


def _stringify(value: Any) -> str:
    if isinstance(value, dict):
        import json

        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def _gen_series_calc_fns(
    series: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    ranks: list[int],
    official_ranks: list[Any],
):
    def fallback(_row: dict[str, Any], _index: int) -> dict[str, Any]:
        return {"rank": None, "segmentIndex": None}

    fns = []
    for series_config in series:
        rule = series_config.get("rule")
        if not rule:
            fns.append(fallback)
            continue
        preset = rule.get("preset")
        if preset == "Normal":
            options = rule.get("options") or {}

            def normal(row, index, options=options):
                if options.get("includeOfficialOnly") and row["user"].get("official") is False:
                    return {"rank": None, "segmentIndex": None}
                return {
                    "rank": official_ranks[index] if options.get("includeOfficialOnly") else ranks[index],
                    "segmentIndex": None,
                }

            fns.append(normal)
            continue
        if preset == "UniqByUserField":
            options = rule.get("options") or {}
            field = options.get("field")
            assigned = {}
            values = set()
            last_outer_rank = 0
            last_rank = 0
            for index, row in enumerate(rows):
                if options.get("includeOfficialOnly") and row["user"].get("official") is False:
                    continue
                is_valid = field in GROUPABLE_USER_FIELDS
                value = _stringify(row["user"].get(field))
                if not is_valid or (value and value not in values):
                    outer_rank = official_ranks[index] if options.get("includeOfficialOnly") else ranks[index]
                    if is_valid:
                        values.add(value)
                    if outer_rank != last_outer_rank:
                        last_outer_rank = outer_rank
                        last_rank = len(assigned) + 1
                        assigned[index] = last_rank
                    assigned[index] = last_rank

            def uniq(_row, index, assigned=assigned):
                return {"rank": assigned.get(index), "segmentIndex": None}

            fns.append(uniq)
            continue
        if preset == "ICPC":
            options = rule.get("options") or {}
            filtered_rows = [row for row in rows if row["user"].get("official") is not False]
            filtered_official_ranks = list(official_ranks)
            filters = []
            if options.get("filter"):
                filter_options = options["filter"]
                for filter_config in filter_options.get("byUserFields") or []:
                    field = filter_config.get("field")
                    pattern = filter_config.get("rule")
                    if field not in FILTERABLE_USER_FIELDS:
                        continue
                    try:
                        regexp = re.compile(pattern)
                    except re.error:
                        filters.append(lambda _row: False)
                        continue

                    def test(row, field=field, regexp=regexp):
                        value = row["user"].get(field)
                        if value is None:
                            return False
                        if isinstance(value, dict):
                            return any(regexp.search(str(item)) for item in value.values())
                        if isinstance(value, list):
                            return any(regexp.search(str(item)) for item in value)
                        return regexp.search(str(value)) is not None

                    filters.append(test)
                if filter_options.get("byMarker"):
                    marker = filter_options["byMarker"]

                    def marker_test(row, marker=marker):
                        user = row["user"]
                        if isinstance(user.get("markers"), list):
                            return marker in user["markers"]
                        return user.get("marker") == marker

                    filters.append(marker_test)
                if filters:
                    current_filtered_rows = []
                    filtered_official_ranks = [None] * len(filtered_official_ranks)
                    current_rank = 0
                    current_official_rank = 0
                    current_official_rank_old = 0
                    for index, row in enumerate(rows):
                        if all(test(row) for test in filters):
                            current_filtered_rows.append(row)
                            old_rank = official_ranks[index]
                            if old_rank is not None:
                                current_rank += 1
                                if current_official_rank_old != old_rank:
                                    current_official_rank = current_rank
                                    current_official_rank_old = old_rank
                                filtered_official_ranks[index] = current_official_rank
                    filtered_rows = [row for row in current_filtered_rows if row["user"].get("official") is not False]
            endpoint_rules = []
            no_tied = False
            if options.get("ratio"):
                ratio = options["ratio"]
                denominator = ratio.get("denominator", "all")
                if denominator == "submitted":
                    total = len(
                        [
                            row
                            for row in filtered_rows
                            if not all(status.get("result") is None for status in row["statuses"])
                        ]
                    )
                elif denominator == "scored":
                    total = len([row for row in filtered_rows if row["score"]["value"] > 0])
                else:
                    total = len(filtered_rows)
                acc_values = []
                for index, value in enumerate(ratio["value"]):
                    current = Decimal(str(value))
                    acc_values.append(current if index == 0 else acc_values[index - 1] + current)
                rounding = ratio.get("rounding", "ceil")
                endpoint_rules.append(
                    [
                        math.floor(float(value * total))
                        if rounding == "floor"
                        else _js_round(float(value * total))
                        if rounding == "round"
                        else math.ceil(float(value * total))
                        for value in acc_values
                    ]
                )
                if ratio.get("noTied"):
                    no_tied = True
            if options.get("count"):
                acc_values = []
                for index, value in enumerate(options["count"]["value"]):
                    acc_values.append((acc_values[index - 1] if index > 0 else 0) + value)
                endpoint_rules.append(acc_values)
                if options["count"].get("noTied"):
                    no_tied = True
            official_ranks_no_tied = []
            current_official_rank = 0
            for rank in filtered_official_ranks:
                if rank is None:
                    official_ranks_no_tied.append(None)
                else:
                    current_official_rank += 1
                    official_ranks_no_tied.append(current_official_rank)
            filtered_ids = {row["user"].get("id") for row in filtered_rows}

            def icpc(
                row,
                index,
                endpoint_rules=endpoint_rules,
                filtered_ids=filtered_ids,
                filtered_official_ranks=filtered_official_ranks,
                official_ranks_no_tied=official_ranks_no_tied,
                no_tied=no_tied,
                series_config=series_config,
            ):
                if row["user"].get("official") is False or row["user"].get("id") not in filtered_ids:
                    return {"rank": None, "segmentIndex": None}
                using_ranks = official_ranks_no_tied if no_tied else filtered_official_ranks
                segment_index = None
                for seg_index, _segment in enumerate(series_config.get("segments") or []):
                    rank_for_compare = 0 if using_ranks[index] is None else using_ranks[index]
                    if all(
                        seg_index < len(endpoints) and rank_for_compare <= endpoints[seg_index]
                        for endpoints in endpoint_rules
                    ):
                        segment_index = seg_index
                        break
                return {"rank": filtered_official_ranks[index], "segmentIndex": segment_index}

            fns.append(icpc)
            continue
        fns.append(fallback)
    return fns


def convert_to_static_ranklist(ranklist: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not ranklist:
        return ranklist
    row_ranks = _gen_row_ranks(
        ranklist["rows"],
        {
            "rankingTimePrecision": (ranklist.get("sorter", {}).get("config") or {}).get("rankingTimePrecision"),
            "rankingTimeRounding": (ranklist.get("sorter", {}).get("config") or {}).get("rankingTimeRounding"),
        },
    )
    series_calc_fns = _gen_series_calc_fns(
        ranklist["series"],
        ranklist["rows"],
        row_ranks["ranks"],
        row_ranks["officialRanks"],
    )
    result = copy.deepcopy(ranklist)
    result["rows"] = []
    for index, row in enumerate(ranklist["rows"]):
        copied = copy.deepcopy(row)
        copied["rankValues"] = [fn(row, index) for fn in series_calc_fns]
        result["rows"].append(copied)
    return result
