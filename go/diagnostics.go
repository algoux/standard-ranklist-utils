package srkutils

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

type RanklistDiagnostics struct {
	Summary      map[string]any   `json:"summary"`
	Completeness map[string]any   `json:"completeness"`
	Correctness  map[string]any   `json:"correctness"`
	Suggestions  map[string]any   `json:"suggestions"`
	Issues       []map[string]any `json:"issues"`
}

var diagnosticTimeUnits = []string{"ms", "s", "min", "h", "d"}
var diagnosticActualUnitOrder = []string{"d", "h", "min", "s", "ms"}
var diagnosticTimeUnitMS = map[string]float64{"ms": 1, "s": 1000, "min": 60000, "h": 3600000, "d": 86400000}
var sorterNoPenaltyBaseResults = []any{"FB", "AC", "?"}
var sorterNoPenaltyOptionalResults = []any{"NOUT", "CE", "UKE"}
var problemStatisticsSuspectNoPenaltyResults = []any{"CE", "NOUT", "UKE"}
var liteResults = map[string]bool{"FB": true, "AC": true, "RJ": true, "?": true}
var fullOnlyResults = map[string]bool{"WA": true, "PE": true, "TLE": true, "MLE": true, "OLE": true, "IDLE": true, "RTE": true, "NOUT": true, "CE": true, "UKE": true}

func DiagnoseRanklist(ranklist map[string]any, _options map[string]any) RanklistDiagnostics {
	issues := []map[string]any{}
	suggestions := map[string]any{
		"firstBlood":        []any{},
		"sorter":            []any{},
		"problemStatistics": []any{},
	}
	addIssue := func(issue map[string]any) map[string]any {
		normalized := map[string]any{"section": "correctness"}
		for key, value := range issue {
			normalized[key] = value
		}
		issues = append(issues, normalized)
		return normalized
	}

	precision := collectPrecisionSummary(ranklist, addIssue)
	completenessItems := buildCompletenessItems(ranklist, addIssue)
	firstBloodSuggestions := []any{}
	firstBloodCheck := checkFirstBlood(ranklist, addIssue, &firstBloodSuggestions)
	suggestions["firstBlood"] = firstBloodSuggestions
	statusesCheck := checkStatuses(ranklist, addIssue)
	problemStatisticsSuggestions := []any{}
	problemStatisticsCheck := checkProblemStatistics(ranklist, addIssue, &problemStatisticsSuggestions)
	suggestions["problemStatistics"] = problemStatisticsSuggestions
	mockSolutionsCheck := checkMockSolutions(ranklist, addIssue)
	statusSummariesCheck := checkStatusSummaries(ranklist, addIssue)
	scoresCheck := checkScores(ranklist, addIssue)
	rowOrderCheck := checkRowOrder(ranklist, addIssue)
	sorterSuggestions := []any{}
	sorterConfigCheck := checkSorterConfig(ranklist, precision, addIssue, &sorterSuggestions)
	suggestions["sorter"] = sorterSuggestions
	markersCheck := checkMarkers(ranklist, addIssue)

	return RanklistDiagnostics{
		Summary:      map[string]any{"precision": precision},
		Completeness: map[string]any{"items": completenessItems},
		Correctness: map[string]any{"checks": map[string]any{
			"firstBlood":        firstBloodCheck,
			"problemStatistics": problemStatisticsCheck,
			"mockSolutions":     mockSolutionsCheck,
			"statuses":          statusesCheck,
			"statusSummaries":   statusSummariesCheck,
			"scores":            scoresCheck,
			"rowOrder":          rowOrderCheck,
			"sorterConfig":      sorterConfigCheck,
			"markers":           markersCheck,
		}},
		Suggestions: suggestions,
		Issues:      issues,
	}
}

func collectPrecisionSummary(ranklist map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	solutionTimes := []map[string]any{}
	statusTimes := []map[string]any{}
	scoreTimes := []map[string]any{}
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		score := asMap(row["score"])
		if score["time"] != nil {
			scoreTimes = append(scoreTimes, map[string]any{"value": score["time"], "path": sprintf("rows[%d].score.time", rowIndex), "rowIndex": rowIndex, "userId": getRowUserID(row)})
		}
		for problemIndex, statusAny := range asSlice(row["statuses"]) {
			status := asMap(statusAny)
			if status["time"] != nil {
				statusTimes = append(statusTimes, map[string]any{"value": status["time"], "path": sprintf("rows[%d].statuses[%d].time", rowIndex, problemIndex), "rowIndex": rowIndex, "problemIndex": problemIndex, "userId": getRowUserID(row)})
			}
			for solutionIndex, solutionAny := range asSlice(status["solutions"]) {
				solution := asMap(solutionAny)
				if solution["time"] != nil {
					solutionTimes = append(solutionTimes, map[string]any{"value": solution["time"], "path": sprintf("rows[%d].statuses[%d].solutions[%d].time", rowIndex, problemIndex, solutionIndex), "rowIndex": rowIndex, "problemIndex": problemIndex, "userId": getRowUserID(row)})
				}
			}
		}
	}
	sorterConfig := asMap(asMap(ranklist["sorter"])["config"])
	if isICPCSorter(ranklist) && sorterConfig["penalty"] != nil && !parseTimeDuration(sorterConfig["penalty"])["valid"].(bool) {
		addIssue(map[string]any{"section": "summary", "code": "TIME_DURATION_INVALID", "message": "Invalid TimeDuration at sorter.config.penalty", "severity": "error", "confidence": "certain", "path": "sorter.config.penalty", "details": map[string]any{"value": sorterConfig["penalty"]}})
	}
	return map[string]any{
		"solutionTime": detectTimePrecision(solutionTimes, addIssue),
		"statusTime":   detectTimePrecision(statusTimes, addIssue),
		"scoreTime":    detectTimePrecision(scoreTimes, addIssue),
	}
}

func detectTimePrecision(values []map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	declaredUnits := map[string]bool{}
	nonZeroMS := []float64{}
	sampleCount := 0
	invalidCount := 0
	zeroCount := 0
	for _, sample := range values {
		parsed := parseTimeDuration(sample["value"])
		if !parsed["valid"].(bool) {
			invalidCount++
			issue := map[string]any{"section": "summary", "code": "TIME_DURATION_INVALID", "message": "Invalid TimeDuration at " + stringValue(sample["path"]), "severity": "error", "confidence": "certain", "path": sample["path"], "details": map[string]any{"value": sample["value"]}}
			for _, key := range []string{"rowIndex", "problemIndex", "userId"} {
				if value, ok := sample[key]; ok {
					issue[key] = value
				}
			}
			addIssue(issue)
			continue
		}
		sampleCount++
		declaredUnits[stringValue(parsed["unit"])] = true
		ms := numberValue(parsed["ms"])
		if isNearlyZero(ms) {
			zeroCount++
		} else {
			nonZeroMS = append(nonZeroMS, ms)
		}
	}
	var actualUnit any
	if len(nonZeroMS) > 0 {
		actualUnit = "ms"
		for _, unit := range diagnosticActualUnitOrder {
			all := true
			for _, ms := range nonZeroMS {
				if !isMultipleOf(ms, diagnosticTimeUnitMS[unit]) {
					all = false
					break
				}
			}
			if all {
				actualUnit = unit
				break
			}
		}
	}
	declared := []any{}
	for _, unit := range diagnosticTimeUnits {
		if declaredUnits[unit] {
			declared = append(declared, unit)
		}
	}
	return map[string]any{"actualUnit": actualUnit, "declaredUnits": declared, "sampleCount": sampleCount, "invalidCount": invalidCount, "zeroCount": zeroCount}
}

