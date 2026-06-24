import copy
import json
import math
import re
from typing import Any, Callable, Optional

from .formatters import format_time_duration
from .ranklist import sort_rows

DiagnosticIssue = dict[str, Any]
Diagnostics = dict[str, Any]

TIME_UNITS = ["ms", "s", "min", "h", "d"]
ACTUAL_UNIT_ORDER = ["d", "h", "min", "s", "ms"]
TIME_UNIT_MS = {
    "ms": 1,
    "s": 1000,
    "min": 60 * 1000,
    "h": 60 * 60 * 1000,
    "d": 24 * 60 * 60 * 1000,
}
DEFAULT_NO_PENALTY_RESULTS = ["FB", "AC", "?", "NOUT", "CE", "UKE", None]
SORTER_NO_PENALTY_BASE_RESULTS = ["FB", "AC", "?"]
SORTER_NO_PENALTY_OPTIONAL_RESULTS = ["NOUT", "CE", "UKE"]
PROBLEM_STATISTICS_SUSPECT_NO_PENALTY_RESULTS = ["CE", "NOUT", "UKE"]
LITE_RESULTS = {"FB", "AC", "RJ", "?"}
FULL_ONLY_RESULTS = {"WA", "PE", "TLE", "MLE", "OLE", "IDLE", "RTE", "NOUT", "CE", "UKE"}


def diagnose_ranklist(ranklist: dict[str, Any], _options: Optional[dict[str, Any]] = None) -> Diagnostics:
    issues: list[DiagnosticIssue] = []
    suggestions: dict[str, list[dict[str, Any]]] = {
        "firstBlood": [],
        "sorter": [],
        "problemStatistics": [],
    }

    def add_issue(issue: dict[str, Any]) -> dict[str, Any]:
        normalized = {"section": "correctness", **issue}
        issues.append(normalized)
        return normalized

    precision = _collect_precision_summary(ranklist, add_issue)
    completeness_items = _build_completeness_items(ranklist, add_issue)
    first_blood_check = _check_first_blood(ranklist, add_issue, suggestions["firstBlood"])
    statuses_check = _check_statuses(ranklist, add_issue)
    problem_statistics_check = _check_problem_statistics(ranklist, add_issue, suggestions["problemStatistics"])
    mock_solutions_check = _check_mock_solutions(ranklist, add_issue)
    status_summaries_check = _check_status_summaries(ranklist, add_issue)
    scores_check = _check_scores(ranklist, add_issue)
    row_order_check = _check_row_order(ranklist, add_issue)
    sorter_config_check = _check_sorter_config(ranklist, precision, add_issue, suggestions["sorter"])
    markers_check = _check_markers(ranklist, add_issue)

    return {
        "summary": {"precision": precision},
        "completeness": {"items": completeness_items},
        "correctness": {
            "checks": {
                "firstBlood": first_blood_check,
                "problemStatistics": problem_statistics_check,
                "mockSolutions": mock_solutions_check,
                "statuses": statuses_check,
                "statusSummaries": status_summaries_check,
                "scores": scores_check,
                "rowOrder": row_order_check,
                "sorterConfig": sorter_config_check,
                "markers": markers_check,
            }
        },
        "suggestions": suggestions,
        "issues": issues,
    }


