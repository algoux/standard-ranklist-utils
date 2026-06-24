import copy
from typing import Any, Optional, Union

from .diagnostics import diagnose_ranklist

RanklistPatchPathSegment = Union[str, int]
RanklistPatchPath = list[RanklistPatchPathSegment]
RanklistPatchPathInput = Union[RanklistPatchPath, str]


class PatchTargetError(ValueError):
    pass


def patch_ranklist(
    ranklist: dict[str, Any],
    patch: dict[str, Any],
    _options: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    _assert_valid_patch(patch)
    patched = copy.deepcopy(ranklist)
    for operation in patch["operations"]:
        if not _matches_conditions(patched, operation):
            continue
        try:
            patched = _apply_operation(patched, operation)
        except PatchTargetError:
            if operation.get("optional"):
                continue
            raise
    return patched


def create_ranklist_patch_from_diagnostics(
    ranklist: dict[str, Any],
    diagnostics: Optional[dict[str, Any]] = None,
    options: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    diagnostics = diagnostics or diagnose_ranklist(ranklist)
    options = options or {}
    include_first_blood = options.get("firstBlood") is not False
    include_sorter = options.get("sorter") is not False
    include_problem_statistics = options.get("problemStatistics") is not False
    operations: list[dict[str, Any]] = []
    first_blood_suggestions = diagnostics["suggestions"]["firstBlood"] if include_first_blood else []
    problem_statistics_suggestions = (
        diagnostics["suggestions"]["problemStatistics"] if include_problem_statistics else []
    )
    sorter_suggestion = (
        diagnostics["suggestions"]["sorter"][0] if include_sorter and diagnostics["suggestions"]["sorter"] else None
    )

    for suggestion in first_blood_suggestions:
        operations.extend(_build_first_blood_operations(ranklist, suggestion))
    for suggestion in problem_statistics_suggestions:
        operations.append(_build_problem_statistics_operation(ranklist, suggestion))
    if sorter_suggestion:
        operations.append(_build_sorter_operation(sorter_suggestion))

    metadata_diagnostics: dict[str, Any] = {
        "firstBlood": first_blood_suggestions,
        "problemStatistics": problem_statistics_suggestions,
    }
    if sorter_suggestion:
        metadata_diagnostics["sorter"] = {
            "config": sorter_suggestion["config"],
            "confidence": sorter_suggestion["confidence"],
            "resolvedIssues": sorter_suggestion["resolvedIssues"],
        }

    return {
        "type": "srk-patch",
        "version": 1,
        "metadata": {
            "source": "standard-ranklist-utils",
            "description": "Patch generated from SRK diagnostics suggestions.",
            "diagnostics": metadata_diagnostics,
        },
        "operations": operations,
    }


def _build_first_blood_operations(ranklist: dict[str, Any], suggestion: dict[str, Any]) -> list[dict[str, Any]]:
    operations = []
    problem_target = _get_problem_target(ranklist, suggestion["problemIndex"])
    for row_index, row in enumerate(ranklist.get("rows") or []):
        row_target = _get_row_target(row, row_index)
        status = (row.get("statuses") or [None] * (suggestion["problemIndex"] + 1))[suggestion["problemIndex"]]
        if not status:
            continue
        if status.get("result") == "FB":
            target = {"type": "status", **row_target, **problem_target, "path": ["result"]}
            operations.append(
                {
                    "op": "set",
                    "target": target,
                    "value": "AC",
                    "when": [{"target": target, "equals": "FB"}],
                }
            )
        for solution_index, solution in enumerate(status.get("solutions") or []):
            if solution.get("result") != "FB":
                continue
            target = {
                "type": "solution",
                **row_target,
                **problem_target,
                "solutionIndex": solution_index,
                "path": ["result"],
            }
            operations.append(
                {
                    "op": "set",
                    "target": target,
                    "value": "AC",
                    "when": [{"target": target, "equals": "FB"}],
                }
            )

    target_row = (ranklist.get("rows") or [None] * (suggestion["rowIndex"] + 1))[suggestion["rowIndex"]]
    target_status = (target_row.get("statuses") or [None] * (suggestion["problemIndex"] + 1))[
        suggestion["problemIndex"]
    ]
    target_row_locator = _get_row_target(target_row, suggestion["rowIndex"], suggestion.get("userId"))
    operations.append(
        {
            "op": "set",
            "target": {"type": "status", **target_row_locator, **problem_target, "path": ["result"]},
            "value": "FB",
        }
    )
    target_solution_index = _find_accepted_solution_index(target_status, suggestion["time"])
    if target_solution_index is not None:
        target = {
            "type": "solution",
            **target_row_locator,
            **problem_target,
            "solutionIndex": target_solution_index,
            "path": ["result"],
        }
        operations.append(
            {
                "op": "set",
                "target": target,
                "value": "FB",
                "when": [{"target": target, "in": ["AC", "FB"]}],
            }
        )
    return operations


def _build_sorter_operation(suggestion: dict[str, Any]) -> dict[str, Any]:
    return {
        "op": "merge",
        "target": {"type": "sorter", "path": "config"},
        "value": suggestion["config"],
        "metadata": {
            "source": "standard-ranklist-utils",
            "confidence": suggestion["confidence"],
            "resolvedIssues": suggestion["resolvedIssues"],
        },
    }


def _build_problem_statistics_operation(ranklist: dict[str, Any], suggestion: dict[str, Any]) -> dict[str, Any]:
    return {
        "op": "set",
        "target": {
            "type": "problem",
            **_get_problem_target(ranklist, suggestion["problemIndex"]),
            "path": "statistics",
        },
        "value": suggestion["expected"],
        "metadata": {
            "source": "standard-ranklist-utils",
            "confidence": suggestion["confidence"],
            "reason": suggestion["reason"],
        },
    }


def _get_problem_target(ranklist: dict[str, Any], problem_index: int) -> dict[str, Any]:
    problem = (ranklist.get("problems") or [None] * (problem_index + 1))[problem_index]
    alias = problem.get("alias") if problem else None
    return {"problemIndex": problem_index, "problemAlias": alias} if alias else {"problemIndex": problem_index}


def _get_row_target(
    row: Optional[dict[str, Any]], row_index: int, fallback_user_id: Optional[str] = None
) -> dict[str, Any]:
    user_id = ((row or {}).get("user") or {}).get("id") or fallback_user_id
    return {"rowIndex": row_index, "userId": user_id} if user_id else {"rowIndex": row_index}


def _find_accepted_solution_index(status: Optional[dict[str, Any]], time: Any) -> Optional[int]:
    if not status or not status.get("solutions"):
        return None
    for index, solution in enumerate(status.get("solutions") or []):
        if solution.get("result") in ("AC", "FB") and solution.get("time") == time:
            return index
    return None


def _apply_operation(ranklist: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
    op = operation.get("op")
    if op == "set":
        return _set_location(ranklist, _resolve_target(ranklist, operation["target"], True), operation.get("value"))
    if op == "merge":
        return _merge_location(ranklist, _resolve_target(ranklist, operation["target"], True), operation.get("value"))
    if op == "unset":
        return _unset_location(ranklist, _resolve_target(ranklist, operation["target"], False))
    if op == "append":
        return _append_location(
            ranklist,
            _resolve_target(ranklist, operation["target"], True),
            operation.get("value"),
            operation.get("uniqueBy"),
        )
    raise PatchTargetError(f"Unsupported srk patch operation: {op}")


def _matches_conditions(ranklist: dict[str, Any], operation: dict[str, Any]) -> bool:
    when = operation.get("when")
    conditions = when if isinstance(when, list) else ([when] if when else [])
    return all(_matches_condition(ranklist, operation["target"], condition) for condition in conditions)


def _matches_condition(ranklist: dict[str, Any], operation_target: dict[str, Any], condition: dict[str, Any]) -> bool:
    target = condition.get("target") or operation_target
    location = _resolve_target_safe(ranklist, target)
    if condition.get("exists"):
        return location["found"]
    if condition.get("missing"):
        return not location["found"]
    if not location["found"]:
        return False
    if "equals" in condition:
        return location["value"] == condition.get("equals")
    if isinstance(condition.get("in"), list):
        return any(location["value"] == item for item in condition["in"])
    return True


def _resolve_target_safe(ranklist: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    try:
        location = _resolve_target(ranklist, target, False)
        return {"found": location["exists"], "value": location["value"]}
    except PatchTargetError:
        return {"found": False, "value": None}


def _set_location(ranklist: dict[str, Any], location: dict[str, Any], value: Any) -> dict[str, Any]:
    cloned_value = copy.deepcopy(value)
    if _is_root_location(location):
        return cloned_value
    _set_child_value(location["parent"], location["key"], cloned_value)
    return ranklist


def _merge_location(ranklist: dict[str, Any], location: dict[str, Any], value: Any) -> dict[str, Any]:
    if not _is_plain_object(value):
        raise PatchTargetError("merge operation value must be a plain object")
    if not location["exists"]:
        _set_location(ranklist, location, {})
        location = _resolve_location_after_create(location)
    if not _is_plain_object(location["value"]):
        raise PatchTargetError("merge target must resolve to a plain object")
    location["value"].update(copy.deepcopy(value))
    return ranklist


def _unset_location(ranklist: dict[str, Any], location: dict[str, Any]) -> dict[str, Any]:
    if _is_root_location(location):
        raise PatchTargetError("Cannot unset ranklist root")
    if not location["exists"]:
        raise PatchTargetError(f"Cannot unset missing target {_format_key(location['key'])}")
    if isinstance(location["parent"], list):
        _assert_array_index(location["parent"], location["key"], False)
        del location["parent"][location["key"]]
    else:
        del location["parent"][location["key"]]
    return ranklist


def _append_location(
    ranklist: dict[str, Any],
    location: dict[str, Any],
    value: Any,
    unique_by: Optional[RanklistPatchPathInput],
) -> dict[str, Any]:
    if not location["exists"]:
        _set_location(ranklist, location, [])
        location = _resolve_location_after_create(location)
    if not isinstance(location["value"], list):
        raise PatchTargetError("append target must resolve to an array")
    item = copy.deepcopy(value)
    unique_path = _normalize_path(unique_by)
    if unique_path:
        candidate = _get_value_at_path(item, unique_path)
        if candidate["found"] and any(
            _get_value_at_path(current, unique_path).get("value") == candidate["value"] for current in location["value"]
        ):
            return ranklist
    location["value"].append(item)
    return ranklist


def _resolve_location_after_create(location: dict[str, Any]) -> dict[str, Any]:
    return {
        **location,
        "exists": True,
        "value": location["value"] if _is_root_location(location) else location["parent"][location["key"]],
    }


def _resolve_target(ranklist: dict[str, Any], target: dict[str, Any], create_parents: bool) -> dict[str, Any]:
    base = _resolve_base_target(ranklist, target, create_parents)
    return _resolve_path(base, _normalize_path(target.get("path")), create_parents)


def _resolve_base_target(ranklist: dict[str, Any], target: dict[str, Any], create_parents: bool) -> dict[str, Any]:
    target_type = target.get("type")
    if target_type == "ranklist":
        return {"parent": None, "key": None, "value": ranklist, "exists": True}
    if target_type == "contest":
        return {"parent": ranklist, "key": "contest", "value": ranklist.get("contest"), "exists": True}
    if target_type == "problem":
        problem_index = _resolve_problem_index(ranklist, target)
        problems = ranklist.get("problems") or []
        return {"parent": problems, "key": problem_index, "value": problems[problem_index], "exists": True}
    if target_type == "row":
        row_index = _resolve_row_index(ranklist, target)
        rows = ranklist.get("rows") or []
        return {"parent": rows, "key": row_index, "value": rows[row_index], "exists": True}
    if target_type == "status":
        row_index = _resolve_row_index(ranklist, target)
        problem_index = _resolve_problem_index(ranklist, target)
        row = (ranklist.get("rows") or [])[row_index]
        statuses = row.get("statuses") or []
        if problem_index >= len(statuses):
            raise PatchTargetError(f"Status not found at rows[{row_index}].statuses[{problem_index}]")
        return {"parent": statuses, "key": problem_index, "value": statuses[problem_index], "exists": True}
    if target_type == "solution":
        row_index = _resolve_row_index(ranklist, target)
        problem_index = _resolve_problem_index(ranklist, target)
        row = (ranklist.get("rows") or [])[row_index]
        statuses = row.get("statuses") or []
        status = statuses[problem_index] if problem_index < len(statuses) else None
        solutions = (status or {}).get("solutions")
        if not isinstance(solutions, list):
            raise PatchTargetError(f"Solutions not found at rows[{row_index}].statuses[{problem_index}].solutions")
        _assert_array_index(solutions, target.get("solutionIndex"), False)
        return {
            "parent": solutions,
            "key": target["solutionIndex"],
            "value": solutions[target["solutionIndex"]],
            "exists": True,
        }
    if target_type == "sorter":
        if not ranklist.get("sorter"):
            raise PatchTargetError("Sorter target requires ranklist.sorter")
        return {"parent": ranklist, "key": "sorter", "value": ranklist["sorter"], "exists": True}
    if target_type == "sorterConfig":
        sorter = ranklist.get("sorter")
        if not sorter or sorter.get("algorithm") != "ICPC":
            raise PatchTargetError("sorterConfig target requires an ICPC sorter")
        if not sorter.get("config"):
            if not create_parents:
                raise PatchTargetError("sorter.config is missing")
            sorter["config"] = {}
        return {"parent": sorter, "key": "config", "value": sorter["config"], "exists": True}
    raise PatchTargetError(f"Unknown patch target type: {target_type}")


def _resolve_problem_index(ranklist: dict[str, Any], locator: dict[str, Any]) -> int:
    if not isinstance(locator.get("problemIndex"), int) and locator.get("problemAlias") is None:
        raise PatchTargetError("Problem target requires problemIndex or problemAlias")
    problems = ranklist.get("problems") or []
    index_from_alias = -1
    if locator.get("problemAlias") is not None:
        for index, problem in enumerate(problems):
            if problem.get("alias") == locator["problemAlias"]:
                index_from_alias = index
                break
        if index_from_alias < 0:
            raise PatchTargetError(f"Problem alias not found: {locator['problemAlias']}")
    if isinstance(locator.get("problemIndex"), int):
        _assert_array_index(problems, locator["problemIndex"], False)
        if index_from_alias >= 0 and index_from_alias != locator["problemIndex"]:
            raise PatchTargetError("problemIndex and problemAlias do not resolve to the same problem")
        return locator["problemIndex"]
    return index_from_alias


def _resolve_row_index(ranklist: dict[str, Any], locator: dict[str, Any]) -> int:
    if not isinstance(locator.get("rowIndex"), int) and locator.get("userId") is None:
        raise PatchTargetError("Row target requires rowIndex or userId")
    rows = ranklist.get("rows") or []
    index_from_user_id = -1
    if locator.get("userId") is not None:
        for index, row in enumerate(rows):
            if str((row.get("user") or {}).get("id")) == locator["userId"]:
                index_from_user_id = index
                break
        if index_from_user_id < 0:
            raise PatchTargetError(f"Row userId not found: {locator['userId']}")
    if isinstance(locator.get("rowIndex"), int):
        _assert_array_index(rows, locator["rowIndex"], False)
        if index_from_user_id >= 0 and index_from_user_id != locator["rowIndex"]:
            raise PatchTargetError("rowIndex and userId do not resolve to the same row")
        return locator["rowIndex"]
    return index_from_user_id


def _resolve_path(base: dict[str, Any], path: RanklistPatchPath, create_parents: bool) -> dict[str, Any]:
    if not path:
        return base
    current = base["value"]
    for index, segment in enumerate(path[:-1]):
        next_segment = path[index + 1]
        _ensure_container(current, segment)
        child = _get_child(current, segment)
        if not child["found"] or child["value"] is None:
            if not create_parents:
                raise PatchTargetError(f"Path segment not found: {_format_key(segment)}")
            next_container: Any = [] if isinstance(next_segment, int) else {}
            _set_child_value(current, segment, next_container)
            current = next_container
        else:
            current = child["value"]
    key = path[-1]
    _ensure_container(current, key, True)
    child = _get_child(current, key)
    return {"parent": current, "key": key, "value": child["value"], "exists": child["found"]}


def _ensure_container(container: Any, key: RanklistPatchPathSegment, allow_final: bool = False) -> None:
    if isinstance(container, list):
        _assert_array_index(container, key, allow_final)
        return
    if not _is_object_like(container):
        raise PatchTargetError(f"Cannot access {_format_key(key)} on a non-container value")


def _get_child(container: Any, key: RanklistPatchPathSegment) -> dict[str, Any]:
    if isinstance(container, list):
        _assert_array_index(container, key, True)
        return {"found": 0 <= key < len(container), "value": container[key] if 0 <= key < len(container) else None}
    return {"found": key in container, "value": container.get(key)}


def _set_child_value(container: Any, key: RanklistPatchPathSegment, value: Any) -> None:
    if isinstance(container, list):
        _assert_array_index(container, key, True)
        if key == len(container):
            container.append(value)
        else:
            container[key] = value
    elif _is_object_like(container):
        container[key] = value
    else:
        raise PatchTargetError(f"Cannot set {_format_key(key)} on a non-container value")


def _assert_array_index(array: list[Any], key: Any, allow_append: bool) -> None:
    if not isinstance(key, int) or key < 0:
        raise PatchTargetError(f"Array path segment must be a non-negative integer: {_format_key(key)}")
    if key > len(array) or (not allow_append and key >= len(array)):
        raise PatchTargetError(f"Array index out of bounds: {key}")


def _get_value_at_path(value: Any, path: RanklistPatchPath) -> dict[str, Any]:
    current = value
    for segment in path:
        if not _is_object_like(current):
            return {"found": False, "value": None}
        child = _get_child(current, segment)
        if not child["found"]:
            return {"found": False, "value": None}
        current = child["value"]
    return {"found": True, "value": current}


def _is_root_location(location: dict[str, Any]) -> bool:
    return location["parent"] is None and location["key"] is None


def _normalize_path(path: Optional[RanklistPatchPathInput]) -> RanklistPatchPath:
    if path is None:
        return []
    if isinstance(path, list):
        return path
    return [
        int(segment) if segment.isdigit() and (segment == "0" or not segment.startswith("0")) else segment
        for segment in (part.strip() for part in path.split("."))
        if segment
    ]


def _is_object_like(value: Any) -> bool:
    return isinstance(value, (dict, list))


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def _assert_valid_patch(patch: dict[str, Any]) -> None:
    if (
        not _is_plain_object(patch)
        or patch.get("type") != "srk-patch"
        or patch.get("version") != 1
        or not isinstance(patch.get("operations"), list)
    ):
        raise ValueError('Invalid srk patch: expected type "srk-patch", version 1, and operations array')
    for index, operation in enumerate(patch["operations"]):
        if not _is_plain_object(operation) or not _is_plain_object(operation.get("target")):
            raise ValueError(f"Invalid srk patch operation at index {index}")
        if operation.get("op") not in ("set", "merge", "unset", "append"):
            raise ValueError(f"Unsupported srk patch operation at index {index}: {operation.get('op')}")


def _format_key(key: Any) -> str:
    return "<root>" if key is None else repr(key)