func buildCompletenessItems(ranklist map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	rows := asSlice(ranklist["rows"])
	problems := asSlice(ranklist["problems"])
	optionalItems := map[string]bool{"banner": true, "userAvatar": true, "userPhoto": true}
	lowSeverityItems := map[string]bool{"banner": true, "userAvatar": true, "userPhoto": true, "problemColors": true, "teamMembers": true, "coachRole": true}
	makeItem := func(key string, label string, presentCount int, totalCount int, details map[string]any, levelOverride string) map[string]any {
		ratio := any(nil)
		if totalCount > 0 {
			ratio = float64(presentCount) / float64(totalCount)
		}
		level := levelOverride
		if level == "" {
			level = levelFromCoverage(presentCount, totalCount)
		}
		normalizedDetails := map[string]any{}
		if optionalItems[key] {
			normalizedDetails["optional"] = true
		}
		for k, v := range details {
			normalizedDetails[k] = v
		}
		if level != "complete" && level != "notApplicable" {
			severity := "warning"
			if lowSeverityItems[key] || level == "mostly" {
				severity = "info"
			}
			issueDetails := map[string]any{"presentCount": presentCount, "totalCount": totalCount, "ratio": ratio}
			for k, v := range normalizedDetails {
				issueDetails[k] = v
			}
			addIssue(map[string]any{"section": "completeness", "item": key, "code": "COMPLETENESS_" + camelToConstant(key), "message": label + " completeness is " + level, "severity": severity, "confidence": "certain", "details": issueDetails})
		}
		return map[string]any{"key": key, "label": label, "level": level, "presentCount": presentCount, "totalCount": totalCount, "ratio": ratio, "details": normalizedDetails}
	}

	fbProblemIndexes := map[int]bool{}
	for _, rowAny := range rows {
		row := asMap(rowAny)
		for problemIndex, statusAny := range asSlice(row["statuses"]) {
			status := asMap(statusAny)
			if status["result"] == "FB" || anySolutionResult(asSlice(status["solutions"]), "FB") {
				fbProblemIndexes[problemIndex] = true
			}
		}
	}
	acceptedProblemIndexes := collectAcceptedProblemIndexes(ranklist)
	expectedFirstBloodProblemIndexes := sortedIntKeys(acceptedProblemIndexes)
	noAcceptedProblemIndexes := []any{}
	for index := range problems {
		if !acceptedProblemIndexes[index] {
			noAcceptedProblemIndexes = append(noAcceptedProblemIndexes, index)
		}
	}
	presentFirstBloodProblemCount := 0
	for _, index := range expectedFirstBloodProblemIndexes {
		if fbProblemIndexes[index.(int)] {
			presentFirstBloodProblemCount++
		}
	}

	icpcSeriesDetails := getICPCSeriesDetails(asSlice(ranklist["series"]))
	for _, invalidAny := range asSlice(icpcSeriesDetails["invalidSeries"]) {
		invalid := asMap(invalidAny)
		addIssue(map[string]any{"item": "icpcSeries", "code": "ICPC_SERIES_INVALID", "message": sprintf("ICPC series configuration is invalid at series[%d]", int(numberValue(invalid["index"]))), "severity": invalid["severity"], "confidence": "certain", "path": sprintf("series[%d].rule.options", int(numberValue(invalid["index"]))), "details": invalid})
	}
	icpcLevel := "complete"
	if int(numberValue(icpcSeriesDetails["icpcSeriesCount"])) == 0 {
		icpcLevel = "missing"
	} else if int(numberValue(icpcSeriesDetails["usableICPCSeriesCount"])) == 0 {
		icpcLevel = "partial"
	} else if len(asSlice(icpcSeriesDetails["incompleteSeries"])) > 0 {
		icpcLevel = "mostly"
	}
	i18nDetails := collectI18nDetails(ranklist)
	statusRowsValid := 0
	invalidRows := []any{}
	for rowIndex, rowAny := range rows {
		statuses := asSlice(asMap(rowAny)["statuses"])
		if len(statuses) == len(problems) {
			statusRowsValid++
		} else {
			invalidRows = append(invalidRows, map[string]any{"rowIndex": rowIndex, "length": len(statuses)})
		}
	}
	solutionDetails := collectSolutionCompletenessDetails(ranklist)
	consistencyDetails := collectRowUserConsistencyDetails(rows)
	solutionLevel := levelFromCoverage(int(numberValue(solutionDetails["statusesWithSolutions"])), int(numberValue(solutionDetails["submittedStatuses"])))
	if int(numberValue(solutionDetails["submittedStatuses"])) == 0 {
		solutionLevel = "notApplicable"
	}
	rowUserLevel := levelFromCoverage(int(numberValue(consistencyDetails["rowsWithAllFields"])), len(rows))
	if len(rows) <= 1 {
		rowUserLevel = "notApplicable"
	}
	problemColorCount := 0
	for _, problemAny := range problems {
		if asMap(asMap(problemAny)["style"])["backgroundColor"] != nil {
			problemColorCount++
		}
	}
	userAvatarCount := 0
	userPhotoCount := 0
	teamMembersCount := 0
	coachRoleCount := 0
	for _, rowAny := range rows {
		user := asMap(asMap(rowAny)["user"])
		if user["avatar"] != nil {
			userAvatarCount++
		}
		if user["photo"] != nil {
			userPhotoCount++
		}
		if len(asSlice(user["teamMembers"])) > 0 {
			teamMembersCount++
		}
		for _, memberAny := range asSlice(user["teamMembers"]) {
			if asMap(memberAny)["role"] == "coach" {
				coachRoleCount++
				break
			}
		}
	}
	return map[string]any{
		"banner":             makeItem("banner", "Contest banner", boolToInt(asMap(ranklist["contest"])["banner"] != nil), 1, map[string]any{"hasBanner": asMap(ranklist["contest"])["banner"] != nil}, ""),
		"firstBlood":         makeItem("firstBlood", "Problem first-blood declarations", presentFirstBloodProblemCount, len(expectedFirstBloodProblemIndexes), map[string]any{"problemIndexes": sortedIntKeys(fbProblemIndexes), "expectedProblemIndexes": expectedFirstBloodProblemIndexes, "noAcceptedProblemIndexes": noAcceptedProblemIndexes}, ""),
		"problemColors":      makeItem("problemColors", "Problem background colors", problemColorCount, len(problems), nilMap(), ""),
		"icpcSeries":         makeItem("icpcSeries", "ICPC series configuration", int(numberValue(icpcSeriesDetails["usableICPCSeriesCount"])), maxInt(1, int(numberValue(icpcSeriesDetails["icpcSeriesCount"]))), icpcSeriesDetails, icpcLevel),
		"userAvatar":         makeItem("userAvatar", "User avatars", userAvatarCount, len(rows), nilMap(), ""),
		"userPhoto":          makeItem("userPhoto", "User photos", userPhotoCount, len(rows), nilMap(), ""),
		"teamMembers":        makeItem("teamMembers", "Team member information", teamMembersCount, len(rows), nilMap(), ""),
		"coachRole":          makeItem("coachRole", "Coach team member role", coachRoleCount, len(rows), nilMap(), ""),
		"i18n":               makeItem("i18n", "i18n text coverage", int(numberValue(i18nDetails["i18nCount"])), int(numberValue(i18nDetails["totalTextCount"])), i18nDetails, ""),
		"statuses":           makeItem("statuses", "Problem status arrays", statusRowsValid, len(rows), map[string]any{"problemCount": len(problems), "invalidRows": invalidRows}, ""),
		"solutions":          makeItem("solutions", "Submission solution histories", int(numberValue(solutionDetails["statusesWithSolutions"])), int(numberValue(solutionDetails["submittedStatuses"])), solutionDetails, solutionLevel),
		"rowUserConsistency": makeItem("rowUserConsistency", "Row user field consistency", int(numberValue(consistencyDetails["rowsWithAllFields"])), len(rows), consistencyDetails, rowUserLevel),
	}
}

func checkFirstBlood(ranklist map[string]any, addIssue func(map[string]any) map[string]any, suggestions *[]any) map[string]any {
	if !isICPCSorter(ranklist) {
		return makeCheck("firstBlood", "First-blood declarations", "notApplicable", 0, 0, map[string]any{"reason": "Ranklist sorter is not ICPC"})
	}
	failedCount := 0
	checkedCount := 0
	for problemIndex := range asSlice(ranklist["problems"]) {
		declaredCells := collectDeclaredFirstBloodCells(ranklist, problemIndex)
		acceptedSolutions := collectAcceptedSolutions(ranklist, problemIndex)
		uniqueEarliest := getUniqueEarliestAcceptedSolution(acceptedSolutions)
		if len(declaredCells) > 1 {
			failedCount++
			addIssue(map[string]any{"code": "FIRST_BLOOD_MULTIPLE", "message": "Problem " + problemLabel(ranklist, problemIndex) + " has multiple first-blood declarations", "severity": "error", "confidence": "certain", "item": "firstBlood", "problemIndex": problemIndex, "details": map[string]any{"declarations": mapsToAny(declaredCells)}})
		}
		if len(acceptedSolutions) == 0 {
			continue
		}
		checkedCount++
		if uniqueEarliest == nil {
			continue
		}
		if len(declaredCells) == 0 {
			failedCount++
			confidence := "medium"
			if uniqueEarliest["source"] == "solution" {
				confidence = "high"
			}
			addIssue(map[string]any{"code": "FIRST_BLOOD_MISSING", "message": "Problem " + problemLabel(ranklist, problemIndex) + " has a unique earliest accepted solution but no first-blood declaration", "severity": "warning", "confidence": confidence, "item": "firstBlood", "problemIndex": problemIndex, "rowIndex": uniqueEarliest["rowIndex"], "userId": uniqueEarliest["userId"]})
			pushFirstBloodSuggestion(ranklist, suggestions, problemIndex, uniqueEarliest)
			continue
		}
		declared := declaredCells[0]
		if declared["rowIndex"] != uniqueEarliest["rowIndex"] {
			failedCount++
			confidence := "medium"
			if uniqueEarliest["source"] == "solution" {
				confidence = "high"
			}
			addIssue(map[string]any{"code": "FIRST_BLOOD_CONFLICT", "message": "Problem " + problemLabel(ranklist, problemIndex) + " first-blood declaration conflicts with the earliest accepted solution", "severity": "error", "confidence": confidence, "item": "firstBlood", "problemIndex": problemIndex, "rowIndex": declared["rowIndex"], "userId": declared["userId"], "details": map[string]any{"declared": declared, "expected": uniqueEarliest}})
			pushFirstBloodSuggestion(ranklist, suggestions, problemIndex, uniqueEarliest)
		} else if len(declaredCells) > 1 {
			pushFirstBloodSuggestion(ranklist, suggestions, problemIndex, uniqueEarliest)
		}
	}
	status := "pass"
	if failedCount > 0 {
		status = "fail"
	}
	return makeCheck("firstBlood", "First-blood declarations", status, checkedCount, failedCount, map[string]any{"suggestionCount": len(*suggestions)})
}