def _collect_precision_summary(ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    solution_times: list[dict[str, Any]] = []
    status_times: list[dict[str, Any]] = []
    score_times: list[dict[str, Any]] = []
    for row_index, row in enumerate(ranklist.get("rows") or []):
        score = row.get("score") or {}
        if score.get("time"):
            score_times.append(
                {
                    "value": score.get("time"),
                    "path": f"rows[{row_index}].score.time",
                    "rowIndex": row_index,
                    "userId": _get_row_user_id(row),
                }
            )
        for problem_index, status in enumerate(row.get("statuses") or []):
            if status and status.get("time"):
                status_times.append(
                    {
                        "value": status.get("time"),
                        "path": f"rows[{row_index}].statuses[{problem_index}].time",
                        "rowIndex": row_index,
                        "problemIndex": problem_index,
                        "userId": _get_row_user_id(row),
                    }
                )
            for solution_index, solution in enumerate((status or {}).get("solutions") or []):
                if solution and solution.get("time"):
                    solution_times.append(
                        {
                            "value": solution.get("time"),
                            "path": f"rows[{row_index}].statuses[{problem_index}].solutions[{solution_index}].time",
                            "rowIndex": row_index,
                            "problemIndex": problem_index,
                            "userId": _get_row_user_id(row),
                        }
                    )
    sorter_config = (ranklist.get("sorter") or {}).get("config") if _is_icpc_sorter(ranklist) else None
    if (
        sorter_config
        and sorter_config.get("penalty")
        and not _parse_time_duration(sorter_config.get("penalty"))["valid"]
    ):
        add_issue(
            {
                "section": "summary",
                "code": "TIME_DURATION_INVALID",
                "message": "Invalid TimeDuration at sorter.config.penalty",
                "severity": "error",
                "confidence": "certain",
                "path": "sorter.config.penalty",
                "details": {"value": sorter_config.get("penalty")},
            }
        )
    return {
        "solutionTime": _detect_time_precision(solution_times, add_issue),
        "statusTime": _detect_time_precision(status_times, add_issue),
        "scoreTime": _detect_time_precision(score_times, add_issue),
    }


def _detect_time_precision(values: list[dict[str, Any]], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    declared_units: set[str] = set()
    non_zero_ms: list[float] = []
    sample_count = 0
    invalid_count = 0
    zero_count = 0
    for sample in values:
        parsed = _parse_time_duration(sample.get("value"))
        if not parsed["valid"]:
            invalid_count += 1
            issue = {
                "section": "summary",
                "code": "TIME_DURATION_INVALID",
                "message": f"Invalid TimeDuration at {sample.get('path')}",
                "severity": "error",
                "confidence": "certain",
                "path": sample.get("path"),
                "details": {"value": sample.get("value")},
            }
            for key in ("rowIndex", "problemIndex", "userId"):
                if key in sample:
                    issue[key] = sample[key]
            add_issue(issue)
            continue
        sample_count += 1
        declared_units.add(parsed["unit"])
        if _is_nearly_zero(parsed["ms"]):
            zero_count += 1
        else:
            non_zero_ms.append(parsed["ms"])
    actual_unit = None
    if non_zero_ms:
        actual_unit = next(
            (unit for unit in ACTUAL_UNIT_ORDER if all(_is_multiple_of(ms, TIME_UNIT_MS[unit]) for ms in non_zero_ms)),
            "ms",
        )
    return {
        "actualUnit": actual_unit,
        "declaredUnits": [unit for unit in TIME_UNITS if unit in declared_units],
        "sampleCount": sample_count,
        "invalidCount": invalid_count,
        "zeroCount": zero_count,
    }


def _build_completeness_items(ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    rows = ranklist.get("rows") or []
    problems = ranklist.get("problems") or []
    optional_items = {"banner", "userAvatar", "userPhoto"}
    low_severity_items = {*optional_items, "problemColors", "teamMembers", "coachRole"}

    def make_item(
        key: str,
        label: str,
        present_count: int,
        total_count: int,
        details: Optional[dict[str, Any]] = None,
        level_override: Optional[str] = None,
    ) -> dict[str, Any]:
        details = details or {}
        ratio = present_count / total_count if total_count > 0 else None
        level = level_override or _level_from_coverage(present_count, total_count)
        normalized_details = {**({"optional": True} if key in optional_items else {}), **details}
        if level not in ("complete", "notApplicable"):
            add_issue(
                {
                    "section": "completeness",
                    "item": key,
                    "code": f"COMPLETENESS_{_camel_to_constant(key)}",
                    "message": f"{label} completeness is {level}",
                    "severity": "info" if key in low_severity_items or level == "mostly" else "warning",
                    "confidence": "certain",
                    "details": {
                        "presentCount": present_count,
                        "totalCount": total_count,
                        "ratio": ratio,
                        **normalized_details,
                    },
                }
            )
        return {
            "key": key,
            "label": label,
            "level": level,
            "presentCount": present_count,
            "totalCount": total_count,
            "ratio": ratio,
            "details": normalized_details,
        }

    fb_problem_indexes = set()
    for row in rows:
        for problem_index, status in enumerate(row.get("statuses") or []):
            if status.get("result") == "FB" or any(
                solution.get("result") == "FB" for solution in status.get("solutions") or []
            ):
                fb_problem_indexes.add(problem_index)
    accepted_problem_indexes = _collect_accepted_problem_indexes(ranklist)
    no_accepted_problem_indexes = [index for index, _ in enumerate(problems) if index not in accepted_problem_indexes]
    expected_first_blood_problem_indexes = sorted(accepted_problem_indexes)
    present_first_blood_problem_count = sum(
        1 for index in expected_first_blood_problem_indexes if index in fb_problem_indexes
    )

    icpc_series_details = _get_icpc_series_details(ranklist.get("series") or [])
    for invalid_series in icpc_series_details["invalidSeries"]:
        add_issue(
            {
                "item": "icpcSeries",
                "code": "ICPC_SERIES_INVALID",
                "message": f"ICPC series configuration is invalid at series[{invalid_series['index']}]",
                "severity": invalid_series["severity"],
                "confidence": "certain",
                "path": f"series[{invalid_series['index']}].rule.options",
                "details": invalid_series,
            }
        )
    if icpc_series_details["icpcSeriesCount"] == 0:
        icpc_level = "missing"
    elif icpc_series_details["usableICPCSeriesCount"] == 0:
        icpc_level = "partial"
    elif icpc_series_details["incompleteSeries"]:
        icpc_level = "mostly"
    else:
        icpc_level = "complete"

    i18n_details = _collect_i18n_details(ranklist)
    status_rows_valid = sum(
        1 for row in rows if isinstance(row.get("statuses"), list) and len(row.get("statuses") or []) == len(problems)
    )
    solution_details = _collect_solution_completeness_details(ranklist)
    consistency_details = _collect_row_user_consistency_details(rows)

    return {
        "banner": make_item(
            "banner",
            "Contest banner",
            1 if (ranklist.get("contest") or {}).get("banner") else 0,
            1,
            {"hasBanner": bool((ranklist.get("contest") or {}).get("banner"))},
        ),
        "firstBlood": make_item(
            "firstBlood",
            "Problem first-blood declarations",
            present_first_blood_problem_count,
            len(expected_first_blood_problem_indexes),
            {
                "problemIndexes": sorted(fb_problem_indexes),
                "expectedProblemIndexes": expected_first_blood_problem_indexes,
                "noAcceptedProblemIndexes": no_accepted_problem_indexes,
            },
        ),
        "problemColors": make_item(
            "problemColors",
            "Problem background colors",
            sum(1 for problem in problems if ((problem.get("style") or {}).get("backgroundColor"))),
            len(problems),
        ),
        "icpcSeries": make_item(
            "icpcSeries",
            "ICPC series configuration",
            icpc_series_details["usableICPCSeriesCount"],
            icpc_series_details["icpcSeriesCount"] or 1,
            icpc_series_details,
            icpc_level,
        ),
        "userAvatar": make_item(
            "userAvatar", "User avatars", sum(1 for row in rows if (row.get("user") or {}).get("avatar")), len(rows)
        ),
        "userPhoto": make_item(
            "userPhoto", "User photos", sum(1 for row in rows if (row.get("user") or {}).get("photo")), len(rows)
        ),
        "teamMembers": make_item(
            "teamMembers",
            "Team member information",
            sum(1 for row in rows if (row.get("user") or {}).get("teamMembers")),
            len(rows),
        ),
        "coachRole": make_item(
            "coachRole",
            "Coach team member role",
            sum(
                1
                for row in rows
                if any(member.get("role") == "coach" for member in (row.get("user") or {}).get("teamMembers") or [])
            ),
            len(rows),
        ),
        "i18n": make_item(
            "i18n", "i18n text coverage", i18n_details["i18nCount"], i18n_details["totalTextCount"], i18n_details
        ),
        "statuses": make_item(
            "statuses",
            "Problem status arrays",
            status_rows_valid,
            len(rows),
            {
                "problemCount": len(problems),
                "invalidRows": [
                    {
                        "rowIndex": index,
                        "length": len(row.get("statuses")) if isinstance(row.get("statuses"), list) else None,
                    }
                    for index, row in enumerate(rows)
                    if (len(row.get("statuses")) if isinstance(row.get("statuses"), list) else None) != len(problems)
                ],
            },
        ),
        "solutions": make_item(
            "solutions",
            "Submission solution histories",
            solution_details["statusesWithSolutions"],
            solution_details["submittedStatuses"],
            solution_details,
            "notApplicable"
            if solution_details["submittedStatuses"] == 0
            else _level_from_coverage(solution_details["statusesWithSolutions"], solution_details["submittedStatuses"]),
        ),
        "rowUserConsistency": make_item(
            "rowUserConsistency",
            "Row user field consistency",
            consistency_details["rowsWithAllFields"],
            len(rows),
            consistency_details,
            "notApplicable"
            if len(rows) <= 1
            else _level_from_coverage(consistency_details["rowsWithAllFields"], len(rows)),
        ),
    }


def _check_first_blood(
    ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None], suggestions: list[dict[str, Any]]
) -> dict[str, Any]:
    if not _is_icpc_sorter(ranklist):
        return _make_check(
            "firstBlood", "First-blood declarations", "notApplicable", 0, 0, {"reason": "Ranklist sorter is not ICPC"}
        )
    failed_count = 0
    checked_count = 0
    for problem_index, _ in enumerate(ranklist.get("problems") or []):
        declared_cells = _collect_declared_first_blood_cells(ranklist, problem_index)
        accepted_solutions = _collect_accepted_solutions(ranklist, problem_index)
        unique_earliest = _get_unique_earliest_accepted_solution(accepted_solutions)
        if len(declared_cells) > 1:
            failed_count += 1
            message = f"Problem {_problem_label(ranklist, problem_index)} has multiple first-blood declarations"
            add_issue(
                {
                    "code": "FIRST_BLOOD_MULTIPLE",
                    "message": message,
                    "severity": "error",
                    "confidence": "certain",
                    "item": "firstBlood",
                    "problemIndex": problem_index,
                    "details": {"declarations": declared_cells},
                }
            )
        if not accepted_solutions:
            continue
        checked_count += 1
        if not unique_earliest:
            continue
        if not declared_cells:
            failed_count += 1
            confidence = "high" if unique_earliest["source"] == "solution" else "medium"
            message = (
                f"Problem {_problem_label(ranklist, problem_index)} has a unique earliest accepted solution "
                "but no first-blood declaration"
            )
            add_issue(
                {
                    "code": "FIRST_BLOOD_MISSING",
                    "message": message,
                    "severity": "warning",
                    "confidence": confidence,
                    "item": "firstBlood",
                    "problemIndex": problem_index,
                    "rowIndex": unique_earliest["rowIndex"],
                    "userId": unique_earliest["userId"],
                }
            )
            _push_first_blood_suggestion(ranklist, suggestions, problem_index, unique_earliest)
            continue
        declared = declared_cells[0]
        if declared["rowIndex"] != unique_earliest["rowIndex"]:
            failed_count += 1
            confidence = "high" if unique_earliest["source"] == "solution" else "medium"
            message = (
                f"Problem {_problem_label(ranklist, problem_index)} first-blood declaration conflicts with "
                "the earliest accepted solution"
            )
            add_issue(
                {
                    "code": "FIRST_BLOOD_CONFLICT",
                    "message": message,
                    "severity": "error",
                    "confidence": confidence,
                    "item": "firstBlood",
                    "problemIndex": problem_index,
                    "rowIndex": declared["rowIndex"],
                    "userId": declared["userId"],
                    "details": {"declared": declared, "expected": unique_earliest},
                }
            )
            _push_first_blood_suggestion(ranklist, suggestions, problem_index, unique_earliest)
        elif len(declared_cells) > 1:
            _push_first_blood_suggestion(ranklist, suggestions, problem_index, unique_earliest)
    return _make_check(
        "firstBlood",
        "First-blood declarations",
        "fail" if failed_count else "pass",
        checked_count,
        failed_count,
        {"suggestionCount": len(suggestions)},
    )


def _check_problem_statistics(
    ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None], suggestions: list[dict[str, Any]]
) -> dict[str, Any]:
    config = _get_sorter_config(ranklist) if _is_icpc_sorter(ranklist) else None
    expected = _calculate_problem_statistics_from_best_available_data(ranklist, config)
    mismatches = _collect_problem_statistics_mismatches(ranklist, config, expected)
    if config:
        suggestions.extend(_collect_problem_statistics_suggestions(ranklist, config, mismatches))
    checked_count = _count_problems_with_statistics(ranklist)
    for mismatch in mismatches:
        message = (
            f"Problem {_problem_label(ranklist, mismatch['problemIndex'])} statistics do not match row statuses"
        )
        add_issue(
            {
                "code": "PROBLEM_STATISTICS_MISMATCH",
                "message": message,
                "severity": "error",
                "confidence": "certain",
                "item": "problemStatistics",
                "problemIndex": mismatch["problemIndex"],
                "path": f"problems[{mismatch['problemIndex']}].statistics",
                "details": mismatch,
            }
        )
    return _make_check(
        "problemStatistics",
        "Problem statistics",
        "notApplicable" if checked_count == 0 else ("fail" if mismatches else "pass"),
        checked_count,
        len(mismatches),
        {"expected": expected},
    )


def _check_statuses(ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    problem_count = len(ranklist.get("problems") or [])
    mismatches = []
    for row_index, row in enumerate(ranklist.get("rows") or []):
        actual_length = len(row.get("statuses")) if isinstance(row.get("statuses"), list) else None
        if actual_length != problem_count:
            mismatches.append(
                {
                    "rowIndex": row_index,
                    "userId": _get_row_user_id(row),
                    "expectedLength": problem_count,
                    "actualLength": actual_length,
                }
            )
    for mismatch in mismatches:
        add_issue(
            {
                "code": "STATUSES_LENGTH_MISMATCH",
                "message": f"Row statuses length does not match problems length for user {mismatch['userId']}",
                "severity": "error",
                "confidence": "certain",
                "item": "statuses",
                "rowIndex": mismatch["rowIndex"],
                "userId": mismatch["userId"],
                "path": f"rows[{mismatch['rowIndex']}].statuses",
                "details": mismatch,
            }
        )
    return _make_check(
        "statuses",
        "Problem status array lengths",
        "fail" if mismatches else "pass",
        len(ranklist.get("rows") or []),
        len(mismatches),
        {"problemCount": problem_count, "mismatches": mismatches},
    )


def _check_mock_solutions(ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    examples = []
    checked_count = 0
    suspicious_count = 0
    for row_index, row in enumerate(ranklist.get("rows") or []):
        for problem_index, status in enumerate(row.get("statuses") or []):
            rj_times = []
            for solution in status.get("solutions") or []:
                if solution.get("result") == "RJ":
                    parsed = _parse_time_duration(solution.get("time"))
                    if parsed["valid"]:
                        rj_times.append(parsed["ms"])
            if len(rj_times) < 2:
                continue
            checked_count += 1
            pattern = _detect_mock_time_pattern(rj_times)
            if pattern:
                suspicious_count += 1
                examples.append(
                    {
                        "rowIndex": row_index,
                        "problemIndex": problem_index,
                        "userId": _get_row_user_id(row),
                        "pattern": pattern,
                        "count": len(rj_times),
                    }
                )
    ratio = suspicious_count / checked_count if checked_count else 0
    confidence = "high" if suspicious_count >= 2 and ratio >= 0.8 else ("medium" if suspicious_count else "low")
    if suspicious_count:
        add_issue(
            {
                "code": "MOCK_SOLUTIONS_SUSPECTED",
                "message": "Rejected solution timestamps look synthetically expanded from status summaries",
                "severity": "warning" if confidence == "high" else "info",
                "confidence": confidence,
                "item": "mockSolutions",
                "details": {
                    "checkedCount": checked_count,
                    "suspiciousCount": suspicious_count,
                    "ratio": ratio,
                    "examples": examples,
                },
            }
        )
    return _make_check(
        "mockSolutions",
        "Mock solution expansion",
        "notApplicable" if checked_count == 0 else ("warning" if suspicious_count else "pass"),
        checked_count,
        suspicious_count,
        {"suspiciousCount": suspicious_count, "ratio": ratio, "examples": examples},
    )


def _check_status_summaries(ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    if not _is_icpc_sorter(ranklist):
        return _make_check(
            "statusSummaries",
            "Status summaries from solutions",
            "notApplicable",
            0,
            0,
            {"reason": "Ranklist sorter is not ICPC"},
        )
    config = _get_sorter_config(ranklist)
    mismatches = _collect_status_summary_mismatches(ranklist, config)
    for mismatch in mismatches:
        message = (
            "Status summary does not match detailed solutions for problem "
            f"{_problem_label(ranklist, mismatch['problemIndex'])}"
        )
        add_issue(
            {
                "code": "STATUS_SUMMARY_MISMATCH",
                "message": message,
                "severity": "warning",
                "confidence": "high",
                "item": "statusSummaries",
                "rowIndex": mismatch["rowIndex"],
                "problemIndex": mismatch["problemIndex"],
                "userId": mismatch["userId"],
                "path": f"rows[{mismatch['rowIndex']}].statuses[{mismatch['problemIndex']}]",
                "details": mismatch,
            }
        )
    checked_count = _count_statuses_with_solutions(ranklist)
    return _make_check(
        "statusSummaries",
        "Status summaries from solutions",
        "notApplicable" if checked_count == 0 else ("warning" if mismatches else "pass"),
        checked_count,
        len(mismatches),
        {"mismatches": mismatches},
    )


def _check_scores(ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    if not _is_icpc_sorter(ranklist):
        return _make_check(
            "scores", "ICPC score calculation", "notApplicable", 0, 0, {"reason": "Ranklist sorter is not ICPC"}
        )
    config = _get_sorter_config(ranklist)
    mismatches = _collect_score_mismatches(ranklist, config)
    for mismatch in mismatches:
        add_issue(
            {
                "code": "SCORE_MISMATCH",
                "message": f"Row score does not match status calculation for user {mismatch['userId']}",
                "severity": "error",
                "confidence": "certain",
                "item": "scores",
                "rowIndex": mismatch["rowIndex"],
                "userId": mismatch["userId"],
                "path": f"rows[{mismatch['rowIndex']}].score",
                "details": mismatch,
            }
        )
    return _make_check(
        "scores",
        "ICPC score calculation",
        "fail" if mismatches else "pass",
        len(ranklist.get("rows") or []),
        len(mismatches),
        {"mismatches": mismatches},
    )


def _check_row_order(ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    if not _is_icpc_sorter(ranklist):
        return _make_check(
            "rowOrder", "ICPC row order", "notApplicable", 0, 0, {"reason": "Ranklist sorter is not ICPC"}
        )
    expected_order = [_get_row_user_id(row) for row in sort_rows(copy.deepcopy(ranklist.get("rows") or []))]
    mismatches = _collect_row_order_mismatches(ranklist)
    for mismatch in mismatches:
        add_issue(
            {
                "code": "ROW_ORDER_MISMATCH",
                "message": f"Rows {mismatch['rowIndex']} and {mismatch['nextRowIndex']} are out of ICPC score order",
                "severity": "error",
                "confidence": "certain",
                "item": "rowOrder",
                "rowIndex": mismatch["rowIndex"],
                "userId": mismatch["userId"],
                "details": mismatch,
            }
        )
    rows = ranklist.get("rows") or []
    return _make_check(
        "rowOrder",
        "ICPC row order",
        "fail" if mismatches else "pass",
        max(0, len(rows) - 1),
        len(mismatches),
        {"expectedOrder": expected_order, "mismatches": mismatches},
    )


def _check_sorter_config(
    ranklist: dict[str, Any],
    precision: dict[str, Any],
    add_issue: Callable[[dict[str, Any]], None],
    suggestions: list[dict[str, Any]],
) -> dict[str, Any]:
    if not _is_icpc_sorter(ranklist):
        return _make_check(
            "sorterConfig", "Sorter configuration", "notApplicable", 0, 0, {"reason": "Ranklist sorter is not ICPC"}
        )
    current = _get_sorter_config(ranklist)
    baseline = _evaluate_sorter_config(ranklist, current)
    if baseline["issueCount"] == 0:
        return _make_check(
            "sorterConfig", "Sorter configuration", "pass", baseline["checkedCount"], 0, {"baseline": baseline}
        )
    candidate_suggestions = _collect_sorter_suggestions(ranklist, current, precision, baseline)
    suggestions.extend(candidate_suggestions)
    if candidate_suggestions:
        add_issue(
            {
                "code": "SORTER_CONFIG_MISMATCH",
                "message": "Alternative sorter configuration matches the declared ranklist better",
                "severity": "warning",
                "confidence": candidate_suggestions[0]["confidence"],
                "item": "sorterConfig",
                "details": {"baseline": baseline, "suggestions": candidate_suggestions},
            }
        )
    return _make_check(
        "sorterConfig",
        "Sorter configuration",
        "warning" if candidate_suggestions else "fail",
        baseline["checkedCount"],
        baseline["issueCount"],
        {"baseline": baseline, "suggestions": candidate_suggestions},
    )


def _check_markers(ranklist: dict[str, Any], add_issue: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    marker_ids = {marker.get("id") for marker in ranklist.get("markers") or []}
    checked_count = 0
    failed_count = 0
    for row_index, row in enumerate(ranklist.get("rows") or []):
        for marker_id in _collect_row_marker_ids(row.get("user") or {}):
            checked_count += 1
            if marker_id not in marker_ids:
                failed_count += 1
                add_issue(
                    {
                        "code": "MARKER_UNDECLARED",
                        "message": f'User marker "{marker_id}" is not declared in ranklist.markers',
                        "severity": "warning",
                        "confidence": "certain",
                        "item": "markers",
                        "rowIndex": row_index,
                        "userId": _get_row_user_id(row),
                        "path": f"rows[{row_index}].user",
                        "details": {"markerId": marker_id},
                    }
                )
    for series_index, series_config in enumerate(ranklist.get("series") or []):
        rule = series_config.get("rule") or {}
        if rule.get("preset") != "ICPC":
            continue
        by_marker = ((rule.get("options") or {}).get("filter") or {}).get("byMarker")
        if not by_marker:
            continue
        checked_count += 1
        if by_marker not in marker_ids:
            failed_count += 1
            add_issue(
                {
                    "code": "MARKER_UNDECLARED",
                    "message": f'Series marker filter "{by_marker}" is not declared in ranklist.markers',
                    "severity": "warning",
                    "confidence": "certain",
                    "item": "markers",
                    "path": f"series[{series_index}].rule.options.filter.byMarker",
                    "details": {"markerId": by_marker, "seriesIndex": series_index},
                }
            )
    return _make_check(
        "markers",
        "Marker declarations",
        "notApplicable" if checked_count == 0 else ("fail" if failed_count else "pass"),
        checked_count,
        failed_count,
        {"declaredMarkerIds": list(marker_ids)},
    )


def _collect_status_summary_mismatches(ranklist: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    mismatches = []
    for row_index, row in enumerate(ranklist.get("rows") or []):
        for problem_index, status in enumerate(row.get("statuses") or []):
            if not status.get("solutions"):
                continue
            expected = _calculate_status_summary_from_solutions(status.get("solutions") or [], config)
            current = _normalize_status_summary(status)
            mismatch_reasons = []
            if current.get("result") != expected.get("result"):
                mismatch_reasons.append("result")
            if current.get("tries") != expected.get("tries"):
                mismatch_reasons.append("tries")
            if not _same_status_summary_optional_time(current.get("time"), expected.get("time")):
                mismatch_reasons.append("time")
            if mismatch_reasons:
                mismatches.append(
                    {
                        "rowIndex": row_index,
                        "problemIndex": problem_index,
                        "userId": _get_row_user_id(row),
                        "actual": current,
                        "expected": expected,
                        "solutions": [solution.get("result") for solution in status.get("solutions") or []],
                        "mismatchReasons": mismatch_reasons,
                    }
                )
    return mismatches


def _calculate_problem_statistics_from_best_available_data(
    ranklist: dict[str, Any], config: Optional[dict[str, Any]] = None
) -> list[dict[str, int]]:
    problem_count = len(ranklist.get("problems") or [])
    accepted = [0] * problem_count
    submitted = [0] * problem_count
    for row in ranklist.get("rows") or []:
        for problem_index in range(problem_count):
            status = (
                (row.get("statuses") or [None] * problem_count)[problem_index]
                if problem_index < len(row.get("statuses") or [])
                else None
            )
            if not status:
                continue
            if config and status.get("solutions"):
                summary = _calculate_status_summary_from_solutions(status.get("solutions") or [], config)
            else:
                summary = _normalize_status_summary(status)
            if summary.get("result") in ("AC", "FB"):
                accepted[problem_index] += 1
            if config and status.get("solutions"):
                submitted[problem_index] += summary.get("tries") or 0
            elif status.get("solutions"):
                submitted[problem_index] += len(status.get("solutions") or [])
            else:
                submitted[problem_index] += status.get("tries") or 0
    return [
        {"accepted": accepted[index], "submitted": submitted[index]}
        for index, _ in enumerate(ranklist.get("problems") or [])
    ]


def _collect_problem_statistics_mismatches(
    ranklist: dict[str, Any], config: Optional[dict[str, Any]] = None, expected: Optional[list[dict[str, int]]] = None
) -> list[dict[str, Any]]:
    expected = expected or _calculate_problem_statistics_from_best_available_data(ranklist, config)
    mismatches = []
    for problem_index, problem in enumerate(ranklist.get("problems") or []):
        if not problem.get("statistics"):
            continue
        actual = problem["statistics"]
        expected_statistics = expected[problem_index]
        if (
            actual.get("accepted") != expected_statistics["accepted"]
            or actual.get("submitted") != expected_statistics["submitted"]
        ):
            mismatches.append({"problemIndex": problem_index, "actual": actual, "expected": expected_statistics})
    return mismatches


def _collect_problem_statistics_suggestions(
    ranklist: dict[str, Any], config: dict[str, Any], mismatches: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    removed_results = [
        result for result in PROBLEM_STATISTICS_SUSPECT_NO_PENALTY_RESULTS if result in config["noPenaltyResults"]
    ]
    if not removed_results or not mismatches:
        return []
    suspect_config = {
        **config,
        "noPenaltyResults": [
            result
            for result in config["noPenaltyResults"]
            if result not in PROBLEM_STATISTICS_SUSPECT_NO_PENALTY_RESULTS
        ],
    }
    suspect_statistics = _calculate_problem_statistics_from_best_available_data(ranklist, suspect_config)
    suggestions = []
    for mismatch in mismatches:
        problem_index = mismatch["problemIndex"]
        if _same_problem_statistics(suspect_statistics[problem_index], mismatch["actual"]):
            problem = (ranklist.get("problems") or [])[problem_index]
            suggestions.append(
                {
                    "problemIndex": problem_index,
                    "problemAlias": problem.get("alias"),
                    "actual": mismatch["actual"],
                    "expected": mismatch["expected"],
                    "confidence": "high",
                    "reason": "declared statistics match a calculation where CE/NOUT/UKE count as penalty submissions",
                    "details": {"withoutNoPenaltyResults": list(PROBLEM_STATISTICS_SUSPECT_NO_PENALTY_RESULTS)},
                }
            )
    return suggestions


def _collect_score_mismatches(ranklist: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    mismatches = []
    for row_index, row in enumerate(ranklist.get("rows") or []):
        expected = _calculate_score_from_statuses(row.get("statuses") or [], config)
        if expected is None:
            continue
        score = row.get("score") or {}
        current_time = (
            _parse_time_duration(score.get("time"))
            if score.get("time")
            else {"valid": True, "value": 0, "unit": "ms", "ms": 0}
        )
        expected_time = _parse_time_duration(expected.get("time"))
        current_ms = current_time.get("ms") if current_time["valid"] else math.nan
        expected_ms = expected_time.get("ms") if expected_time["valid"] else math.nan
        mismatch_reasons = []
        if score.get("value") != expected.get("value"):
            mismatch_reasons.append("value")
        if not _is_nearly_equal(current_ms, expected_ms):
            mismatch_reasons.append("time")
        if mismatch_reasons:
            mismatches.append(
                {
                    "rowIndex": row_index,
                    "userId": _get_row_user_id(row),
                    "actual": score,
                    "expected": expected,
                    "mismatchReasons": mismatch_reasons,
                }
            )
    return mismatches


def _collect_status_tries_mismatches(ranklist: dict[str, Any], config: dict[str, Any]) -> list[dict[str, Any]]:
    mismatches = []
    for row_index, row in enumerate(ranklist.get("rows") or []):
        for problem_index, status in enumerate(row.get("statuses") or []):
            if not status.get("solutions"):
                continue
            expected = _calculate_status_summary_from_solutions(status.get("solutions") or [], config)
            current = _normalize_status_summary(status)
            if current.get("tries") != expected.get("tries"):
                mismatches.append(
                    {
                        "rowIndex": row_index,
                        "problemIndex": problem_index,
                        "userId": _get_row_user_id(row),
                        "actual": current,
                        "expected": expected,
                        "mismatchReasons": ["tries"],
                    }
                )
    return mismatches


def _collect_row_order_mismatches(ranklist: dict[str, Any]) -> list[dict[str, Any]]:
    mismatches = []
    rows = ranklist.get("rows") or []
    for row_index in range(max(0, len(rows) - 1)):
        current = rows[row_index]
        next_row = rows[row_index + 1]
        if _compare_rows_by_score(current, next_row) > 0:
            mismatches.append(
                {
                    "rowIndex": row_index,
                    "nextRowIndex": row_index + 1,
                    "userId": _get_row_user_id(current),
                    "nextUserId": _get_row_user_id(next_row),
                    "currentScore": current.get("score"),
                    "nextScore": next_row.get("score"),
                }
            )
    return mismatches


def _evaluate_sorter_config(ranklist: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    status_summary_mismatch_count = len(_collect_status_summary_mismatches(ranklist, config))
    problem_statistics_mismatch_count = len(_collect_problem_statistics_mismatches(ranklist, config))
    tries_mismatch_count = len(_collect_status_tries_mismatches(ranklist, config))
    score_mismatch_count = len(_collect_score_mismatches(ranklist, config))
    row_order_mismatch_count = len(_collect_row_order_mismatches(ranklist))
    issue_count = (
        status_summary_mismatch_count
        + problem_statistics_mismatch_count
        + score_mismatch_count
        + row_order_mismatch_count
    )
    rows = ranklist.get("rows") or []
    return {
        "statusSummaryMismatchCount": status_summary_mismatch_count,
        "problemStatisticsMismatchCount": problem_statistics_mismatch_count,
        "triesMismatchCount": tries_mismatch_count,
        "statusMismatchCount": tries_mismatch_count,
        "scoreMismatchCount": score_mismatch_count,
        "rowOrderMismatchCount": row_order_mismatch_count,
        "issueCount": issue_count,
        "checkedCount": _count_statuses_with_solutions(ranklist)
        + _count_problems_with_statistics(ranklist)
        + len(rows)
        + max(0, len(rows) - 1),
    }


def _collect_sorter_suggestions(
    ranklist: dict[str, Any], current: dict[str, Any], precision: dict[str, Any], baseline: dict[str, Any]
) -> list[dict[str, Any]]:
    candidates = []
    time_precision_candidates = _unique_values(
        [
            current.get("timePrecision"),
            precision["statusTime"].get("actualUnit"),
            precision["solutionTime"].get("actualUnit"),
            "ms",
            "s",
            "min",
        ]
    )
    rounding_candidates = ["floor", "ceil", "round"]
    no_penalty_candidates = _unique_no_penalty_candidates(current["noPenaltyResults"])
    for time_precision in time_precision_candidates:
        for time_rounding in rounding_candidates:
            for no_penalty_results in no_penalty_candidates:
                candidates.append(
                    {
                        **current,
                        "timePrecision": time_precision,
                        "timeRounding": time_rounding,
                        "noPenaltyResults": no_penalty_results,
                    }
                )

    evaluated = []
    for candidate in candidates:
        evaluation = _evaluate_sorter_config(ranklist, candidate)
        if evaluation["issueCount"] < baseline["issueCount"]:
            evaluated.append({"candidate": candidate, "evaluation": evaluation})

    def sorter_key(item: dict[str, Any]) -> tuple[Any, ...]:
        candidate = item["candidate"]
        evaluation = item["evaluation"]
        return (
            evaluation["issueCount"],
            -_sorter_issue_reduction(baseline, evaluation),
            _no_penalty_difference_size(current["noPenaltyResults"], candidate["noPenaltyResults"]),
            _sorter_config_patch_size(current, candidate),
            json.dumps(_build_sorter_config_patch(current, candidate), separators=(",", ":"), sort_keys=True),
        )

    suggestions = []
    seen = set()
    for item in sorted(evaluated, key=sorter_key):
        patch = _build_sorter_config_patch(current, item["candidate"])
        key = json.dumps(patch, separators=(",", ":"), sort_keys=True)
        if not patch or key in seen:
            continue
        seen.add(key)
        suggestions.append(
            {
                "config": patch,
                "confidence": _sorter_suggestion_confidence(baseline, item["evaluation"]),
                "resolvedIssues": _describe_resolved_sorter_issues(baseline, item["evaluation"]),
                "details": {"baseline": baseline, "evaluation": item["evaluation"]},
            }
        )
    return suggestions[:5]


def _build_sorter_config_patch(current: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    patch = {}
    if candidate.get("timePrecision") != current.get("timePrecision"):
        patch["timePrecision"] = candidate.get("timePrecision")
    if candidate.get("timeRounding") != current.get("timeRounding"):
        patch["timeRounding"] = candidate.get("timeRounding")
    if not _same_no_penalty_results(candidate["noPenaltyResults"], current["noPenaltyResults"]):
        patch["noPenaltyResults"] = candidate["noPenaltyResults"]
    return patch


def _sorter_config_patch_size(current: dict[str, Any], candidate: dict[str, Any]) -> int:
    return len(_build_sorter_config_patch(current, candidate))


def _describe_resolved_sorter_issues(baseline: dict[str, Any], evaluation: dict[str, Any]) -> list[str]:
    resolved = []
    if evaluation["statusSummaryMismatchCount"] < baseline["statusSummaryMismatchCount"]:
        resolved.append("statusSummaries")
    if evaluation["problemStatisticsMismatchCount"] < baseline["problemStatisticsMismatchCount"]:
        resolved.append("problemStatistics")
    if evaluation["triesMismatchCount"] < baseline["triesMismatchCount"]:
        resolved.append("statusTries")
    if evaluation["scoreMismatchCount"] < baseline["scoreMismatchCount"]:
        resolved.append("scores")
    if evaluation["rowOrderMismatchCount"] < baseline["rowOrderMismatchCount"]:
        resolved.append("rowOrder")
    return resolved


def _sorter_issue_reduction(baseline: dict[str, Any], evaluation: dict[str, Any]) -> int:
    return baseline["issueCount"] - evaluation["issueCount"]


def _sorter_suggestion_confidence(baseline: dict[str, Any], evaluation: dict[str, Any]) -> str:
    if evaluation["issueCount"] == 0:
        return "high"
    reduction = _sorter_issue_reduction(baseline, evaluation)
    ratio = reduction / baseline["issueCount"] if baseline["issueCount"] else 0
    solved_category = (
        (baseline["statusSummaryMismatchCount"] > 0 and evaluation["statusSummaryMismatchCount"] == 0)
        or (baseline["problemStatisticsMismatchCount"] > 0 and evaluation["problemStatisticsMismatchCount"] == 0)
        or (baseline["triesMismatchCount"] > 0 and evaluation["triesMismatchCount"] == 0)
        or (baseline["scoreMismatchCount"] > 0 and evaluation["scoreMismatchCount"] == 0)
        or (baseline["rowOrderMismatchCount"] > 0 and evaluation["rowOrderMismatchCount"] == 0)
    )
    if solved_category and ratio >= 0.25:
        return "medium"
    return "low"


def _no_penalty_difference_size(left: list[Any], right: list[Any]) -> int:
    left_keys = {_no_penalty_result_key(item) for item in left}
    right_keys = {_no_penalty_result_key(item) for item in right}
    return len(left_keys - right_keys) + len(right_keys - left_keys)


def _no_penalty_result_key(result: Any) -> str:
    return "__null__" if result is None else f"value:{result}"


def _unique_no_penalty_candidates(_current: list[Any]) -> list[list[Any]]:
    candidates = []
    optional_count = len(SORTER_NO_PENALTY_OPTIONAL_RESULTS)
    for mask in range(1 << optional_count):
        optional_results = [
            result for index, result in enumerate(SORTER_NO_PENALTY_OPTIONAL_RESULTS) if mask & (1 << index)
        ]
        candidates.append([*SORTER_NO_PENALTY_BASE_RESULTS, *optional_results, None])
    seen = set()
    unique = []
    for candidate in candidates:
        key = json.dumps(candidate, separators=(",", ":"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _calculate_status_summary_from_solutions(solutions: list[dict[str, Any]], config: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"result": None, "tries": 0}
    for solution in solutions:
        result = solution.get("result")
        if result is None:
            continue
        is_no_penalty_result = result in config["noPenaltyResults"]
        if result == "?":
            summary["result"] = "?"
            if not is_no_penalty_result:
                summary["tries"] += 1
            continue
        if result in ("AC", "FB"):
            summary["result"] = result
            summary["time"] = solution.get("time")
            summary["tries"] += 1
            break
        if is_no_penalty_result:
            continue
        summary["result"] = "RJ"
        summary["tries"] += 1
    return summary


def _calculate_score_from_statuses(statuses: list[dict[str, Any]], config: dict[str, Any]) -> Optional[dict[str, Any]]:
    penalty_ms = _safe_format_time_duration(config["penalty"], "ms")
    if penalty_ms is None:
        return None
    value = 0
    time_ms = 0
    for status in statuses:
        if status.get("result") in ("AC", "FB") and status.get("time"):
            time_precision = config.get("timePrecision") or "ms"
            target_time_value = _safe_format_time_duration(
                status.get("time"), time_precision, _rounding_fn(config["timeRounding"])
            )
            if target_time_value is None:
                return None
            target_time = [target_time_value, time_precision]
            value += 1
            time_ms += (
                format_time_duration(target_time, "ms") + max(0, _get_declared_accepted_tries(status) - 1) * penalty_ms
            )
    return {"value": value, "time": [time_ms, "ms"]}


def _get_declared_accepted_tries(status: dict[str, Any]) -> int:
    return status.get("tries") or 1


def _normalize_status_summary(status: dict[str, Any]) -> dict[str, Any]:
    result = {"result": status.get("result") if "result" in status else None, "tries": status.get("tries") or 0}
    if "time" in status:
        result["time"] = status.get("time")
    return result


def _get_sorter_config(ranklist: dict[str, Any]) -> dict[str, Any]:
    raw_config = ((ranklist.get("sorter") or {}).get("config") or {}) if _is_icpc_sorter(ranklist) else {}
    raw_rounding = raw_config.get("timeRounding")
    time_rounding = raw_rounding if raw_rounding in ("ceil", "round", "floor") else "floor"
    return {
        "penalty": raw_config.get("penalty") or [20, "min"],
        "noPenaltyResults": copy.deepcopy(raw_config.get("noPenaltyResults"))
        if isinstance(raw_config.get("noPenaltyResults"), list)
        else list(DEFAULT_NO_PENALTY_RESULTS),
        "timePrecision": raw_config.get("timePrecision") if raw_config.get("timePrecision") in TIME_UNITS else None,
        "timeRounding": time_rounding,
    }


def _compare_rows_by_score(a: dict[str, Any], b: dict[str, Any]) -> float:
    a_score = a.get("score") or {}
    b_score = b.get("score") or {}
    if a_score.get("value") != b_score.get("value"):
        return (b_score.get("value") or 0) - (a_score.get("value") or 0)
    time_a = _parse_time_duration(a_score.get("time")) if a_score.get("time") else {"valid": True, "ms": 0}
    time_b = _parse_time_duration(b_score.get("time")) if b_score.get("time") else {"valid": True, "ms": 0}
    if not time_a["valid"] or not time_b["valid"]:
        return 0
    return time_a["ms"] - time_b["ms"]


def _collect_declared_first_blood_cells(ranklist: dict[str, Any], problem_index: int) -> list[dict[str, Any]]:
    cells: dict[str, dict[str, Any]] = {}
    for row_index, row in enumerate(ranklist.get("rows") or []):
        statuses = row.get("statuses") or []
        status = statuses[problem_index] if problem_index < len(statuses) else None
        if not status:
            continue
        key = f"{row_index}:{problem_index}"

        def add(
            source: str,
            time: Optional[Any] = None,
            solution_index: Optional[int] = None,
            cell_key: str = key,
            cell_row_index: int = row_index,
            cell_row: dict[str, Any] = row,
        ) -> None:
            current = cells.get(
                cell_key,
                {
                    "rowIndex": cell_row_index,
                    "problemIndex": problem_index,
                    "userId": _get_row_user_id(cell_row),
                    "sources": [],
                },
            )
            current["sources"].append(source)
            if time is not None:
                current["time"] = time
            if solution_index is not None:
                current["solutionIndex"] = solution_index
            cells[cell_key] = current

        if status.get("result") == "FB":
            add("status", status.get("time"))
        for solution_index, solution in enumerate(status.get("solutions") or []):
            if solution.get("result") == "FB":
                add("solution", solution.get("time"), solution_index)
    return list(cells.values())


def _collect_accepted_problem_indexes(ranklist: dict[str, Any]) -> set[int]:
    indexes = set()
    for problem_index, problem in enumerate(ranklist.get("problems") or []):
        if ((problem.get("statistics") or {}).get("accepted") or 0) > 0:
            indexes.add(problem_index)
    for row in ranklist.get("rows") or []:
        for problem_index, status in enumerate(row.get("statuses") or []):
            if status.get("result") in ("AC", "FB"):
                indexes.add(problem_index)
                continue
            if any(solution.get("result") in ("AC", "FB") for solution in status.get("solutions") or []):
                indexes.add(problem_index)
    return indexes


def _collect_accepted_solutions(ranklist: dict[str, Any], problem_index: int) -> list[dict[str, Any]]:
    accepted = []
    for row_index, row in enumerate(ranklist.get("rows") or []):
        statuses = row.get("statuses") or []
        status = statuses[problem_index] if problem_index < len(statuses) else None
        solutions = (status or {}).get("solutions") or []
        if solutions:
            for solution_index, solution in enumerate(solutions):
                if solution.get("result") not in ("AC", "FB"):
                    continue
                parsed = _parse_time_duration(solution.get("time"))
                if not parsed["valid"]:
                    continue
                accepted.append(
                    {
                        "rowIndex": row_index,
                        "problemIndex": problem_index,
                        "solutionIndex": solution_index,
                        "userId": _get_row_user_id(row),
                        "result": solution.get("result"),
                        "source": "solution",
                        "time": solution.get("time"),
                        "ms": parsed["ms"],
                    }
                )
            continue
        if not status or status.get("result") not in ("AC", "FB") or not status.get("time"):
            continue
        parsed = _parse_time_duration(status.get("time"))
        if not parsed["valid"]:
            continue
        accepted.append(
            {
                "rowIndex": row_index,
                "problemIndex": problem_index,
                "solutionIndex": -1,
                "userId": _get_row_user_id(row),
                "result": status.get("result"),
                "source": "status",
                "time": status.get("time"),
                "ms": parsed["ms"],
            }
        )
    return sorted(accepted, key=lambda item: item["ms"])


def _get_unique_earliest_accepted_solution(accepted_solutions: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not accepted_solutions:
        return None
    if len(accepted_solutions) > 1 and _is_nearly_equal(accepted_solutions[0]["ms"], accepted_solutions[1]["ms"]):
        return None
    return accepted_solutions[0]


def _push_first_blood_suggestion(
    ranklist: dict[str, Any], suggestions: list[dict[str, Any]], problem_index: int, accepted: dict[str, Any]
) -> None:
    if any(suggestion["problemIndex"] == problem_index for suggestion in suggestions):
        return
    problem = (ranklist.get("problems") or [])[problem_index]
    suggestions.append(
        {
            "problemIndex": problem_index,
            "problemAlias": problem.get("alias"),
            "userId": accepted["userId"],
            "rowIndex": accepted["rowIndex"],
            "time": accepted["time"],
        }
    )


def _collect_solution_completeness_details(ranklist: dict[str, Any]) -> dict[str, Any]:
    submitted_statuses = 0
    statuses_with_solutions = 0
    solution_count = 0
    exact_result_count = 0
    lite_result_count = 0
    predefined_full_only_result_count = 0
    custom_result_count = 0
    invalid_null_solution_result_count = 0
    for row in ranklist.get("rows") or []:
        for status in row.get("statuses") or []:
            solutions = status.get("solutions") or []
            if status.get("result") is not None or (status.get("tries") or 0) > 0 or solutions:
                submitted_statuses += 1
            if solutions:
                statuses_with_solutions += 1
            for solution in solutions:
                solution_count += 1
                result = solution.get("result")
                if result is None:
                    invalid_null_solution_result_count += 1
                elif result in LITE_RESULTS:
                    lite_result_count += 1
                elif result in FULL_ONLY_RESULTS:
                    predefined_full_only_result_count += 1
                    exact_result_count += 1
                else:
                    custom_result_count += 1
                    exact_result_count += 1
    return {
        "submittedStatuses": submitted_statuses,
        "statusesWithSolutions": statuses_with_solutions,
        "solutionCount": solution_count,
        "exactResultCount": exact_result_count,
        "liteResultCount": lite_result_count,
        "predefinedLiteResultCount": lite_result_count,
        "predefinedFullOnlyResultCount": predefined_full_only_result_count,
        "customResultCount": custom_result_count,
        "invalidNullSolutionResultCount": invalid_null_solution_result_count,
    }


def _collect_i18n_details(ranklist: dict[str, Any]) -> dict[str, Any]:
    texts = [{"path": "contest.title", "text": (ranklist.get("contest") or {}).get("title")}]
    for row_index, row in enumerate(ranklist.get("rows") or []):
        user = row.get("user") or {}
        texts.append({"path": f"rows[{row_index}].user.name", "text": user.get("name")})
        if "organization" in user:
            texts.append({"path": f"rows[{row_index}].user.organization", "text": user.get("organization")})
    language_counts: dict[str, int] = {}
    i18n_paths = []
    for item in texts:
        if _is_i18n_text(item.get("text")):
            i18n_paths.append(item["path"])
            for lang in item["text"].keys():
                language_counts[lang] = language_counts.get(lang, 0) + 1
    return {
        "totalTextCount": len(texts),
        "i18nCount": len(i18n_paths),
        "plainTextCount": len(texts) - len(i18n_paths),
        "i18nPaths": i18n_paths,
        "languageCounts": language_counts,
    }


def _collect_row_user_consistency_details(rows: list[dict[str, Any]]) -> dict[str, Any]:
    fields = sorted({key for row in rows for key in (row.get("user") or {}).keys()})
    missing_by_row = []
    for row_index, row in enumerate(rows):
        user = row.get("user") or {}
        missing_fields = [field for field in fields if field not in user]
        if missing_fields:
            missing_by_row.append(
                {"rowIndex": row_index, "userId": _get_row_user_id(row), "missingFields": missing_fields}
            )
    return {"fields": fields, "rowsWithAllFields": len(rows) - len(missing_by_row), "missingByRow": missing_by_row}


def _get_icpc_series_details(series: list[dict[str, Any]]) -> dict[str, Any]:
    icpc_series = [
        (series_config, index)
        for index, series_config in enumerate(series)
        if (series_config.get("rule") or {}).get("preset") == "ICPC"
    ]
    incomplete_series = []
    invalid_series = []
    usable_icpc_series_count = 0
    for series_config, index in icpc_series:
        options = (series_config.get("rule") or {}).get("options") or {}
        count_values = ((options.get("count") or {}).get("value")) or []
        ratio_values = ((options.get("ratio") or {}).get("value")) or []
        has_usable_count = any(value > 0 for value in count_values)
        has_usable_ratio = any(value > 0 for value in ratio_values)
        if has_usable_count or has_usable_ratio:
            usable_icpc_series_count += 1
        else:
            incomplete_series.append(
                {"index": index, "title": series_config.get("title"), "count": count_values, "ratio": ratio_values}
            )
        for value_index, value in enumerate(count_values):
            if not isinstance(value, int) or value < 0:
                invalid_series.append(
                    {
                        "index": index,
                        "valueIndex": value_index,
                        "field": "count.value",
                        "value": value,
                        "severity": "error",
                    }
                )
        for value_index, value in enumerate(ratio_values):
            if not isinstance(value, (int, float)) or value <= 0 or value > 1:
                invalid_series.append(
                    {
                        "index": index,
                        "valueIndex": value_index,
                        "field": "ratio.value",
                        "value": value,
                        "severity": "error",
                    }
                )
        if sum(ratio_values) > 1:
            invalid_series.append(
                {
                    "index": index,
                    "field": "ratio.value",
                    "value": ratio_values,
                    "severity": "warning",
                    "reason": "ratio sum exceeds 1",
                }
            )
    return {
        "seriesCount": len(series),
        "icpcSeriesCount": len(icpc_series),
        "usableICPCSeriesCount": usable_icpc_series_count,
        "incompleteSeries": incomplete_series,
        "invalidSeries": invalid_series,
    }


def _count_statuses_with_solutions(ranklist: dict[str, Any]) -> int:
    return sum(
        1 for row in ranklist.get("rows") or [] for status in row.get("statuses") or [] if status.get("solutions")
    )


def _collect_row_marker_ids(user: dict[str, Any]) -> list[str]:
    if isinstance(user.get("markers"), list):
        return _unique_values([item for item in user.get("markers") if item])
    ids = []
    if user.get("marker"):
        ids.append(user["marker"])
    return _unique_values(ids)


def _detect_mock_time_pattern(times: list[float]) -> Optional[str]:
    if all(_is_nearly_equal(time, times[0]) for time in times):
        return "identical"
    sorted_times = sorted(times)
    deltas = [time - sorted_times[index] for index, time in enumerate(sorted_times[1:])]
    if deltas and all(_is_nearly_equal(delta, deltas[0]) for delta in deltas):
        if _is_nearly_equal(deltas[0], 1000):
            return "uniform-1s"
        if _is_nearly_equal(deltas[0], 60 * 1000):
            return "uniform-1min"
    return None


def _make_check(
    key: str, label: str, status: str, checked_count: int, failed_count: int, details: dict[str, Any]
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "status": status,
        "checkedCount": checked_count,
        "failedCount": failed_count,
        "details": details,
    }


def _level_from_coverage(present_count: int, total_count: int) -> str:
    if total_count <= 0:
        return "notApplicable"
    if present_count <= 0:
        return "missing"
    ratio = present_count / total_count
    if ratio >= 1:
        return "complete"
    if ratio >= 0.8:
        return "mostly"
    return "partial"


def _parse_time_duration(value: Any) -> dict[str, Any]:
    if not isinstance(value, list) or len(value) != 2:
        return {"valid": False}
    duration_value, unit = value
    if (
        not isinstance(duration_value, (int, float))
        or not math.isfinite(duration_value)
        or duration_value < 0
        or unit not in TIME_UNITS
    ):
        return {"valid": False}
    try:
        return {"valid": True, "value": duration_value, "unit": unit, "ms": format_time_duration(value, "ms")}
    except ValueError:
        return {"valid": False}


def _safe_format_time_duration(
    value: Any, target_unit: str, fmt: Callable[[float], float] = lambda num: num
) -> Optional[float]:
    if not _parse_time_duration(value)["valid"]:
        return None
    try:
        return format_time_duration(value, target_unit, fmt)
    except ValueError:
        return None


def _same_status_summary_optional_time(status_time: Any, solution_time: Any) -> bool:
    if not status_time and not solution_time:
        return True
    if not solution_time:
        return _is_zero_time_duration(status_time)
    if not status_time:
        return False
    return _same_status_summary_time(status_time, solution_time)


def _same_status_summary_time(status_time: Any, solution_time: Any) -> bool:
    parsed_status = _parse_time_duration(status_time)
    if not parsed_status["valid"]:
        return False
    solution_value = _safe_format_time_duration(solution_time, parsed_status["unit"], math.floor)
    return solution_value is not None and _is_nearly_equal(parsed_status["value"], solution_value)


def _is_zero_time_duration(value: Any) -> bool:
    if not value:
        return True
    parsed = _parse_time_duration(value)
    return parsed["valid"] and _is_nearly_zero(parsed["ms"])


def _is_icpc_sorter(ranklist: dict[str, Any]) -> bool:
    return (ranklist.get("sorter") or {}).get("algorithm") == "ICPC"


def _problem_label(ranklist: dict[str, Any], problem_index: int) -> str:
    problems = ranklist.get("problems") or []
    alias = (problems[problem_index] if problem_index < len(problems) else {}).get("alias")
    return alias or str(problem_index)


def _get_row_user_id(row: dict[str, Any]) -> str:
    user = row.get("user") or {}
    if user.get("id"):
        return str(user["id"])
    name = user.get("name")
    if isinstance(name, str):
        return name
    return json.dumps(name, ensure_ascii=False, separators=(",", ":"))


def _is_i18n_text(text: Any) -> bool:
    return isinstance(text, dict)


def _rounding_fn(name: str) -> Callable[[float], float]:
    if name == "ceil":
        return math.ceil
    if name == "round":
        return lambda value: math.floor(value + 0.5)
    return math.floor


def _unique_values(values: list[Any]) -> list[Any]:
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def _same_no_penalty_results(a: list[Any], b: list[Any]) -> bool:
    return a == b


def _same_problem_statistics(left: Optional[dict[str, Any]], right: Optional[dict[str, Any]]) -> bool:
    return bool(
        left
        and right
        and left.get("accepted") == right.get("accepted")
        and left.get("submitted") == right.get("submitted")
    )


def _count_problems_with_statistics(ranklist: dict[str, Any]) -> int:
    return sum(1 for problem in ranklist.get("problems") or [] if problem.get("statistics"))


def _is_nearly_zero(value: float) -> bool:
    return abs(value) < 1e-9


def _is_nearly_equal(a: float, b: float) -> bool:
    return abs(a - b) < 1e-9


def _is_multiple_of(value: float, unit: int) -> bool:
    return _is_nearly_equal(value / unit, round(value / unit))


def _camel_to_constant(value: str) -> str:
    return re.sub(r"[A-Z]", lambda match: f"_{match.group(0)}", value).upper()
