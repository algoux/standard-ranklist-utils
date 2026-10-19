package srkutils

import (
	"encoding/json"
	"math"
	"sort"
)

// CCPC26ProblemLayout contains original problem indexes for the common revealed
// prefix and the independently ordered anonymous suffix of each row.
type CCPC26ProblemLayout struct {
	RevealedProblemIndexes []int `json:"revealedProblemIndexes"`
	HiddenProblemIndexes   []int `json:"hiddenProblemIndexes"`
}

// GetCCPC26ProblemLayout calculates visibility from a complete current snapshot.
// It returns nil without standard ICPC CCPC26 threshold configuration. Empty
// threshold objects are valid and reveal no problems. The caller controls mode
// activation and freeze timing and should filter displayed rows after this call.
// Neither the ranklist nor its nested data is modified.
func GetCCPC26ProblemLayout(ranklist map[string]any) *CCPC26ProblemLayout {
	sorter := asMap(ranklist["sorter"])
	if sorter["algorithm"] != "ICPC" {
		return nil
	}
	var threshold map[string]any
	for _, raw := range asSlice(asMap(sorter["config"])["extendedAlgorithms"]) {
		algorithm := asMap(raw)
		if algorithm["algorithm"] == "CCPC26" {
			threshold, _ = asMap(algorithm["config"])["problemRevealAcceptedThreshold"].(map[string]any)
			break
		}
	}
	if threshold == nil {
		return nil
	}

	acceptedCounts := make([]int, len(asSlice(ranklist["problems"])))
	denominator := 0
	for _, raw := range asSlice(ranklist["rows"]) {
		row := asMap(raw)
		if threshold["includeOfficialOnly"] == true && asMap(row["user"])["official"] == false {
			continue
		}
		statuses := asSlice(row["statuses"])
		contributes := true
		switch threshold["denominator"] {
		case "submitted":
			contributes = false
			for _, status := range statuses {
				if ccpc26HasSubmission(asMap(status)) {
					contributes = true
					break
				}
			}
		case "scored":
			contributes = numberValue(asMap(row["score"])["value"]) > 0
		}
		if contributes {
			denominator++
		}
		for index := range acceptedCounts {
			if index < len(statuses) && ccpc26IsAccepted(asMap(statuses[index])) {
				acceptedCounts[index]++
			}
		}
	}

	count, hasCount := ccpc26FiniteNumber(threshold["count"])
	ratio, hasRatio := ccpc26FiniteNumber(threshold["ratio"])
	ratioThreshold := float64(denominator) * ratio
	switch threshold["rounding"] {
	case "ceil":
		ratioThreshold = math.Ceil(ratioThreshold)
	case "round":
		// Avoid x+0.5 rounding up the float immediately below a half integer.
		// JavaScript rounds exact ties toward positive infinity, including negatives.
		floor := math.Floor(ratioThreshold)
		if ratioThreshold-floor >= 0.5 {
			ratioThreshold = floor + 1
		} else {
			ratioThreshold = floor
		}
	default:
		ratioThreshold = math.Floor(ratioThreshold)
	}
	layout := &CCPC26ProblemLayout{RevealedProblemIndexes: []int{}, HiddenProblemIndexes: []int{}}
	for index, accepted := range acceptedCounts {
		if (hasCount && float64(accepted) >= count) || (hasRatio && float64(accepted) >= ratioThreshold) {
			layout.RevealedProblemIndexes = append(layout.RevealedProblemIndexes, index)
		} else {
			layout.HiddenProblemIndexes = append(layout.HiddenProblemIndexes, index)
		}
	}
	return layout
}