func checkProblemStatistics(ranklist map[string]any, addIssue func(map[string]any) map[string]any, suggestions *[]any) map[string]any {
	var config map[string]any
	if isICPCSorter(ranklist) {
		config = getSorterConfig(ranklist)
	}
	expected := calculateProblemStatisticsFromBestAvailableData(ranklist, config)
	mismatches := collectProblemStatisticsMismatches(ranklist, config, expected)
	if config != nil {
		*suggestions = append(*suggestions, mapsToAny(collectProblemStatisticsSuggestions(ranklist, config, mismatches))...)
	}
	checkedCount := countProblemsWithStatistics(ranklist)
	for _, mismatch := range mismatches {
		problemIndex := int(numberValue(mismatch["problemIndex"]))
		addIssue(map[string]any{"code": "PROBLEM_STATISTICS_MISMATCH", "message": "Problem " + problemLabel(ranklist, problemIndex) + " statistics do not match row statuses", "severity": "error", "confidence": "certain", "item": "problemStatistics", "problemIndex": problemIndex, "path": sprintf("problems[%d].statistics", problemIndex), "details": mismatch})
	}
	status := "pass"
	if checkedCount == 0 {
		status = "notApplicable"
	} else if len(mismatches) > 0 {
		status = "fail"
	}
	return makeCheck("problemStatistics", "Problem statistics", status, checkedCount, len(mismatches), map[string]any{"expected": mapsToAny(expected)})
}

func checkStatuses(ranklist map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	problemCount := len(asSlice(ranklist["problems"]))
	mismatches := []map[string]any{}
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		actualLength := len(asSlice(row["statuses"]))
		if actualLength != problemCount {
			mismatches = append(mismatches, map[string]any{"rowIndex": rowIndex, "userId": getRowUserID(row), "expectedLength": problemCount, "actualLength": actualLength})
		}
	}
	for _, mismatch := range mismatches {
		addIssue(map[string]any{"code": "STATUSES_LENGTH_MISMATCH", "message": "Row statuses length does not match problems length for user " + stringValue(mismatch["userId"]), "severity": "error", "confidence": "certain", "item": "statuses", "rowIndex": mismatch["rowIndex"], "userId": mismatch["userId"], "path": sprintf("rows[%d].statuses", int(numberValue(mismatch["rowIndex"]))), "details": mismatch})
	}
	status := "pass"
	if len(mismatches) > 0 {
		status = "fail"
	}
	return makeCheck("statuses", "Problem status array lengths", status, len(asSlice(ranklist["rows"])), len(mismatches), map[string]any{"problemCount": problemCount, "mismatches": mapsToAny(mismatches)})
}

func checkMockSolutions(ranklist map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	examples := []any{}
	checkedCount := 0
	suspiciousCount := 0
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		for problemIndex, statusAny := range asSlice(row["statuses"]) {
			status := asMap(statusAny)
			rjTimes := []float64{}
			for _, solutionAny := range asSlice(status["solutions"]) {
				solution := asMap(solutionAny)
				if solution["result"] == "RJ" {
					parsed := parseTimeDuration(solution["time"])
					if parsed["valid"].(bool) {
						rjTimes = append(rjTimes, numberValue(parsed["ms"]))
					}
				}
			}
			if len(rjTimes) < 2 {
				continue
			}
			checkedCount++
			pattern := detectMockTimePattern(rjTimes)
			if pattern != "" {
				suspiciousCount++
				examples = append(examples, map[string]any{"rowIndex": rowIndex, "problemIndex": problemIndex, "userId": getRowUserID(row), "pattern": pattern, "count": len(rjTimes)})
			}
		}
	}
	ratio := 0.0
	if checkedCount > 0 {
		ratio = float64(suspiciousCount) / float64(checkedCount)
	}
	confidence := "low"
	if suspiciousCount >= 2 && ratio >= 0.8 {
		confidence = "high"
	} else if suspiciousCount > 0 {
		confidence = "medium"
	}
	if suspiciousCount > 0 {
		severity := "info"
		if confidence == "high" {
			severity = "warning"
		}
		addIssue(map[string]any{"code": "MOCK_SOLUTIONS_SUSPECTED", "message": "Rejected solution timestamps look synthetically expanded from status summaries", "severity": severity, "confidence": confidence, "item": "mockSolutions", "details": map[string]any{"checkedCount": checkedCount, "suspiciousCount": suspiciousCount, "ratio": ratio, "examples": examples}})
	}
	status := "pass"
	if checkedCount == 0 {
		status = "notApplicable"
	} else if suspiciousCount > 0 {
		status = "warning"
	}
	return makeCheck("mockSolutions", "Mock solution expansion", status, checkedCount, suspiciousCount, map[string]any{"suspiciousCount": suspiciousCount, "ratio": ratio, "examples": examples})
}

func checkStatusSummaries(ranklist map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	if !isICPCSorter(ranklist) {
		return makeCheck("statusSummaries", "Status summaries from solutions", "notApplicable", 0, 0, map[string]any{"reason": "Ranklist sorter is not ICPC"})
	}
	config := getSorterConfig(ranklist)
	mismatches := collectStatusSummaryMismatches(ranklist, config)
	for _, mismatch := range mismatches {
		problemIndex := int(numberValue(mismatch["problemIndex"]))
		rowIndex := int(numberValue(mismatch["rowIndex"]))
		addIssue(map[string]any{"code": "STATUS_SUMMARY_MISMATCH", "message": "Status summary does not match detailed solutions for problem " + problemLabel(ranklist, problemIndex), "severity": "warning", "confidence": "high", "item": "statusSummaries", "rowIndex": rowIndex, "problemIndex": problemIndex, "userId": mismatch["userId"], "path": sprintf("rows[%d].statuses[%d]", rowIndex, problemIndex), "details": mismatch})
	}
	checkedCount := countStatusesWithSolutions(ranklist)
	status := "pass"
	if checkedCount == 0 {
		status = "notApplicable"
	} else if len(mismatches) > 0 {
		status = "warning"
	}
	return makeCheck("statusSummaries", "Status summaries from solutions", status, checkedCount, len(mismatches), map[string]any{"mismatches": mapsToAny(mismatches)})
}

func checkScores(ranklist map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	if !isICPCSorter(ranklist) {
		return makeCheck("scores", "ICPC score calculation", "notApplicable", 0, 0, map[string]any{"reason": "Ranklist sorter is not ICPC"})
	}
	config := getSorterConfig(ranklist)
	mismatches := collectScoreMismatches(ranklist, config)
	for _, mismatch := range mismatches {
		rowIndex := int(numberValue(mismatch["rowIndex"]))
		addIssue(map[string]any{"code": "SCORE_MISMATCH", "message": "Row score does not match status calculation for user " + stringValue(mismatch["userId"]), "severity": "error", "confidence": "certain", "item": "scores", "rowIndex": rowIndex, "userId": mismatch["userId"], "path": sprintf("rows[%d].score", rowIndex), "details": mismatch})
	}
	status := "pass"
	if len(mismatches) > 0 {
		status = "fail"
	}
	return makeCheck("scores", "ICPC score calculation", status, len(asSlice(ranklist["rows"])), len(mismatches), map[string]any{"mismatches": mapsToAny(mismatches)})
}

func checkRowOrder(ranklist map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	if !isICPCSorter(ranklist) {
		return makeCheck("rowOrder", "ICPC row order", "notApplicable", 0, 0, map[string]any{"reason": "Ranklist sorter is not ICPC"})
	}
	rowsCopy := []map[string]any{}
	for _, rowAny := range asSlice(ranklist["rows"]) {
		rowsCopy = append(rowsCopy, deepCopyMap(asMap(rowAny)))
	}
	expectedRows := SortRows(rowsCopy, nil)
	expectedOrder := []any{}
	for _, row := range expectedRows {
		expectedOrder = append(expectedOrder, getRowUserID(row))
	}
	mismatches := collectRowOrderMismatches(ranklist)
	for _, mismatch := range mismatches {
		rowIndex := int(numberValue(mismatch["rowIndex"]))
		addIssue(map[string]any{"code": "ROW_ORDER_MISMATCH", "message": sprintf("Rows %d and %d are out of ICPC score order", rowIndex, int(numberValue(mismatch["nextRowIndex"]))), "severity": "error", "confidence": "certain", "item": "rowOrder", "rowIndex": rowIndex, "userId": mismatch["userId"], "details": mismatch})
	}
	status := "pass"
	if len(mismatches) > 0 {
		status = "fail"
	}
	rows := asSlice(ranklist["rows"])
	return makeCheck("rowOrder", "ICPC row order", status, maxInt(0, len(rows)-1), len(mismatches), map[string]any{"expectedOrder": expectedOrder, "mismatches": mapsToAny(mismatches)})
}

