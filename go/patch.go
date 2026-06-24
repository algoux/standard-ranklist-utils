package srkutils

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

type RanklistPatchPathSegment = any

type RanklistPatchOperation struct {
	Op       string         `json:"op"`
	Target   map[string]any `json:"target"`
	Value    any            `json:"value,omitempty"`
	Optional bool           `json:"optional,omitempty"`
	When     any            `json:"when,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
	UniqueBy any            `json:"uniqueBy,omitempty"`
}

type RanklistPatch struct {
	Type       string                   `json:"type"`
	Version    int                      `json:"version"`
	Metadata   map[string]any           `json:"metadata,omitempty"`
	Operations []RanklistPatchOperation `json:"operations"`
}

type patchTargetError struct {
	message string
}

func (e patchTargetError) Error() string {
	return e.message
}

type resolvedLocation struct {
	parent any
	key    any
	value  any
	exists bool
}

func PatchRanklist(ranklist map[string]any, patch RanklistPatch, _options map[string]any) map[string]any {
	assertValidPatch(patch)
	patched := deepCopyMap(ranklist)
	for _, operation := range patch.Operations {
		if !matchesConditions(patched, operation) {
			continue
		}
		next, err := applyOperation(patched, operation)
		if err != nil {
			if operation.Optional {
				if _, ok := err.(patchTargetError); ok {
					continue
				}
			}
			panic(err)
		}
		patched = next
	}
	return patched
}

func CreateRanklistPatchFromDiagnostics(ranklist map[string]any, diagnostics RanklistDiagnostics, options map[string]bool) RanklistPatch {
	if diagnostics.Suggestions == nil {
		diagnostics = DiagnoseRanklist(ranklist, nil)
	}
	if options == nil {
		options = map[string]bool{}
	}
	includeFirstBlood := !optionFalse(options, "firstBlood")
	includeSorter := !optionFalse(options, "sorter")
	includeProblemStatistics := !optionFalse(options, "problemStatistics")
	operations := []RanklistPatchOperation{}
	firstBloodSuggestions := []any{}
	if includeFirstBlood {
		firstBloodSuggestions = asSlice(diagnostics.Suggestions["firstBlood"])
	}
	problemStatisticsSuggestions := []any{}
	if includeProblemStatistics {
		problemStatisticsSuggestions = asSlice(diagnostics.Suggestions["problemStatistics"])
	}
	var sorterSuggestion map[string]any
	if includeSorter {
		sorterSuggestions := asSlice(diagnostics.Suggestions["sorter"])
		if len(sorterSuggestions) > 0 {
			sorterSuggestion = asMap(sorterSuggestions[0])
		}
	}

	for _, suggestionAny := range firstBloodSuggestions {
		operations = append(operations, buildFirstBloodOperations(ranklist, asMap(suggestionAny))...)
	}
	for _, suggestionAny := range problemStatisticsSuggestions {
		operations = append(operations, buildProblemStatisticsOperation(ranklist, asMap(suggestionAny)))
	}
	if sorterSuggestion != nil {
		operations = append(operations, buildSorterOperation(sorterSuggestion))
	}
	metadataDiagnostics := map[string]any{
		"firstBlood":        firstBloodSuggestions,
		"problemStatistics": problemStatisticsSuggestions,
	}
	if sorterSuggestion != nil {
		metadataDiagnostics["sorter"] = map[string]any{
			"config":         sorterSuggestion["config"],
			"confidence":     sorterSuggestion["confidence"],
			"resolvedIssues": sorterSuggestion["resolvedIssues"],
		}
	}
	return RanklistPatch{
		Type:    "srk-patch",
		Version: 1,
		Metadata: map[string]any{
			"source":      "standard-ranklist-utils",
			"description": "Patch generated from SRK diagnostics suggestions.",
			"diagnostics": metadataDiagnostics,
		},
		Operations: operations,
	}
}

func optionFalse(options map[string]bool, key string) bool {
	value, ok := options[key]
	return ok && !value
}

func buildFirstBloodOperations(ranklist map[string]any, suggestion map[string]any) []RanklistPatchOperation {
	operations := []RanklistPatchOperation{}
	problemIndex := int(numberValue(suggestion["problemIndex"]))
	problemTarget := getProblemTarget(ranklist, problemIndex)
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		rowTarget := getRowTarget(row, rowIndex, "")
		statuses := asSlice(row["statuses"])
		if problemIndex >= len(statuses) {
			continue
		}
		status := asMap(statuses[problemIndex])
		if status["result"] == "FB" {
			target := mergeTargets(map[string]any{"type": "status", "path": []any{"result"}}, rowTarget, problemTarget)
			operations = append(operations, RanklistPatchOperation{
				Op:     "set",
				Target: target,
				Value:  "AC",
				When:   []any{map[string]any{"target": target, "equals": "FB"}},
			})
		}
		for solutionIndex, solutionAny := range asSlice(status["solutions"]) {
			if asMap(solutionAny)["result"] != "FB" {
				continue
			}
			target := mergeTargets(map[string]any{"type": "solution", "solutionIndex": solutionIndex, "path": []any{"result"}}, rowTarget, problemTarget)
			operations = append(operations, RanklistPatchOperation{
				Op:     "set",
				Target: target,
				Value:  "AC",
				When:   []any{map[string]any{"target": target, "equals": "FB"}},
			})
		}
	}
	rows := asSlice(ranklist["rows"])
	targetRow := asMap(rows[int(numberValue(suggestion["rowIndex"]))])
	targetStatuses := asSlice(targetRow["statuses"])
	targetStatus := map[string]any{}
	if problemIndex < len(targetStatuses) {
		targetStatus = asMap(targetStatuses[problemIndex])
	}
	targetRowLocator := getRowTarget(targetRow, int(numberValue(suggestion["rowIndex"])), stringValue(suggestion["userId"]))
	operations = append(operations, RanklistPatchOperation{
		Op:     "set",
		Target: mergeTargets(map[string]any{"type": "status", "path": []any{"result"}}, targetRowLocator, problemTarget),
		Value:  "FB",
	})
	targetSolutionIndex := findAcceptedSolutionIndex(targetStatus, suggestion["time"])
	if targetSolutionIndex != nil {
		target := mergeTargets(map[string]any{"type": "solution", "solutionIndex": *targetSolutionIndex, "path": []any{"result"}}, targetRowLocator, problemTarget)
		operations = append(operations, RanklistPatchOperation{
			Op:     "set",
			Target: target,
			Value:  "FB",
			When:   []any{map[string]any{"target": target, "in": []any{"AC", "FB"}}},
		})
	}
	return operations
}

func buildSorterOperation(suggestion map[string]any) RanklistPatchOperation {
	return RanklistPatchOperation{
		Op:     "merge",
		Target: map[string]any{"type": "sorter", "path": "config"},
		Value:  suggestion["config"],
		Metadata: map[string]any{
			"source":         "standard-ranklist-utils",
			"confidence":     suggestion["confidence"],
			"resolvedIssues": suggestion["resolvedIssues"],
		},
	}
}

func buildProblemStatisticsOperation(ranklist map[string]any, suggestion map[string]any) RanklistPatchOperation {
	return RanklistPatchOperation{
		Op:     "set",
		Target: mergeTargets(map[string]any{"type": "problem", "path": "statistics"}, getProblemTarget(ranklist, int(numberValue(suggestion["problemIndex"])))),
		Value:  suggestion["expected"],
		Metadata: map[string]any{
			"source":     "standard-ranklist-utils",
			"confidence": suggestion["confidence"],
			"reason":     suggestion["reason"],
		},
	}
}

func getProblemTarget(ranklist map[string]any, problemIndex int) map[string]any {
	problem := asMap(asSlice(ranklist["problems"])[problemIndex])
	alias := stringValue(problem["alias"])
	if alias != "" {
		return map[string]any{"problemIndex": problemIndex, "problemAlias": alias}
	}
	return map[string]any{"problemIndex": problemIndex}
}

func getRowTarget(row map[string]any, rowIndex int, fallbackUserID string) map[string]any {
	userID := stringValue(asMap(row["user"])["id"])
	if userID == "" {
		userID = fallbackUserID
	}
	if userID != "" {
		return map[string]any{"rowIndex": rowIndex, "userId": userID}
	}
	return map[string]any{"rowIndex": rowIndex}
}

func findAcceptedSolutionIndex(status map[string]any, time any) *int {
	for index, solutionAny := range asSlice(status["solutions"]) {
		solution := asMap(solutionAny)
		if (solution["result"] == "AC" || solution["result"] == "FB") && jsonKey(solution["time"]) == jsonKey(time) {
			return &index
		}
	}
	return nil
}

func applyOperation(ranklist map[string]any, operation RanklistPatchOperation) (result map[string]any, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			if targetErr, ok := recovered.(patchTargetError); ok {
				result = ranklist
				err = targetErr
				return
			}
			panic(recovered)
		}
	}()
	switch operation.Op {
	case "set":
		return setLocation(ranklist, resolveTarget(ranklist, operation.Target, true), operation.Value), nil
	case "merge":
		return mergeLocation(ranklist, resolveTarget(ranklist, operation.Target, true), operation.Value)
	case "unset":
		return unsetLocation(ranklist, resolveTarget(ranklist, operation.Target, false))
	case "append":
		return appendLocation(ranklist, resolveTarget(ranklist, operation.Target, true), operation.Value, operation.UniqueBy)
	default:
		return ranklist, patchTargetError{message: "Unsupported srk patch operation: " + operation.Op}
	}
}

func matchesConditions(ranklist map[string]any, operation RanklistPatchOperation) bool {
	conditions := []any{}
	switch when := operation.When.(type) {
	case nil:
	case []any:
		conditions = when
	case []map[string]any:
		for _, item := range when {
			conditions = append(conditions, item)
		}
	default:
		conditions = append(conditions, when)
	}
	for _, conditionAny := range conditions {
		if !matchesCondition(ranklist, operation.Target, asMap(conditionAny)) {
			return false
		}
	}
	return true
}

func matchesCondition(ranklist map[string]any, operationTarget map[string]any, condition map[string]any) bool {
	target := operationTarget
	if condition["target"] != nil {
		target = asMap(condition["target"])
	}
	location := resolveTargetSafe(ranklist, target)
	if truthy(condition["exists"]) {
		return location["found"].(bool)
	}
	if truthy(condition["missing"]) {
		return !location["found"].(bool)
	}
	if !location["found"].(bool) {
		return false
	}
	if _, ok := condition["equals"]; ok {
		return jsonKey(location["value"]) == jsonKey(condition["equals"])
	}
	if condition["in"] != nil {
		for _, item := range asSlice(condition["in"]) {
			if jsonKey(location["value"]) == jsonKey(item) {
				return true
			}
		}
		return false
	}
	return true
}

func resolveTargetSafe(ranklist map[string]any, target map[string]any) map[string]any {
	location, err := resolveTargetWithError(ranklist, target, false)
	if err != nil {
		return map[string]any{"found": false, "value": nil}
	}
	return map[string]any{"found": location.exists, "value": location.value}
}

func setLocation(ranklist map[string]any, location resolvedLocation, value any) map[string]any {
	clonedValue := deepCopyAny(value)
	if isRootLocation(location) {
		if typed, ok := clonedValue.(map[string]any); ok {
			return typed
		}
		panic(patchTargetError{message: "ranklist root must be an object"})
	}
	setChildValue(location.parent, location.key, clonedValue)
	return ranklist
}

func mergeLocation(ranklist map[string]any, location resolvedLocation, value any) (map[string]any, error) {
	valueMap, ok := value.(map[string]any)
	if !ok {
		return ranklist, patchTargetError{message: "merge operation value must be a plain object"}
	}
	if !location.exists {
		setLocation(ranklist, location, map[string]any{})
		location = resolveLocationAfterCreate(location)
	}
	locationMap, ok := location.value.(map[string]any)
	if !ok {
		return ranklist, patchTargetError{message: "merge target must resolve to a plain object"}
	}
	for key, v := range valueMap {
		locationMap[key] = deepCopyAny(v)
	}
	return ranklist, nil
}

func unsetLocation(ranklist map[string]any, location resolvedLocation) (map[string]any, error) {
	if isRootLocation(location) {
		return ranklist, patchTargetError{message: "Cannot unset ranklist root"}
	}
	if !location.exists {
		return ranklist, patchTargetError{message: "Cannot unset missing target " + formatPatchKey(location.key)}
	}
	switch parent := location.parent.(type) {
	case map[string]any:
		delete(parent, stringValue(location.key))
	case []any:
		index := int(numberValue(location.key))
		assertArrayIndex(parent, location.key, false)
		copy(parent[index:], parent[index+1:])
		parent = parent[:len(parent)-1]
	default:
		return ranklist, patchTargetError{message: "Cannot unset target on a non-container value"}
	}
	return ranklist, nil
}

func appendLocation(ranklist map[string]any, location resolvedLocation, value any, uniqueBy any) (map[string]any, error) {
	if !location.exists {
		setLocation(ranklist, location, []any{})
		location = resolveLocationAfterCreate(location)
	}
	array, ok := location.value.([]any)
	if !ok {
		return ranklist, patchTargetError{message: "append target must resolve to an array"}
	}
	item := deepCopyAny(value)
	uniquePath := normalizePath(uniqueBy)
	if len(uniquePath) > 0 {
		candidate := getValueAtPath(item, uniquePath)
		if candidate["found"].(bool) {
			for _, current := range array {
				if jsonKey(getValueAtPath(current, uniquePath)["value"]) == jsonKey(candidate["value"]) {
					return ranklist, nil
				}
			}
		}
	}
	array = append(array, item)
	setChildValue(location.parent, location.key, array)
	return ranklist, nil
}

func resolveLocationAfterCreate(location resolvedLocation) resolvedLocation {
	if isRootLocation(location) {
		location.exists = true
		return location
	}
	location.exists = true
	location.value = getChild(location.parent, location.key)["value"]
	return location
}

func resolveTarget(ranklist map[string]any, target map[string]any, createParents bool) resolvedLocation {
	location, err := resolveTargetWithError(ranklist, target, createParents)
	if err != nil {
		panic(err)
	}
	return location
}

func resolveTargetWithError(ranklist map[string]any, target map[string]any, createParents bool) (resolvedLocation, error) {
	base, err := resolveBaseTarget(ranklist, target, createParents)
	if err != nil {
		return resolvedLocation{}, err
	}
	return resolvePath(base, normalizePath(target["path"]), createParents)
}

func resolveBaseTarget(ranklist map[string]any, target map[string]any, createParents bool) (resolvedLocation, error) {
	switch stringValue(target["type"]) {
	case "ranklist":
		return resolvedLocation{parent: nil, key: nil, value: ranklist, exists: true}, nil
	case "contest":
		return resolvedLocation{parent: ranklist, key: "contest", value: ranklist["contest"], exists: true}, nil
	case "problem":
		problemIndex, err := resolveProblemIndex(ranklist, target)
		if err != nil {
			return resolvedLocation{}, err
		}
		problems := asSlice(ranklist["problems"])
		return resolvedLocation{parent: problems, key: problemIndex, value: problems[problemIndex], exists: true}, nil
	case "row":
		rowIndex, err := resolveRowIndex(ranklist, target)
		if err != nil {
			return resolvedLocation{}, err
		}
		rows := asSlice(ranklist["rows"])
		return resolvedLocation{parent: rows, key: rowIndex, value: rows[rowIndex], exists: true}, nil
	case "status":
		rowIndex, err := resolveRowIndex(ranklist, target)
		if err != nil {
			return resolvedLocation{}, err
		}
		problemIndex, err := resolveProblemIndex(ranklist, target)
		if err != nil {
			return resolvedLocation{}, err
		}
		rows := asSlice(ranklist["rows"])
		row := asMap(rows[rowIndex])
		statuses := asSlice(row["statuses"])
		if problemIndex >= len(statuses) {
			return resolvedLocation{}, patchTargetError{message: fmt.Sprintf("Status not found at rows[%d].statuses[%d]", rowIndex, problemIndex)}
		}
		return resolvedLocation{parent: statuses, key: problemIndex, value: statuses[problemIndex], exists: true}, nil
	case "solution":
		rowIndex, err := resolveRowIndex(ranklist, target)
		if err != nil {
			return resolvedLocation{}, err
		}
		problemIndex, err := resolveProblemIndex(ranklist, target)
		if err != nil {
			return resolvedLocation{}, err
		}
		row := asMap(asSlice(ranklist["rows"])[rowIndex])
		statuses := asSlice(row["statuses"])
		if problemIndex >= len(statuses) {
			return resolvedLocation{}, patchTargetError{message: fmt.Sprintf("Solutions not found at rows[%d].statuses[%d].solutions", rowIndex, problemIndex)}
		}
		solutions := asSlice(asMap(statuses[problemIndex])["solutions"])
		solutionIndex := int(numberValue(target["solutionIndex"]))
		assertArrayIndex(solutions, solutionIndex, false)
		return resolvedLocation{parent: solutions, key: solutionIndex, value: solutions[solutionIndex], exists: true}, nil
	case "sorter":
		if ranklist["sorter"] == nil {
			return resolvedLocation{}, patchTargetError{message: "Sorter target requires ranklist.sorter"}
		}
		return resolvedLocation{parent: ranklist, key: "sorter", value: ranklist["sorter"], exists: true}, nil
	case "sorterConfig":
		sorter := asMap(ranklist["sorter"])
		if sorter["algorithm"] != "ICPC" {
			return resolvedLocation{}, patchTargetError{message: "sorterConfig target requires an ICPC sorter"}
		}
		if sorter["config"] == nil {
			if !createParents {
				return resolvedLocation{}, patchTargetError{message: "sorter.config is missing"}
			}
			sorter["config"] = map[string]any{}
		}
		return resolvedLocation{parent: sorter, key: "config", value: sorter["config"], exists: true}, nil
	default:
		return resolvedLocation{}, patchTargetError{message: "Unknown patch target type: " + stringValue(target["type"])}
	}
}

func resolveProblemIndex(ranklist map[string]any, locator map[string]any) (int, error) {
	hasProblemIndex := isIntegerNumber(locator["problemIndex"])
	if !hasProblemIndex && locator["problemAlias"] == nil {
		return -1, patchTargetError{message: "Problem target requires problemIndex or problemAlias"}
	}
	problems := asSlice(ranklist["problems"])
	indexFromAlias := -1
	if locator["problemAlias"] != nil {
		for index, problemAny := range problems {
			if asMap(problemAny)["alias"] == locator["problemAlias"] {
				indexFromAlias = index
				break
			}
		}
		if indexFromAlias < 0 {
			return -1, patchTargetError{message: "Problem alias not found: " + stringValue(locator["problemAlias"])}
		}
	}
	if hasProblemIndex {
		problemIndex := int(numberValue(locator["problemIndex"]))
		assertArrayIndex(problems, problemIndex, false)
		if indexFromAlias >= 0 && indexFromAlias != problemIndex {
			return -1, patchTargetError{message: "problemIndex and problemAlias do not resolve to the same problem"}
		}
		return problemIndex, nil
	}
	return indexFromAlias, nil
}

func resolveRowIndex(ranklist map[string]any, locator map[string]any) (int, error) {
	hasRowIndex := isIntegerNumber(locator["rowIndex"])
	if !hasRowIndex && locator["userId"] == nil {
		return -1, patchTargetError{message: "Row target requires rowIndex or userId"}
	}
	rows := asSlice(ranklist["rows"])
	indexFromUserID := -1
	if locator["userId"] != nil {
		for index, rowAny := range rows {
			if stringValue(asMap(asMap(rowAny)["user"])["id"]) == stringValue(locator["userId"]) {
				indexFromUserID = index
				break
			}
		}
		if indexFromUserID < 0 {
			return -1, patchTargetError{message: "Row userId not found: " + stringValue(locator["userId"])}
		}
	}
	if hasRowIndex {
		rowIndex := int(numberValue(locator["rowIndex"]))
		assertArrayIndex(rows, rowIndex, false)
		if indexFromUserID >= 0 && indexFromUserID != rowIndex {
			return -1, patchTargetError{message: "rowIndex and userId do not resolve to the same row"}
		}
		return rowIndex, nil
	}
	return indexFromUserID, nil
}

func resolvePath(base resolvedLocation, path []any, createParents bool) (resolvedLocation, error) {
	if len(path) == 0 {
		return base, nil
	}
	current := base.value
	for index, segment := range path[:len(path)-1] {
		nextSegment := path[index+1]
		if err := ensureContainer(current, segment, false); err != nil {
			return resolvedLocation{}, err
		}
		child := getChild(current, segment)
		if !child["found"].(bool) || child["value"] == nil {
			if !createParents {
				return resolvedLocation{}, patchTargetError{message: "Path segment not found: " + formatPatchKey(segment)}
			}
			var nextContainer any = map[string]any{}
			if _, ok := normalizePathSegment(nextSegment).(int); ok {
				nextContainer = []any{}
			}
			setChildValue(current, segment, nextContainer)
			current = nextContainer
		} else {
			current = child["value"]
		}
	}
	key := path[len(path)-1]
	if err := ensureContainer(current, key, true); err != nil {
		return resolvedLocation{}, err
	}
	child := getChild(current, key)
	return resolvedLocation{parent: current, key: normalizePathSegment(key), value: child["value"], exists: child["found"].(bool)}, nil
}

func ensureContainer(container any, key any, allowFinal bool) error {
	if array, ok := container.([]any); ok {
		assertArrayIndex(array, key, allowFinal)
		return nil
	}
	if _, ok := container.(map[string]any); !ok {
		return patchTargetError{message: "Cannot access " + formatPatchKey(key) + " on a non-container value"}
	}
	return nil
}

func getChild(container any, key any) map[string]any {
	key = normalizePathSegment(key)
	if array, ok := container.([]any); ok {
		assertArrayIndex(array, key, true)
		index := key.(int)
		if index >= 0 && index < len(array) {
			return map[string]any{"found": true, "value": array[index]}
		}
		return map[string]any{"found": false, "value": nil}
	}
	object := asMap(container)
	stringKey := stringValue(key)
	value, found := object[stringKey]
	return map[string]any{"found": found, "value": value}
}

func setChildValue(container any, key any, value any) {
	key = normalizePathSegment(key)
	if array, ok := container.([]any); ok {
		assertArrayIndex(array, key, true)
		index := key.(int)
		if index < len(array) {
			array[index] = value
		}
		return
	}
	asMap(container)[stringValue(key)] = value
}

func assertArrayIndex(array []any, key any, allowAppend bool) {
	key = normalizePathSegment(key)
	index, ok := key.(int)
	if !ok || index < 0 {
		panic(patchTargetError{message: "Array path segment must be a non-negative integer: " + formatPatchKey(key)})
	}
	if index > len(array) || (!allowAppend && index >= len(array)) {
		panic(patchTargetError{message: fmt.Sprintf("Array index out of bounds: %d", index)})
	}
}

func getValueAtPath(value any, path []any) map[string]any {
	current := value
	for _, segment := range path {
		if _, ok := current.(map[string]any); !ok {
			if _, ok := current.([]any); !ok {
				return map[string]any{"found": false, "value": nil}
			}
		}
		child := getChild(current, segment)
		if !child["found"].(bool) {
			return map[string]any{"found": false, "value": nil}
		}
		current = child["value"]
	}
	return map[string]any{"found": true, "value": current}
}

func isRootLocation(location resolvedLocation) bool {
	return location.parent == nil && location.key == nil
}

func normalizePath(path any) []any {
	if path == nil {
		return []any{}
	}
	switch typed := path.(type) {
	case []any:
		result := make([]any, len(typed))
		for index, value := range typed {
			result[index] = normalizePathSegment(value)
		}
		return result
	case []string:
		result := make([]any, len(typed))
		for index, value := range typed {
			result[index] = normalizePathSegment(value)
		}
		return result
	case string:
		parts := strings.Split(typed, ".")
		result := []any{}
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			result = append(result, normalizePathSegment(part))
		}
		return result
	default:
		return []any{normalizePathSegment(typed)}
	}
}

func normalizePathSegment(value any) any {
	switch typed := value.(type) {
	case int:
		return typed
	case float64:
		if math.Trunc(typed) == typed && typed >= 0 {
			return int(typed)
		}
		return typed
	case string:
		if typed == "0" || (typed != "" && typed[0] != '0') {
			if parsed, err := strconv.Atoi(typed); err == nil && parsed >= 0 {
				return parsed
			}
		}
		return typed
	default:
		return value
	}
}

func assertValidPatch(patch RanklistPatch) {
	if patch.Type != "srk-patch" || patch.Version != 1 || patch.Operations == nil {
		panic(fmt.Errorf("invalid srk patch: expected type \"srk-patch\", version 1, and operations array"))
	}
	for index, operation := range patch.Operations {
		if operation.Target == nil {
			panic(fmt.Errorf("invalid srk patch operation at index %d", index))
		}
		if operation.Op != "set" && operation.Op != "merge" && operation.Op != "unset" && operation.Op != "append" {
			panic(fmt.Errorf("unsupported srk patch operation at index %d: %s", index, operation.Op))
		}
	}
}

func formatPatchKey(key any) string {
	if key == nil {
		return "<root>"
	}
	return fmt.Sprintf("%q", key)
}

func mergeTargets(targets ...map[string]any) map[string]any {
	result := map[string]any{}
	for _, target := range targets {
		for key, value := range target {
			result[key] = value
		}
	}
	return result
}

func isIntegerNumber(value any) bool {
	switch typed := value.(type) {
	case int:
		return true
	case int64:
		return true
	case float64:
		return math.Trunc(typed) == typed
	default:
		return false
	}
}

func truthy(value any) bool {
	if typed, ok := value.(bool); ok {
		return typed
	}
	return value != nil
}