// GetCCPC26RowProblemOrder returns original problem indexes without changing
// statuses or layout. Revealed indexes come first, then hidden accepted problems
// by acceptance time, attempted problems by latest submission time, and untouched
// problems. Unknown times follow known times; ties use original problem indexes.
// The layout determines all columns, even when statuses are missing.
func GetCCPC26RowProblemOrder(statuses []map[string]any, layout CCPC26ProblemLayout) []int {
	type hiddenProblem struct {
		index   int
		group   int
		time    float64
		hasTime bool
	}
	hidden := make([]hiddenProblem, 0, len(layout.HiddenProblemIndexes))
	for _, index := range layout.HiddenProblemIndexes {
		var status map[string]any
		if index >= 0 && index < len(statuses) {
			status = statuses[index]
		}
		item := hiddenProblem{index: index, group: 2}
		if ccpc26IsAccepted(status) {
			item.group = 0
			item.time, item.hasTime = ccpc26AcceptedTime(status)
		} else if ccpc26HasSubmission(status) {
			item.group = 1
			item.time, item.hasTime = ccpc26LastSubmissionTime(status)
		}
		hidden = append(hidden, item)
	}
	sort.Slice(hidden, func(i, j int) bool {
		left, right := hidden[i], hidden[j]
		if left.group != right.group {
			return left.group < right.group
		}
		if left.group != 2 {
			if left.hasTime != right.hasTime {
				return left.hasTime
			}
			if left.hasTime && left.time != right.time {
				return left.time < right.time
			}
		}
		return left.index < right.index
	})
	order := make([]int, 0, len(layout.RevealedProblemIndexes)+len(hidden))
	order = append(order, layout.RevealedProblemIndexes...)
	for _, item := range hidden {
		order = append(order, item.index)
	}
	return order
}

func ccpc26IsAccepted(status map[string]any) bool {
	return status["result"] == "AC" || status["result"] == "FB"
}

func ccpc26HasSubmission(status map[string]any) bool {
	return len(asSlice(status["solutions"])) > 0 || status["result"] != nil || numberValue(status["tries"]) > 0
}

// Do not coerce strings or booleans to numbers: JavaScript's Number.isFinite
// rejects them, unlike the permissive conversion used by older helpers.
func ccpc26FiniteNumber(value any) (float64, bool) {
	var number float64
	switch v := value.(type) {
	case int:
		number = float64(v)
	case int8:
		number = float64(v)
	case int16:
		number = float64(v)
	case int32:
		number = float64(v)
	case int64:
		number = float64(v)
	case uint:
		number = float64(v)
	case uint8:
		number = float64(v)
	case uint16:
		number = float64(v)
	case uint32:
		number = float64(v)
	case uint64:
		number = float64(v)
	case float32:
		number = float64(v)
	case float64:
		number = v
	case json.Number:
		var err error
		number, err = v.Float64()
		if err != nil {
			return 0, false
		}
	default:
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}

func ccpc26Time(value any) (float64, bool) {
	raw := asSlice(value)
	if len(raw) < 2 {
		return 0, false
	}
	number, ok := ccpc26FiniteNumber(raw[0])
	if !ok {
		return 0, false
	}
	// Normalize supported native numeric types before the existing formatter.
	time, err := FormatTimeDurationChecked([]any{number, raw[1]}, "ms", nil)
	return time, err == nil && !math.IsNaN(time) && !math.IsInf(time, 0)
}

func ccpc26AcceptedTime(status map[string]any) (float64, bool) {
	if time, ok := ccpc26Time(status["time"]); ok {
		return time, true
	}
	var earliest float64
	found := false
	for _, raw := range asSlice(status["solutions"]) {
		solution := asMap(raw)
		if !ccpc26IsAccepted(solution) {
			continue
		}
		if time, ok := ccpc26Time(solution["time"]); ok && (!found || time < earliest) {
			earliest, found = time, true
		}
	}
	return earliest, found
}

func ccpc26LastSubmissionTime(status map[string]any) (float64, bool) {
	solutions := asSlice(status["solutions"])
	if len(solutions) == 0 {
		return ccpc26Time(status["time"])
	}
	var latest float64
	found := false
	for _, raw := range solutions {
		if time, ok := ccpc26Time(asMap(raw)["time"]); ok && (!found || time > latest) {
			latest, found = time, true
		}
	}
	return latest, found
}