func checkSorterConfig(ranklist map[string]any, precision map[string]any, addIssue func(map[string]any) map[string]any, suggestions *[]any) map[string]any {
	if !isICPCSorter(ranklist) {
		return makeCheck("sorterConfig", "Sorter configuration", "notApplicable", 0, 0, map[string]any{"reason": "Ranklist sorter is not ICPC"})
	}
	current := getSorterConfig(ranklist)
	baseline := evaluateSorterConfig(ranklist, current)
	if int(numberValue(baseline["issueCount"])) == 0 {
		return makeCheck("sorterConfig", "Sorter configuration", "pass", int(numberValue(baseline["checkedCount"])), 0, map[string]any{"baseline": baseline})
	}
	candidateSuggestions := collectSorterSuggestions(ranklist, current, precision, baseline)
	*suggestions = append(*suggestions, mapsToAny(candidateSuggestions)...)
	if len(candidateSuggestions) > 0 {
		addIssue(map[string]any{"code": "SORTER_CONFIG_MISMATCH", "message": "Alternative sorter configuration matches the declared ranklist better", "severity": "warning", "confidence": candidateSuggestions[0]["confidence"], "item": "sorterConfig", "details": map[string]any{"baseline": baseline, "suggestions": mapsToAny(candidateSuggestions)}})
	}
	status := "fail"
	if len(candidateSuggestions) > 0 {
		status = "warning"
	}
	return makeCheck("sorterConfig", "Sorter configuration", status, int(numberValue(baseline["checkedCount"])), int(numberValue(baseline["issueCount"])), map[string]any{"baseline": baseline, "suggestions": mapsToAny(candidateSuggestions)})
}

func checkMarkers(ranklist map[string]any, addIssue func(map[string]any) map[string]any) map[string]any {
	markerIDs := map[string]bool{}
	for _, markerAny := range asSlice(ranklist["markers"]) {
		markerIDs[stringValue(asMap(markerAny)["id"])] = true
	}
	checkedCount := 0
	failedCount := 0
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		for _, markerID := range collectRowMarkerIDs(asMap(row["user"])) {
			checkedCount++
			if !markerIDs[markerID] {
				failedCount++
				addIssue(map[string]any{"code": "MARKER_UNDECLARED", "message": "User marker \"" + markerID + "\" is not declared in ranklist.markers", "severity": "warning", "confidence": "certain", "item": "markers", "rowIndex": rowIndex, "userId": getRowUserID(row), "path": sprintf("rows[%d].user", rowIndex), "details": map[string]any{"markerId": markerID}})
			}
		}
	}
	for seriesIndex, seriesAny := range asSlice(ranklist["series"]) {
		rule := asMap(asMap(seriesAny)["rule"])
		if rule["preset"] != "ICPC" {
			continue
		}
		byMarker := stringValue(asMap(asMap(asMap(rule["options"])["filter"])["byMarker"]))
		if byMarker == "" {
			continue
		}
		checkedCount++
		if !markerIDs[byMarker] {
			failedCount++
			addIssue(map[string]any{"code": "MARKER_UNDECLARED", "message": "Series marker filter \"" + byMarker + "\" is not declared in ranklist.markers", "severity": "warning", "confidence": "certain", "item": "markers", "path": sprintf("series[%d].rule.options.filter.byMarker", seriesIndex), "details": map[string]any{"markerId": byMarker, "seriesIndex": seriesIndex}})
		}
	}
	declared := []any{}
	for id := range markerIDs {
		if id != "" {
			declared = append(declared, id)
		}
	}
	status := "pass"
	if checkedCount == 0 {
		status = "notApplicable"
	} else if failedCount > 0 {
		status = "fail"
	}
	return makeCheck("markers", "Marker declarations", status, checkedCount, failedCount, map[string]any{"declaredMarkerIds": declared})
}

func collectStatusSummaryMismatches(ranklist map[string]any, config map[string]any) []map[string]any {
	mismatches := []map[string]any{}
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		for problemIndex, statusAny := range asSlice(row["statuses"]) {
			status := asMap(statusAny)
			if len(asSlice(status["solutions"])) == 0 {
				continue
			}
			expected := calculateStatusSummaryFromSolutions(asSlice(status["solutions"]), config)
			current := normalizeStatusSummary(status)
			reasons := []any{}
			if current["result"] != expected["result"] {
				reasons = append(reasons, "result")
			}
			if numberValue(current["tries"]) != numberValue(expected["tries"]) {
				reasons = append(reasons, "tries")
			}
			if !sameStatusSummaryOptionalTime(current["time"], expected["time"]) {
				reasons = append(reasons, "time")
			}
			if len(reasons) > 0 {
				solutions := []any{}
				for _, solutionAny := range asSlice(status["solutions"]) {
					solutions = append(solutions, asMap(solutionAny)["result"])
				}
				mismatches = append(mismatches, map[string]any{"rowIndex": rowIndex, "problemIndex": problemIndex, "userId": getRowUserID(row), "actual": current, "expected": expected, "solutions": solutions, "mismatchReasons": reasons})
			}
		}
	}
	return mismatches
}

func calculateProblemStatisticsFromBestAvailableData(ranklist map[string]any, config map[string]any) []map[string]any {
	problemCount := len(asSlice(ranklist["problems"]))
	accepted := make([]int, problemCount)
	submitted := make([]int, problemCount)
	for _, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		statuses := asSlice(row["statuses"])
		for problemIndex := 0; problemIndex < problemCount; problemIndex++ {
			if problemIndex >= len(statuses) {
				continue
			}
			status := asMap(statuses[problemIndex])
			var summary map[string]any
			if config != nil && len(asSlice(status["solutions"])) > 0 {
				summary = calculateStatusSummaryFromSolutions(asSlice(status["solutions"]), config)
			} else {
				summary = normalizeStatusSummary(status)
			}
			if summary["result"] == "AC" || summary["result"] == "FB" {
				accepted[problemIndex]++
			}
			if config != nil && len(asSlice(status["solutions"])) > 0 {
				submitted[problemIndex] += int(numberValue(summary["tries"]))
			} else if len(asSlice(status["solutions"])) > 0 {
				submitted[problemIndex] += len(asSlice(status["solutions"]))
			} else {
				submitted[problemIndex] += int(numberValue(status["tries"]))
			}
		}
	}
	result := []map[string]any{}
	for index := range asSlice(ranklist["problems"]) {
		result = append(result, map[string]any{"accepted": accepted[index], "submitted": submitted[index]})
	}
	return result
}

func collectProblemStatisticsMismatches(ranklist map[string]any, config map[string]any, expected []map[string]any) []map[string]any {
	mismatches := []map[string]any{}
	for problemIndex, problemAny := range asSlice(ranklist["problems"]) {
		problem := asMap(problemAny)
		statistics := asMap(problem["statistics"])
		if len(statistics) == 0 {
			continue
		}
		expectedStatistics := expected[problemIndex]
		if numberValue(statistics["accepted"]) != numberValue(expectedStatistics["accepted"]) || numberValue(statistics["submitted"]) != numberValue(expectedStatistics["submitted"]) {
			mismatches = append(mismatches, map[string]any{"problemIndex": problemIndex, "actual": statistics, "expected": expectedStatistics})
		}
	}
	return mismatches
}

func collectProblemStatisticsSuggestions(ranklist map[string]any, config map[string]any, mismatches []map[string]any) []map[string]any {
	removedResults := []any{}
	for _, result := range problemStatisticsSuspectNoPenaltyResults {
		if containsValue(asSlice(config["noPenaltyResults"]), result) {
			removedResults = append(removedResults, result)
		}
	}
	if len(removedResults) == 0 || len(mismatches) == 0 {
		return nil
	}
	suspectNoPenalty := []any{}
	for _, result := range asSlice(config["noPenaltyResults"]) {
		if !containsValue(problemStatisticsSuspectNoPenaltyResults, result) {
			suspectNoPenalty = append(suspectNoPenalty, result)
		}
	}
	suspectConfig := deepCopyMap(config)
	suspectConfig["noPenaltyResults"] = suspectNoPenalty
	suspectStatistics := calculateProblemStatisticsFromBestAvailableData(ranklist, suspectConfig)
	suggestions := []map[string]any{}
	for _, mismatch := range mismatches {
		problemIndex := int(numberValue(mismatch["problemIndex"]))
		if sameProblemStatistics(suspectStatistics[problemIndex], asMap(mismatch["actual"])) {
			suggestions = append(suggestions, map[string]any{"problemIndex": problemIndex, "problemAlias": asMap(asSlice(ranklist["problems"])[problemIndex])["alias"], "actual": mismatch["actual"], "expected": mismatch["expected"], "confidence": "high", "reason": "declared statistics match a calculation where CE/NOUT/UKE count as penalty submissions", "details": map[string]any{"withoutNoPenaltyResults": []any{"CE", "NOUT", "UKE"}}})
		}
	}
	return suggestions
}

func collectScoreMismatches(ranklist map[string]any, config map[string]any) []map[string]any {
	mismatches := []map[string]any{}
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		expected := calculateScoreFromStatuses(asSlice(row["statuses"]), config)
		if expected == nil {
			continue
		}
		score := asMap(row["score"])
		currentTime := map[string]any{"valid": true, "ms": 0}
		if score["time"] != nil {
			currentTime = parseTimeDuration(score["time"])
		}
		expectedTime := parseTimeDuration(expected["time"])
		currentMS := math.NaN()
		if currentTime["valid"].(bool) {
			currentMS = numberValue(currentTime["ms"])
		}
		expectedMS := math.NaN()
		if expectedTime["valid"].(bool) {
			expectedMS = numberValue(expectedTime["ms"])
		}
		reasons := []any{}
		if numberValue(score["value"]) != numberValue(expected["value"]) {
			reasons = append(reasons, "value")
		}
		if !isNearlyEqual(currentMS, expectedMS) {
			reasons = append(reasons, "time")
		}
		if len(reasons) > 0 {
			mismatches = append(mismatches, map[string]any{"rowIndex": rowIndex, "userId": getRowUserID(row), "actual": score, "expected": expected, "mismatchReasons": reasons})
		}
	}
	return mismatches
}

func collectStatusTriesMismatches(ranklist map[string]any, config map[string]any) []map[string]any {
	mismatches := []map[string]any{}
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		for problemIndex, statusAny := range asSlice(row["statuses"]) {
			status := asMap(statusAny)
			if len(asSlice(status["solutions"])) == 0 {
				continue
			}
			expected := calculateStatusSummaryFromSolutions(asSlice(status["solutions"]), config)
			current := normalizeStatusSummary(status)
			if numberValue(current["tries"]) != numberValue(expected["tries"]) {
				mismatches = append(mismatches, map[string]any{"rowIndex": rowIndex, "problemIndex": problemIndex, "userId": getRowUserID(row), "actual": current, "expected": expected, "mismatchReasons": []any{"tries"}})
			}
		}
	}
	return mismatches
}

func collectRowOrderMismatches(ranklist map[string]any) []map[string]any {
	mismatches := []map[string]any{}
	rows := asSlice(ranklist["rows"])
	for rowIndex := 0; rowIndex < len(rows)-1; rowIndex++ {
		current := asMap(rows[rowIndex])
		next := asMap(rows[rowIndex+1])
		if compareRowsByScore(current, next) > 0 {
			mismatches = append(mismatches, map[string]any{"rowIndex": rowIndex, "nextRowIndex": rowIndex + 1, "userId": getRowUserID(current), "nextUserId": getRowUserID(next), "currentScore": current["score"], "nextScore": next["score"]})
		}
	}
	return mismatches
}

func evaluateSorterConfig(ranklist map[string]any, config map[string]any) map[string]any {
	statusSummaryMismatchCount := len(collectStatusSummaryMismatches(ranklist, config))
	problemStatisticsMismatchCount := len(collectProblemStatisticsMismatches(ranklist, config, calculateProblemStatisticsFromBestAvailableData(ranklist, config)))
	triesMismatchCount := len(collectStatusTriesMismatches(ranklist, config))
	scoreMismatchCount := len(collectScoreMismatches(ranklist, config))
	rowOrderMismatchCount := len(collectRowOrderMismatches(ranklist))
	issueCount := statusSummaryMismatchCount + problemStatisticsMismatchCount + scoreMismatchCount + rowOrderMismatchCount
	rows := asSlice(ranklist["rows"])
	return map[string]any{"statusSummaryMismatchCount": statusSummaryMismatchCount, "problemStatisticsMismatchCount": problemStatisticsMismatchCount, "triesMismatchCount": triesMismatchCount, "statusMismatchCount": triesMismatchCount, "scoreMismatchCount": scoreMismatchCount, "rowOrderMismatchCount": rowOrderMismatchCount, "issueCount": issueCount, "checkedCount": countStatusesWithSolutions(ranklist) + countProblemsWithStatistics(ranklist) + len(rows) + maxInt(0, len(rows)-1)}
}

func collectSorterSuggestions(ranklist map[string]any, current map[string]any, precision map[string]any, baseline map[string]any) []map[string]any {
	timePrecisionCandidates := uniqueAny([]any{current["timePrecision"], asMap(precision["statusTime"])["actualUnit"], asMap(precision["solutionTime"])["actualUnit"], "ms", "s", "min"})
	roundingCandidates := []any{"floor", "ceil", "round"}
	noPenaltyCandidates := uniqueNoPenaltyCandidates(asSlice(current["noPenaltyResults"]))
	type evaluatedCandidate struct {
		candidate  map[string]any
		evaluation map[string]any
	}
	evaluated := []evaluatedCandidate{}
	for _, timePrecision := range timePrecisionCandidates {
		for _, timeRounding := range roundingCandidates {
			for _, noPenaltyResults := range noPenaltyCandidates {
				candidate := deepCopyMap(current)
				candidate["timePrecision"] = timePrecision
				candidate["timeRounding"] = timeRounding
				candidate["noPenaltyResults"] = noPenaltyResults
				evaluation := evaluateSorterConfig(ranklist, candidate)
				if int(numberValue(evaluation["issueCount"])) < int(numberValue(baseline["issueCount"])) {
					evaluated = append(evaluated, evaluatedCandidate{candidate: candidate, evaluation: evaluation})
				}
			}
		}
	}
	sort.SliceStable(evaluated, func(i, j int) bool {
		a := evaluated[i]
		b := evaluated[j]
		if numberValue(a.evaluation["issueCount"]) != numberValue(b.evaluation["issueCount"]) {
			return numberValue(a.evaluation["issueCount"]) < numberValue(b.evaluation["issueCount"])
		}
		if sorterIssueReduction(baseline, a.evaluation) != sorterIssueReduction(baseline, b.evaluation) {
			return sorterIssueReduction(baseline, a.evaluation) > sorterIssueReduction(baseline, b.evaluation)
		}
		nda := noPenaltyDifferenceSize(asSlice(current["noPenaltyResults"]), asSlice(a.candidate["noPenaltyResults"]))
		ndb := noPenaltyDifferenceSize(asSlice(current["noPenaltyResults"]), asSlice(b.candidate["noPenaltyResults"]))
		if nda != ndb {
			return nda < ndb
		}
		psa := sorterConfigPatchSize(current, a.candidate)
		psb := sorterConfigPatchSize(current, b.candidate)
		if psa != psb {
			return psa < psb
		}
		return jsonKey(buildSorterConfigPatch(current, a.candidate)) < jsonKey(buildSorterConfigPatch(current, b.candidate))
	})
	suggestions := []map[string]any{}
	seen := map[string]bool{}
	for _, item := range evaluated {
		patch := buildSorterConfigPatch(current, item.candidate)
		key := jsonKey(patch)
		if len(patch) == 0 || seen[key] {
			continue
		}
		seen[key] = true
		suggestions = append(suggestions, map[string]any{"config": patch, "confidence": sorterSuggestionConfidence(baseline, item.evaluation), "resolvedIssues": describeResolvedSorterIssues(baseline, item.evaluation), "details": map[string]any{"baseline": baseline, "evaluation": item.evaluation}})
		if len(suggestions) >= 5 {
			break
		}
	}
	return suggestions
}

func buildSorterConfigPatch(current map[string]any, candidate map[string]any) map[string]any {
	patch := map[string]any{}
	if candidate["timePrecision"] != current["timePrecision"] {
		patch["timePrecision"] = candidate["timePrecision"]
	}
	if candidate["timeRounding"] != current["timeRounding"] {
		patch["timeRounding"] = candidate["timeRounding"]
	}
	if !sameNoPenaltyResults(asSlice(candidate["noPenaltyResults"]), asSlice(current["noPenaltyResults"])) {
		patch["noPenaltyResults"] = candidate["noPenaltyResults"]
	}
	return patch
}

func sorterConfigPatchSize(current map[string]any, candidate map[string]any) int {
	return len(buildSorterConfigPatch(current, candidate))
}

func describeResolvedSorterIssues(baseline map[string]any, evaluation map[string]any) []any {
	resolved := []any{}
	if numberValue(evaluation["statusSummaryMismatchCount"]) < numberValue(baseline["statusSummaryMismatchCount"]) {
		resolved = append(resolved, "statusSummaries")
	}
	if numberValue(evaluation["problemStatisticsMismatchCount"]) < numberValue(baseline["problemStatisticsMismatchCount"]) {
		resolved = append(resolved, "problemStatistics")
	}
	if numberValue(evaluation["triesMismatchCount"]) < numberValue(baseline["triesMismatchCount"]) {
		resolved = append(resolved, "statusTries")
	}
	if numberValue(evaluation["scoreMismatchCount"]) < numberValue(baseline["scoreMismatchCount"]) {
		resolved = append(resolved, "scores")
	}
	if numberValue(evaluation["rowOrderMismatchCount"]) < numberValue(baseline["rowOrderMismatchCount"]) {
		resolved = append(resolved, "rowOrder")
	}
	return resolved
}

func sorterIssueReduction(baseline map[string]any, evaluation map[string]any) int {
	return int(numberValue(baseline["issueCount"]) - numberValue(evaluation["issueCount"]))
}

func sorterSuggestionConfidence(baseline map[string]any, evaluation map[string]any) string {
	if int(numberValue(evaluation["issueCount"])) == 0 {
		return "high"
	}
	reduction := sorterIssueReduction(baseline, evaluation)
	ratio := 0.0
	if numberValue(baseline["issueCount"]) != 0 {
		ratio = float64(reduction) / numberValue(baseline["issueCount"])
	}
	solvedCategory := (numberValue(baseline["statusSummaryMismatchCount"]) > 0 && numberValue(evaluation["statusSummaryMismatchCount"]) == 0) || (numberValue(baseline["problemStatisticsMismatchCount"]) > 0 && numberValue(evaluation["problemStatisticsMismatchCount"]) == 0) || (numberValue(baseline["triesMismatchCount"]) > 0 && numberValue(evaluation["triesMismatchCount"]) == 0) || (numberValue(baseline["scoreMismatchCount"]) > 0 && numberValue(evaluation["scoreMismatchCount"]) == 0) || (numberValue(baseline["rowOrderMismatchCount"]) > 0 && numberValue(evaluation["rowOrderMismatchCount"]) == 0)
	if solvedCategory && ratio >= 0.25 {
		return "medium"
	}
	return "low"
}

func noPenaltyDifferenceSize(left []any, right []any) int {
	leftKeys := map[string]bool{}
	rightKeys := map[string]bool{}
	for _, value := range left {
		leftKeys[noPenaltyResultKey(value)] = true
	}
	for _, value := range right {
		rightKeys[noPenaltyResultKey(value)] = true
	}
	size := 0
	for key := range leftKeys {
		if !rightKeys[key] {
			size++
		}
	}
	for key := range rightKeys {
		if !leftKeys[key] {
			size++
		}
	}
	return size
}

func noPenaltyResultKey(result any) string {
	if result == nil {
		return "__null__"
	}
	return "value:" + stringValue(result)
}

func uniqueNoPenaltyCandidates(_current []any) [][]any {
	candidates := [][]any{}
	optionalCount := len(sorterNoPenaltyOptionalResults)
	for mask := 0; mask < 1<<optionalCount; mask++ {
		candidate := append([]any{}, sorterNoPenaltyBaseResults...)
		for index, result := range sorterNoPenaltyOptionalResults {
			if mask&(1<<index) != 0 {
				candidate = append(candidate, result)
			}
		}
		candidate = append(candidate, nil)
		candidates = append(candidates, candidate)
	}
	seen := map[string]bool{}
	unique := [][]any{}
	for _, candidate := range candidates {
		key := jsonKey(candidate)
		if seen[key] {
			continue
		}
		seen[key] = true
		unique = append(unique, candidate)
	}
	return unique
}

func calculateStatusSummaryFromSolutions(solutions []any, config map[string]any) map[string]any {
	summary := map[string]any{"result": nil, "tries": 0}
	for _, solutionAny := range solutions {
		solution := asMap(solutionAny)
		result := solution["result"]
		if result == nil {
			continue
		}
		isNoPenaltyResult := containsValue(asSlice(config["noPenaltyResults"]), result)
		if result == "?" {
			summary["result"] = "?"
			if !isNoPenaltyResult {
				summary["tries"] = numberValue(summary["tries"]) + 1
			}
			continue
		}
		if result == "AC" || result == "FB" {
			summary["result"] = result
			summary["time"] = solution["time"]
			summary["tries"] = numberValue(summary["tries"]) + 1
			break
		}
		if isNoPenaltyResult {
			continue
		}
		summary["result"] = "RJ"
		summary["tries"] = numberValue(summary["tries"]) + 1
	}
	normalizeIntegralNumbers(summary)
	return summary
}

func calculateScoreFromStatuses(statuses []any, config map[string]any) map[string]any {
	penaltyMS, ok := safeFormatTimeDuration(config["penalty"], "ms", nil)
	if !ok {
		return nil
	}
	value := 0
	timeMS := 0.0
	for _, statusAny := range statuses {
		status := asMap(statusAny)
		if (status["result"] == "AC" || status["result"] == "FB") && status["time"] != nil {
			timePrecision := stringValue(config["timePrecision"])
			if timePrecision == "" {
				timePrecision = "ms"
			}
			targetTimeValue, ok := safeFormatTimeDuration(status["time"], timePrecision, roundingFn(stringValue(config["timeRounding"])))
			if !ok {
				return nil
			}
			targetTime := []any{targetTimeValue, timePrecision}
			value++
			timeMS += FormatTimeDuration(targetTime, "ms", nil) + math.Max(0, numberValue(getDeclaredAcceptedTries(status))-1)*penaltyMS
		}
	}
	return map[string]any{"value": value, "time": []any{timeMS, "ms"}}
}

func getDeclaredAcceptedTries(status map[string]any) int {
	if status["tries"] == nil {
		return 1
	}
	return int(numberValue(status["tries"]))
}

func normalizeStatusSummary(status map[string]any) map[string]any {
	result := map[string]any{"result": nil, "tries": 0}
	if _, ok := status["result"]; ok {
		result["result"] = status["result"]
	}
	if status["tries"] != nil {
		result["tries"] = int(numberValue(status["tries"]))
	}
	if status["time"] != nil {
		result["time"] = status["time"]
	}
	return result
}

func getSorterConfig(ranklist map[string]any) map[string]any {
	rawConfig := map[string]any{}
	if isICPCSorter(ranklist) {
		rawConfig = asMap(asMap(ranklist["sorter"])["config"])
	}
	timeRounding := stringValue(rawConfig["timeRounding"])
	if timeRounding != "ceil" && timeRounding != "round" && timeRounding != "floor" {
		timeRounding = "floor"
	}
	noPenalty := append([]any{}, defaultNoPenaltyResults...)
	if raw := asSlice(rawConfig["noPenaltyResults"]); rawConfig["noPenaltyResults"] != nil {
		noPenalty = append([]any{}, raw...)
	}
	var timePrecision any
	if isTimeUnit(rawConfig["timePrecision"]) {
		timePrecision = rawConfig["timePrecision"]
	}
	penalty := rawConfig["penalty"]
	if penalty == nil {
		penalty = []any{20, "min"}
	}
	return map[string]any{"penalty": penalty, "noPenaltyResults": noPenalty, "timePrecision": timePrecision, "timeRounding": timeRounding}
}

func compareRowsByScore(a map[string]any, b map[string]any) float64 {
	aScore := asMap(a["score"])
	bScore := asMap(b["score"])
	if numberValue(aScore["value"]) != numberValue(bScore["value"]) {
		return numberValue(bScore["value"]) - numberValue(aScore["value"])
	}
	timeA := map[string]any{"valid": true, "ms": 0}
	if aScore["time"] != nil {
		timeA = parseTimeDuration(aScore["time"])
	}
	timeB := map[string]any{"valid": true, "ms": 0}
	if bScore["time"] != nil {
		timeB = parseTimeDuration(bScore["time"])
	}
	if !timeA["valid"].(bool) || !timeB["valid"].(bool) {
		return 0
	}
	return numberValue(timeA["ms"]) - numberValue(timeB["ms"])
}

func collectDeclaredFirstBloodCells(ranklist map[string]any, problemIndex int) []map[string]any {
	cells := map[string]map[string]any{}
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		statuses := asSlice(row["statuses"])
		if problemIndex >= len(statuses) {
			continue
		}
		status := asMap(statuses[problemIndex])
		key := sprintf("%d:%d", rowIndex, problemIndex)
		add := func(source string, time any, solutionIndex *int) {
			current := cells[key]
			if current == nil {
				current = map[string]any{"rowIndex": rowIndex, "problemIndex": problemIndex, "userId": getRowUserID(row), "sources": []any{}}
			}
			current["sources"] = append(asSlice(current["sources"]), source)
			if time != nil {
				current["time"] = time
			}
			if solutionIndex != nil {
				current["solutionIndex"] = *solutionIndex
			}
			cells[key] = current
		}
		if status["result"] == "FB" {
			add("status", status["time"], nil)
		}
		for solutionIndex, solutionAny := range asSlice(status["solutions"]) {
			if asMap(solutionAny)["result"] == "FB" {
				idx := solutionIndex
				add("solution", asMap(solutionAny)["time"], &idx)
			}
		}
	}
	result := []map[string]any{}
	for _, value := range cells {
		result = append(result, value)
	}
	sort.SliceStable(result, func(i, j int) bool { return numberValue(result[i]["rowIndex"]) < numberValue(result[j]["rowIndex"]) })
	return result
}

func collectAcceptedProblemIndexes(ranklist map[string]any) map[int]bool {
	indexes := map[int]bool{}
	for problemIndex, problemAny := range asSlice(ranklist["problems"]) {
		if numberValue(asMap(asMap(problemAny)["statistics"])["accepted"]) > 0 {
			indexes[problemIndex] = true
		}
	}
	for _, rowAny := range asSlice(ranklist["rows"]) {
		for problemIndex, statusAny := range asSlice(asMap(rowAny)["statuses"]) {
			status := asMap(statusAny)
			if status["result"] == "AC" || status["result"] == "FB" || anyAcceptedSolution(asSlice(status["solutions"])) {
				indexes[problemIndex] = true
			}
		}
	}
	return indexes
}

func collectAcceptedSolutions(ranklist map[string]any, problemIndex int) []map[string]any {
	accepted := []map[string]any{}
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		row := asMap(rowAny)
		statuses := asSlice(row["statuses"])
		if problemIndex >= len(statuses) {
			continue
		}
		status := asMap(statuses[problemIndex])
		solutions := asSlice(status["solutions"])
		if len(solutions) > 0 {
			for solutionIndex, solutionAny := range solutions {
				solution := asMap(solutionAny)
				if solution["result"] != "AC" && solution["result"] != "FB" {
					continue
				}
				parsed := parseTimeDuration(solution["time"])
				if !parsed["valid"].(bool) {
					continue
				}
				accepted = append(accepted, map[string]any{"rowIndex": rowIndex, "problemIndex": problemIndex, "solutionIndex": solutionIndex, "userId": getRowUserID(row), "result": solution["result"], "source": "solution", "time": solution["time"], "ms": parsed["ms"]})
			}
			continue
		}
		if (status["result"] != "AC" && status["result"] != "FB") || status["time"] == nil {
			continue
		}
		parsed := parseTimeDuration(status["time"])
		if !parsed["valid"].(bool) {
			continue
		}
		accepted = append(accepted, map[string]any{"rowIndex": rowIndex, "problemIndex": problemIndex, "solutionIndex": -1, "userId": getRowUserID(row), "result": status["result"], "source": "status", "time": status["time"], "ms": parsed["ms"]})
	}
	sort.SliceStable(accepted, func(i, j int) bool { return numberValue(accepted[i]["ms"]) < numberValue(accepted[j]["ms"]) })
	return accepted
}

func getUniqueEarliestAcceptedSolution(acceptedSolutions []map[string]any) map[string]any {
	if len(acceptedSolutions) == 0 {
		return nil
	}
	if len(acceptedSolutions) > 1 && isNearlyEqual(numberValue(acceptedSolutions[0]["ms"]), numberValue(acceptedSolutions[1]["ms"])) {
		return nil
	}
	return acceptedSolutions[0]
}

func pushFirstBloodSuggestion(ranklist map[string]any, suggestions *[]any, problemIndex int, accepted map[string]any) {
	for _, suggestionAny := range *suggestions {
		if int(numberValue(asMap(suggestionAny)["problemIndex"])) == problemIndex {
			return
		}
	}
	*suggestions = append(*suggestions, map[string]any{"problemIndex": problemIndex, "problemAlias": asMap(asSlice(ranklist["problems"])[problemIndex])["alias"], "userId": accepted["userId"], "rowIndex": accepted["rowIndex"], "time": accepted["time"]})
}

func collectSolutionCompletenessDetails(ranklist map[string]any) map[string]any {
	submittedStatuses := 0
	statusesWithSolutions := 0
	solutionCount := 0
	exactResultCount := 0
	liteResultCount := 0
	predefinedFullOnlyResultCount := 0
	customResultCount := 0
	invalidNullSolutionResultCount := 0
	for _, rowAny := range asSlice(ranklist["rows"]) {
		for _, statusAny := range asSlice(asMap(rowAny)["statuses"]) {
			status := asMap(statusAny)
			solutions := asSlice(status["solutions"])
			if status["result"] != nil || numberValue(status["tries"]) > 0 || len(solutions) > 0 {
				submittedStatuses++
			}
			if len(solutions) > 0 {
				statusesWithSolutions++
			}
			for _, solutionAny := range solutions {
				result := asMap(solutionAny)["result"]
				solutionCount++
				if result == nil {
					invalidNullSolutionResultCount++
				} else if liteResults[stringValue(result)] {
					liteResultCount++
				} else if fullOnlyResults[stringValue(result)] {
					predefinedFullOnlyResultCount++
					exactResultCount++
				} else {
					customResultCount++
					exactResultCount++
				}
			}
		}
	}
	return map[string]any{"submittedStatuses": submittedStatuses, "statusesWithSolutions": statusesWithSolutions, "solutionCount": solutionCount, "exactResultCount": exactResultCount, "liteResultCount": liteResultCount, "predefinedLiteResultCount": liteResultCount, "predefinedFullOnlyResultCount": predefinedFullOnlyResultCount, "customResultCount": customResultCount, "invalidNullSolutionResultCount": invalidNullSolutionResultCount}
}

func collectI18nDetails(ranklist map[string]any) map[string]any {
	texts := []map[string]any{{"path": "contest.title", "text": asMap(ranklist["contest"])["title"]}}
	for rowIndex, rowAny := range asSlice(ranklist["rows"]) {
		user := asMap(asMap(rowAny)["user"])
		texts = append(texts, map[string]any{"path": sprintf("rows[%d].user.name", rowIndex), "text": user["name"]})
		if _, ok := user["organization"]; ok {
			texts = append(texts, map[string]any{"path": sprintf("rows[%d].user.organization", rowIndex), "text": user["organization"]})
		}
	}
	languageCounts := map[string]int{}
	i18nPaths := []any{}
	for _, item := range texts {
		if isI18nText(item["text"]) {
			i18nPaths = append(i18nPaths, item["path"])
			for lang := range asMap(item["text"]) {
				languageCounts[lang]++
			}
		}
	}
	return map[string]any{"totalTextCount": len(texts), "i18nCount": len(i18nPaths), "plainTextCount": len(texts) - len(i18nPaths), "i18nPaths": i18nPaths, "languageCounts": intMapToAny(languageCounts)}
}

func collectRowUserConsistencyDetails(rows []any) map[string]any {
	fieldSet := map[string]bool{}
	for _, rowAny := range rows {
		for key := range asMap(asMap(rowAny)["user"]) {
			fieldSet[key] = true
		}
	}
	fields := []string{}
	for field := range fieldSet {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	missingByRow := []any{}
	for rowIndex, rowAny := range rows {
		user := asMap(asMap(rowAny)["user"])
		missingFields := []any{}
		for _, field := range fields {
			if _, ok := user[field]; !ok {
				missingFields = append(missingFields, field)
			}
		}
		if len(missingFields) > 0 {
			missingByRow = append(missingByRow, map[string]any{"rowIndex": rowIndex, "userId": getRowUserID(asMap(rowAny)), "missingFields": missingFields})
		}
	}
	return map[string]any{"fields": stringsToAny(fields), "rowsWithAllFields": len(rows) - len(missingByRow), "missingByRow": missingByRow}
}

func getICPCSeriesDetails(series []any) map[string]any {
	icpcSeriesCount := 0
	incompleteSeries := []any{}
	invalidSeries := []any{}
	usableICPCSeriesCount := 0
	for index, seriesAny := range series {
		seriesConfig := asMap(seriesAny)
		rule := asMap(seriesConfig["rule"])
		if rule["preset"] != "ICPC" {
			continue
		}
		icpcSeriesCount++
		options := asMap(rule["options"])
		countValues := asSlice(asMap(options["count"])["value"])
		ratioValues := asSlice(asMap(options["ratio"])["value"])
		hasUsableCount := false
		for valueIndex, value := range countValues {
			if numberValue(value) > 0 {
				hasUsableCount = true
			}
			if math.Trunc(numberValue(value)) != numberValue(value) || numberValue(value) < 0 {
				invalidSeries = append(invalidSeries, map[string]any{"index": index, "valueIndex": valueIndex, "field": "count.value", "value": value, "severity": "error"})
			}
		}
		hasUsableRatio := false
		ratioSum := 0.0
		for valueIndex, value := range ratioValues {
			ratio := numberValue(value)
			ratioSum += ratio
			if ratio > 0 {
				hasUsableRatio = true
			}
			if ratio <= 0 || ratio > 1 {
				invalidSeries = append(invalidSeries, map[string]any{"index": index, "valueIndex": valueIndex, "field": "ratio.value", "value": value, "severity": "error"})
			}
		}
		if hasUsableCount || hasUsableRatio {
			usableICPCSeriesCount++
		} else {
			incompleteSeries = append(incompleteSeries, map[string]any{"index": index, "title": seriesConfig["title"], "count": countValues, "ratio": ratioValues})
		}
		if ratioSum > 1 {
			invalidSeries = append(invalidSeries, map[string]any{"index": index, "field": "ratio.value", "value": ratioValues, "severity": "warning", "reason": "ratio sum exceeds 1"})
		}
	}
	return map[string]any{"seriesCount": len(series), "icpcSeriesCount": icpcSeriesCount, "usableICPCSeriesCount": usableICPCSeriesCount, "incompleteSeries": incompleteSeries, "invalidSeries": invalidSeries}
}

func countStatusesWithSolutions(ranklist map[string]any) int {
	count := 0
	for _, rowAny := range asSlice(ranklist["rows"]) {
		for _, statusAny := range asSlice(asMap(rowAny)["statuses"]) {
			if len(asSlice(asMap(statusAny)["solutions"])) > 0 {
				count++
			}
		}
	}
	return count
}

func collectRowMarkerIDs(user map[string]any) []string {
	if user["markers"] != nil {
		return uniqueStringsFromAny(asSlice(user["markers"]))
	}
	ids := []string{}
	if user["marker"] != nil && stringValue(user["marker"]) != "" {
		ids = append(ids, stringValue(user["marker"]))
	}
	return uniqueStrings(ids)
}

func detectMockTimePattern(times []float64) string {
	allEqual := true
	for _, time := range times {
		if !isNearlyEqual(time, times[0]) {
			allEqual = false
			break
		}
	}
	if allEqual {
		return "identical"
	}
	sortedTimes := append([]float64{}, times...)
	sort.Float64s(sortedTimes)
	deltas := []float64{}
	for index, time := range sortedTimes[1:] {
		deltas = append(deltas, time-sortedTimes[index])
	}
	if len(deltas) > 0 {
		same := true
		for _, delta := range deltas {
			if !isNearlyEqual(delta, deltas[0]) {
				same = false
				break
			}
		}
		if same {
			if isNearlyEqual(deltas[0], 1000) {
				return "uniform-1s"
			}
			if isNearlyEqual(deltas[0], 60000) {
				return "uniform-1min"
			}
		}
	}
	return ""
}

func makeCheck(key string, label string, status string, checkedCount int, failedCount int, details map[string]any) map[string]any {
	return map[string]any{"key": key, "label": label, "status": status, "checkedCount": checkedCount, "failedCount": failedCount, "details": details}
}

func levelFromCoverage(presentCount int, totalCount int) string {
	if totalCount <= 0 {
		return "notApplicable"
	}
	if presentCount <= 0 {
		return "missing"
	}
	ratio := float64(presentCount) / float64(totalCount)
	if ratio >= 1 {
		return "complete"
	}
	if ratio >= 0.8 {
		return "mostly"
	}
	return "partial"
}

func parseTimeDuration(value any) map[string]any {
	raw := asSlice(value)
	if len(raw) != 2 {
		return map[string]any{"valid": false}
	}
	durationValue := numberValue(raw[0])
	unit := stringValue(raw[1])
	if math.IsNaN(durationValue) || math.IsInf(durationValue, 0) || durationValue < 0 || !isTimeUnit(unit) {
		return map[string]any{"valid": false}
	}
	ms, err := FormatTimeDurationChecked(value, "ms", nil)
	if err != nil {
		return map[string]any{"valid": false}
	}
	return map[string]any{"valid": true, "value": durationValue, "unit": unit, "ms": ms}
}

func safeFormatTimeDuration(value any, targetUnit string, fmtFn func(float64) float64) (float64, bool) {
	if !parseTimeDuration(value)["valid"].(bool) {
		return 0, false
	}
	converted, err := FormatTimeDurationChecked(value, targetUnit, fmtFn)
	if err != nil {
		return 0, false
	}
	return converted, true
}

func isTimeUnit(value any) bool {
	unit := stringValue(value)
	for _, candidate := range diagnosticTimeUnits {
		if unit == candidate {
			return true
		}
	}
	return false
}

func sameStatusSummaryOptionalTime(statusTime any, solutionTime any) bool {
	if statusTime == nil && solutionTime == nil {
		return true
	}
	if solutionTime == nil {
		return isZeroTimeDuration(statusTime)
	}
	if statusTime == nil {
		return false
	}
	return sameStatusSummaryTime(statusTime, solutionTime)
}

func sameStatusSummaryTime(statusTime any, solutionTime any) bool {
	parsedStatus := parseTimeDuration(statusTime)
	if !parsedStatus["valid"].(bool) {
		return false
	}
	solutionValue, ok := safeFormatTimeDuration(solutionTime, stringValue(parsedStatus["unit"]), math.Floor)
	return ok && isNearlyEqual(numberValue(parsedStatus["value"]), solutionValue)
}

func isZeroTimeDuration(value any) bool {
	if value == nil {
		return true
	}
	parsed := parseTimeDuration(value)
	return parsed["valid"].(bool) && isNearlyZero(numberValue(parsed["ms"]))
}

func isICPCSorter(ranklist map[string]any) bool {
	return asMap(ranklist["sorter"])["algorithm"] == "ICPC"
}

func problemLabel(ranklist map[string]any, problemIndex int) string {
	problems := asSlice(ranklist["problems"])
	if problemIndex < len(problems) {
		if alias := stringValue(asMap(problems[problemIndex])["alias"]); alias != "" {
			return alias
		}
	}
	return sprintf("%d", problemIndex)
}

func getRowUserID(row map[string]any) string {
	user := asMap(row["user"])
	if id := stringValue(user["id"]); id != "" {
		return id
	}
	if name, ok := user["name"].(string); ok {
		return name
	}
	data, _ := json.Marshal(user["name"])
	return string(data)
}

func isI18nText(text any) bool {
	_, ok := text.(map[string]any)
	return ok
}

func uniqueAny(values []any) []any {
	result := []any{}
	for _, value := range values {
		if !containsValue(result, value) {
			result = append(result, value)
		}
	}
	return result
}

func sameNoPenaltyResults(a []any, b []any) bool {
	return jsonKey(a) == jsonKey(b)
}

func sameProblemStatistics(left map[string]any, right map[string]any) bool {
	return left != nil && right != nil && numberValue(left["accepted"]) == numberValue(right["accepted"]) && numberValue(left["submitted"]) == numberValue(right["submitted"])
}

func countProblemsWithStatistics(ranklist map[string]any) int {
	count := 0
	for _, problemAny := range asSlice(ranklist["problems"]) {
		if len(asMap(asMap(problemAny)["statistics"])) > 0 {
			count++
		}
	}
	return count
}

func isNearlyZero(value float64) bool {
	return math.Abs(value) < 1e-9
}

func isNearlyEqual(a float64, b float64) bool {
	return math.Abs(a-b) < 1e-9
}

func isMultipleOf(value float64, unit float64) bool {
	return isNearlyEqual(value/unit, math.Round(value/unit))
}

func camelToConstant(value string) string {
	re := regexp.MustCompile(`[A-Z]`)
	return strings.ToUpper(re.ReplaceAllStringFunc(value, func(match string) string { return "_" + match }))
}

func sprintf(format string, args ...any) string {
	return fmt.Sprintf(format, args...)
}

func nilMap() map[string]any {
	return map[string]any{}
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func mapsToAny(values []map[string]any) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}

func sortedIntKeys(values map[int]bool) []any {
	keys := []int{}
	for key, enabled := range values {
		if enabled {
			keys = append(keys, key)
		}
	}
	sort.Ints(keys)
	result := make([]any, len(keys))
	for index, key := range keys {
		result[index] = key
	}
	return result
}

func anySolutionResult(solutions []any, result string) bool {
	for _, solutionAny := range solutions {
		if asMap(solutionAny)["result"] == result {
			return true
		}
	}
	return false
}

func anyAcceptedSolution(solutions []any) bool {
	for _, solutionAny := range solutions {
		result := asMap(solutionAny)["result"]
		if result == "AC" || result == "FB" {
			return true
		}
	}
	return false
}

func intMapToAny(values map[string]int) map[string]any {
	result := map[string]any{}
	for key, value := range values {
		result[key] = value
	}
	return result
}

func stringsToAny(values []string) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}

func uniqueStringsFromAny(values []any) []string {
	strings := []string{}
	for _, value := range values {
		if stringValue(value) != "" {
			strings = append(strings, stringValue(value))
		}
	}
	return uniqueStrings(strings)
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func jsonKey(value any) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func normalizeIntegralNumbers(_ map[string]any) {}
