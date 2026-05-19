package srkutils

import (
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"sort"
)

var defaultNoPenaltyResults = []any{"FB", "AC", "?", "NOUT", "CE", "UKE", nil}
var filterableUserFields = map[string]bool{"id": true, "name": true, "organization": true}
var groupableUserFields = map[string]bool{"id": true, "name": true, "organization": true}

func jsRound(value float64) float64 {
	return math.Floor(value + 0.5)
}

func roundingFn(name string) func(float64) float64 {
	switch name {
	case "ceil":
		return math.Ceil
	case "round":
		return jsRound
	default:
		return math.Floor
	}
}

func deepCopyMap(value map[string]any) map[string]any {
	data, _ := json.Marshal(value)
	var copied map[string]any
	_ = json.Unmarshal(data, &copied)
	return copied
}

func deepCopyAny(value any) any {
	data, _ := json.Marshal(value)
	var copied any
	_ = json.Unmarshal(data, &copied)
	return copied
}

var semverRe = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

type parsedSemver struct {
	core       [3]int
	prerelease bool
}

func parseSemver(version string) (parsedSemver, bool) {
	match := semverRe.FindStringSubmatch(version)
	if len(match) != 5 {
		return parsedSemver{}, false
	}
	return parsedSemver{
		core:       [3]int{int(numberValue(match[1])), int(numberValue(match[2])), int(numberValue(match[3]))},
		prerelease: match[4] != "",
	}, true
}

func semverGTE(version string, minimum string) bool {
	v, ok := parseSemver(version)
	if !ok {
		return false
	}
	m, ok := parseSemver(minimum)
	if !ok {
		return false
	}
	for i := 0; i < 3; i++ {
		if v.core[i] > m.core[i] {
			return true
		}
		if v.core[i] < m.core[i] {
			return false
		}
	}
	if v.prerelease && !m.prerelease {
		return false
	}
	return true
}

func userID(user map[string]any) string {
	if id := stringValue(user["id"]); id != "" {
		return id
	}
	if name, ok := user["name"].(string); ok {
		return name
	}
	data, _ := json.Marshal(user["name"])
	return string(data)
}

func sorterConfig(ranklist map[string]any) map[string]any {
	config := map[string]any{
		"penalty":          []any{20, "min"},
		"noPenaltyResults": append([]any{}, defaultNoPenaltyResults...),
		"timeRounding":     "floor",
	}
	sorter := asMap(ranklist["sorter"])
	for key, value := range asMap(sorter["config"]) {
		config[key] = deepCopyAny(value)
	}
	return config
}

func containsValue(values []any, target any) bool {
	for _, value := range values {
		if value == target || fmt.Sprint(value) == fmt.Sprint(target) {
			return true
		}
	}
	return false
}

func ratFromAny(value any) *big.Rat {
	result := new(big.Rat)
	if _, ok := result.SetString(fmt.Sprint(value)); ok {
		return result
	}
	return new(big.Rat)
}

func floorRat(value *big.Rat) int {
	quotient := new(big.Int)
	remainder := new(big.Int)
	quotient.QuoRem(value.Num(), value.Denom(), remainder)
	if value.Sign() < 0 && remainder.Sign() != 0 {
		quotient.Sub(quotient, big.NewInt(1))
	}
	return int(quotient.Int64())
}

func ceilRat(value *big.Rat) int {
	quotient := new(big.Int)
	remainder := new(big.Int)
	quotient.QuoRem(value.Num(), value.Denom(), remainder)
	if value.Sign() > 0 && remainder.Sign() != 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	return int(quotient.Int64())
}

func roundRat(value *big.Rat, rounding string) int {
	switch rounding {
	case "floor":
		return floorRat(value)
	case "round":
		return floorRat(new(big.Rat).Add(value, big.NewRat(1, 2)))
	default:
		return ceilRat(value)
	}
}

func supportsRegeneration(ranklist map[string]any) bool {
	if !semverGTE(stringValue(ranklist["version"]), MinRegenSupportedVersion) {
		return false
	}
	return stringValue(asMap(ranklist["sorter"])["algorithm"]) == "ICPC"
}

func SortRows(rows []map[string]any, options map[string]any) []map[string]any {
	if options == nil {
		options = map[string]any{}
	}
	rankingTimePrecision := stringValue(options["rankingTimePrecision"])
	if rankingTimePrecision == "" {
		rankingTimePrecision = "ms"
	}
	rounding := roundingFn(stringValue(options["rankingTimeRounding"]))
	sort.SliceStable(rows, func(i, j int) bool {
		a := asMap(rows[i]["score"])
		b := asMap(rows[j]["score"])
		if numberValue(a["value"]) != numberValue(b["value"]) {
			return numberValue(a["value"]) > numberValue(b["value"])
		}
		timeA := 0.0
		if a["time"] != nil {
			timeA = FormatTimeDuration(a["time"], rankingTimePrecision, rounding)
		}
		timeB := 0.0
		if b["time"] != nil {
			timeB = FormatTimeDuration(b["time"], rankingTimePrecision, rounding)
		}
		return timeA < timeB
	})
	return rows
}

func RegenerateRanklistBySolutions(originalRanklist map[string]any, solutions [][]any) map[string]any {
	if !supportsRegeneration(originalRanklist) {
		panic("The ranklist is not supported to regenerate")
	}
	config := sorterConfig(originalRanklist)
	ranklist := map[string]any{}
	for key, value := range originalRanklist {
		if key != "rows" {
			ranklist[key] = deepCopyAny(value)
		}
	}
	problems := asSlice(ranklist["problems"])
	problemCount := len(problems)
	userRowMap := map[string]map[string]any{}
	for _, rowAny := range asSlice(originalRanklist["rows"]) {
		row := asMap(rowAny)
		statuses := []any{}
		for i := 0; i < problemCount; i++ {
			statuses = append(statuses, map[string]any{"result": nil, "solutions": []any{}})
		}
		userRowMap[userID(asMap(row["user"]))] = map[string]any{
			"user":     deepCopyAny(row["user"]),
			"score":    map[string]any{"value": 0},
			"statuses": statuses,
		}
	}
	for _, tetrad := range solutions {
		id := stringValue(tetrad[0])
		problemIndex := int(numberValue(tetrad[1]))
		row := userRowMap[id]
		if row == nil {
			break
		}
		status := asMap(asSlice(row["statuses"])[problemIndex])
		status["solutions"] = append(asSlice(status["solutions"]), map[string]any{"result": tetrad[2], "time": tetrad[3]})
	}
	accepted := make([]int, problemCount)
	submitted := make([]int, problemCount)
	rows := []map[string]any{}
	noPenalty := asSlice(config["noPenaltyResults"])
	for _, originalRowAny := range asSlice(originalRanklist["rows"]) {
		row := userRowMap[userID(asMap(asMap(originalRowAny)["user"]))]
		scoreValue := 0
		totalTimeMS := 0.0
		for i, statusAny := range asSlice(row["statuses"]) {
			status := asMap(statusAny)
			for _, solutionAny := range asSlice(status["solutions"]) {
				solution := asMap(solutionAny)
				result := solution["result"]
				if result == nil || stringValue(result) == "" {
					continue
				}
				isNoPenalty := containsValue(noPenalty, result)
				if result == "?" {
					status["result"] = result
					if !isNoPenalty {
						status["tries"] = numberValue(status["tries"]) + 1
						submitted[i]++
					}
					continue
				}
				if result == "AC" || result == "FB" {
					status["result"] = result
					status["time"] = solution["time"]
					status["tries"] = numberValue(status["tries"]) + 1
					accepted[i]++
					submitted[i]++
					break
				}
				if isNoPenalty {
					continue
				}
				status["result"] = "RJ"
				status["tries"] = numberValue(status["tries"]) + 1
				submitted[i]++
			}
			if status["result"] == "AC" || status["result"] == "FB" {
				precision := stringValue(config["timePrecision"])
				if precision == "" {
					precision = "ms"
				}
				targetTime := []any{
					FormatTimeDuration(status["time"], precision, roundingFn(stringValue(config["timeRounding"]))),
					precision,
				}
				scoreValue++
				totalTimeMS += FormatTimeDuration(targetTime, "ms", nil) + (numberValue(status["tries"])-1)*FormatTimeDuration(config["penalty"], "ms", nil)
			}
		}
		row["score"] = map[string]any{"value": scoreValue, "time": []any{totalTimeMS, "ms"}}
		rows = append(rows, row)
	}
	ranklist["rows"] = SortRows(rows, map[string]any{
		"rankingTimePrecision": config["rankingTimePrecision"],
		"rankingTimeRounding":  config["rankingTimeRounding"],
	})
	for i, problemAny := range problems {
		problem := asMap(problemAny)
		if problem["statistics"] == nil {
			problem["statistics"] = map[string]any{"accepted": 0, "submitted": 0}
		}
		stats := asMap(problem["statistics"])
		stats["accepted"] = accepted[i]
		stats["submitted"] = submitted[i]
	}
	return ranklist
}

func RegenerateRowsByIncrementalSolutions(originalRanklist map[string]any, solutions [][]any) []map[string]any {
	if !supportsRegeneration(originalRanklist) {
		panic("The ranklist is not supported to regenerate")
	}
	config := sorterConfig(originalRanklist)
	rows := []map[string]any{}
	userRowIndex := map[string]int{}
	for index, rowAny := range asSlice(originalRanklist["rows"]) {
		row := deepCopyMap(asMap(rowAny))
		userRowIndex[userID(asMap(row["user"]))] = index
		rows = append(rows, row)
	}
	noPenalty := asSlice(config["noPenaltyResults"])
	for _, tetrad := range solutions {
		id := stringValue(tetrad[0])
		rowIndex, ok := userRowIndex[id]
		if !ok {
			break
		}
		row := rows[rowIndex]
		problemIndex := int(numberValue(tetrad[1]))
		status := asMap(asSlice(row["statuses"])[problemIndex])
		status["solutions"] = append(asSlice(status["solutions"]), map[string]any{"result": tetrad[2], "time": tetrad[3]})
		if status["result"] == "AC" || status["result"] == "FB" {
			continue
		}
		result := tetrad[2]
		isNoPenalty := containsValue(noPenalty, result)
		if result == "?" {
			status["result"] = result
			if !isNoPenalty {
				status["tries"] = numberValue(status["tries"]) + 1
			}
			continue
		}
		if result == "AC" || result == "FB" {
			status["result"] = result
			status["time"] = tetrad[3]
			status["tries"] = numberValue(status["tries"]) + 1
			score := asMap(row["score"])
			score["value"] = numberValue(score["value"]) + 1
			precision := stringValue(config["timePrecision"])
			if precision == "" {
				precision = "ms"
			}
			targetTime := []any{FormatTimeDuration(status["time"], precision, roundingFn(stringValue(config["timeRounding"]))), precision}
			totalTime := 0.0
			if score["time"] != nil {
				totalTime = FormatTimeDuration(score["time"], "ms", nil)
			}
			score["time"] = []any{totalTime + FormatTimeDuration(targetTime, "ms", nil) + (numberValue(status["tries"])-1)*FormatTimeDuration(config["penalty"], "ms", nil), "ms"}
			continue
		}
		if isNoPenalty {
			continue
		}
		status["result"] = "RJ"
		status["tries"] = numberValue(status["tries"]) + 1
	}
	return SortRows(rows, map[string]any{
		"rankingTimePrecision": config["rankingTimePrecision"],
		"rankingTimeRounding":  config["rankingTimeRounding"],
	})
}

func compareScoreEqual(a map[string]any, b map[string]any, options map[string]any) bool {
	if numberValue(a["value"]) != numberValue(b["value"]) {
		return false
	}
	precision := stringValue(options["rankingTimePrecision"])
	if precision == "" {
		precision = "ms"
	}
	rounding := roundingFn(stringValue(options["rankingTimeRounding"]))
	da := 0.0
	if a["time"] != nil {
		da = FormatTimeDuration(a["time"], precision, rounding)
	}
	db := 0.0
	if b["time"] != nil {
		db = FormatTimeDuration(b["time"], precision, rounding)
	}
	return da == db
}

func genRowRanks(rows []map[string]any, options map[string]any) map[string][]any {
	genRanks := func(current []map[string]any) []any {
		ranks := make([]any, len(current))
		for i := range current {
			if i == 0 {
				ranks[i] = 1
			} else if compareScoreEqual(asMap(current[i]["score"]), asMap(current[i-1]["score"]), options) {
				ranks[i] = ranks[i-1]
			} else {
				ranks[i] = i + 1
			}
		}
		return ranks
	}
	ranks := genRanks(rows)
	officialRows := []map[string]any{}
	indexBack := map[int]int{}
	for index, row := range rows {
		if asMap(row["user"])["official"] != false {
			indexBack[index] = len(officialRows)
			officialRows = append(officialRows, row)
		}
	}
	officialPartialRanks := genRanks(officialRows)
	officialRanks := make([]any, len(rows))
	for index := range rows {
		if back, ok := indexBack[index]; ok {
			officialRanks[index] = officialPartialRanks[back]
		} else {
			officialRanks[index] = nil
		}
	}
	return map[string][]any{"ranks": ranks, "officialRanks": officialRanks}
}

func stringify(value any) string {
	switch value.(type) {
	case map[string]any, []any:
		data, _ := json.Marshal(value)
		return string(data)
	default:
		return fmt.Sprint(value)
	}
}

func objectValues(value any) []any {
	switch typed := value.(type) {
	case map[string]any:
		result := []any{}
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	case map[string]string:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	case []any:
		return typed
	case []string:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = item
		}
		return result
	default:
		if value == nil {
			return []any{}
		}
		return []any{value}
	}
}

type seriesCalcFn func(row map[string]any, index int) map[string]any

func genSeriesCalcFns(series []any, rows []map[string]any, ranks []any, officialRanks []any) []seriesCalcFn {
	fallback := func(_ map[string]any, _ int) map[string]any {
		return map[string]any{"rank": nil, "segmentIndex": nil}
	}
	fns := []seriesCalcFn{}
	for _, seriesAny := range series {
		seriesConfig := asMap(seriesAny)
		rule := asMap(seriesConfig["rule"])
		if len(rule) == 0 {
			fns = append(fns, fallback)
			continue
		}
		switch stringValue(rule["preset"]) {
		case "Normal":
			options := asMap(rule["options"])
			fns = append(fns, func(row map[string]any, index int) map[string]any {
				if options["includeOfficialOnly"] == true && asMap(row["user"])["official"] == false {
					return map[string]any{"rank": nil, "segmentIndex": nil}
				}
				rank := ranks[index]
				if options["includeOfficialOnly"] == true {
					rank = officialRanks[index]
				}
				return map[string]any{"rank": rank, "segmentIndex": nil}
			})
		case "UniqByUserField":
			options := asMap(rule["options"])
			field := stringValue(options["field"])
			assigned := map[int]any{}
			values := map[string]bool{}
			lastOuterRank := any(0)
			lastRank := 0
			for index, row := range rows {
				if options["includeOfficialOnly"] == true && asMap(row["user"])["official"] == false {
					continue
				}
				valid := groupableUserFields[field]
				value := stringify(asMap(row["user"])[field])
				if !valid || (value != "" && !values[value]) {
					outerRank := ranks[index]
					if options["includeOfficialOnly"] == true {
						outerRank = officialRanks[index]
					}
					if valid {
						values[value] = true
					}
					if fmt.Sprint(outerRank) != fmt.Sprint(lastOuterRank) {
						lastOuterRank = outerRank
						lastRank = len(assigned) + 1
						assigned[index] = lastRank
					}
					assigned[index] = lastRank
				}
			}
			fns = append(fns, func(_ map[string]any, index int) map[string]any {
				return map[string]any{"rank": assigned[index], "segmentIndex": nil}
			})
		case "ICPC":
			options := asMap(rule["options"])
			filteredRows := []map[string]any{}
			for _, row := range rows {
				if asMap(row["user"])["official"] != false {
					filteredRows = append(filteredRows, row)
				}
			}
			filteredOfficialRanks := append([]any{}, officialRanks...)
			filterTests := []func(map[string]any) bool{}
			filter := asMap(options["filter"])
			if len(filter) > 0 {
				for _, filterAny := range asSlice(filter["byUserFields"]) {
					filterConfig := asMap(filterAny)
					field := stringValue(filterConfig["field"])
					if !filterableUserFields[field] {
						continue
					}
					regexpValue, err := regexp.Compile(stringValue(filterConfig["rule"]))
					if err != nil {
						filterTests = append(filterTests, func(_ map[string]any) bool { return false })
						continue
					}
					filterTests = append(filterTests, func(row map[string]any) bool {
						value := asMap(row["user"])[field]
						for _, item := range objectValues(value) {
							if regexpValue.MatchString(fmt.Sprint(item)) {
								return true
							}
						}
						return false
					})
				}
				if filter["byMarker"] != nil {
					marker := stringValue(filter["byMarker"])
					filterTests = append(filterTests, func(row map[string]any) bool {
						user := asMap(row["user"])
						if markers, ok := user["markers"]; ok {
							for _, current := range asSlice(markers) {
								if current == marker {
									return true
								}
							}
							return false
						}
						return user["marker"] == marker
					})
				}
				if len(filterTests) > 0 {
					currentFilteredRows := []map[string]any{}
					filteredOfficialRanks = make([]any, len(filteredOfficialRanks))
					currentRank := 0
					currentOfficialRank := 0
					currentOfficialRankOld := any(0)
					for index, row := range rows {
						shouldInclude := true
						for _, test := range filterTests {
							if !test(row) {
								shouldInclude = false
								break
							}
						}
						if shouldInclude {
							currentFilteredRows = append(currentFilteredRows, row)
							oldRank := officialRanks[index]
							if oldRank != nil {
								currentRank++
								if fmt.Sprint(currentOfficialRankOld) != fmt.Sprint(oldRank) {
									currentOfficialRank = currentRank
									currentOfficialRankOld = oldRank
								}
								filteredOfficialRanks[index] = currentOfficialRank
							}
						}
					}
					filteredRows = []map[string]any{}
					for _, row := range currentFilteredRows {
						if asMap(row["user"])["official"] != false {
							filteredRows = append(filteredRows, row)
						}
					}
				}
			}
			endpointRules := [][]int{}
			noTied := false
			ratio := asMap(options["ratio"])
			if len(ratio) > 0 {
				denominator := stringValue(ratio["denominator"])
				total := len(filteredRows)
				if denominator == "submitted" {
					total = 0
					for _, row := range filteredRows {
						allEmpty := true
						for _, statusAny := range asSlice(row["statuses"]) {
							if asMap(statusAny)["result"] != nil {
								allEmpty = false
								break
							}
						}
						if !allEmpty {
							total++
						}
					}
				} else if denominator == "scored" {
					total = 0
					for _, row := range filteredRows {
						if numberValue(asMap(row["score"])["value"]) > 0 {
							total++
						}
					}
				}
				acc := []*big.Rat{}
				currentAcc := new(big.Rat)
				for index, value := range asSlice(ratio["value"]) {
					current := ratFromAny(value)
					if index == 0 {
						currentAcc = current
					} else {
						currentAcc = new(big.Rat).Add(currentAcc, current)
					}
					acc = append(acc, new(big.Rat).Set(currentAcc))
				}
				rounding := stringValue(ratio["rounding"])
				rule := []int{}
				for _, value := range acc {
					raw := new(big.Rat).Mul(value, big.NewRat(int64(total), 1))
					rule = append(rule, roundRat(raw, rounding))
				}
				endpointRules = append(endpointRules, rule)
				if ratio["noTied"] == true {
					noTied = true
				}
			}
			count := asMap(options["count"])
			if len(count) > 0 {
				acc := []int{}
				for index, value := range asSlice(count["value"]) {
					current := int(numberValue(value))
					if index > 0 {
						current += acc[index-1]
					}
					acc = append(acc, current)
				}
				endpointRules = append(endpointRules, acc)
				if count["noTied"] == true {
					noTied = true
				}
			}
			officialRanksNoTied := []any{}
			currentOfficialRank := 0
			for _, rank := range filteredOfficialRanks {
				if rank == nil {
					officialRanksNoTied = append(officialRanksNoTied, nil)
				} else {
					currentOfficialRank++
					officialRanksNoTied = append(officialRanksNoTied, currentOfficialRank)
				}
			}
			filteredIDs := map[string]bool{}
			for _, row := range filteredRows {
				filteredIDs[stringValue(asMap(row["user"])["id"])] = true
			}
			currentSeries := seriesConfig
			fns = append(fns, func(row map[string]any, index int) map[string]any {
				if asMap(row["user"])["official"] == false || !filteredIDs[stringValue(asMap(row["user"])["id"])] {
					return map[string]any{"rank": nil, "segmentIndex": nil}
				}
				usingRanks := filteredOfficialRanks
				if noTied {
					usingRanks = officialRanksNoTied
				}
				var segmentIndex any = nil
				for segIndex := range asSlice(currentSeries["segments"]) {
					matches := true
					for _, endpoints := range endpointRules {
						if segIndex >= len(endpoints) || numberValue(usingRanks[index]) > float64(endpoints[segIndex]) {
							matches = false
							break
						}
					}
					if matches {
						segmentIndex = segIndex
						break
					}
				}
				return map[string]any{"rank": filteredOfficialRanks[index], "segmentIndex": segmentIndex}
			})
		default:
			fns = append(fns, fallback)
		}
	}
	return fns
}

func ConvertToStaticRanklist(ranklist map[string]any) map[string]any {
	if ranklist == nil {
		return nil
	}
	rows := []map[string]any{}
	for _, rowAny := range asSlice(ranklist["rows"]) {
		rows = append(rows, asMap(rowAny))
	}
	config := asMap(asMap(ranklist["sorter"])["config"])
	rowRanks := genRowRanks(rows, map[string]any{
		"rankingTimePrecision": config["rankingTimePrecision"],
		"rankingTimeRounding":  config["rankingTimeRounding"],
	})
	fns := genSeriesCalcFns(asSlice(ranklist["series"]), rows, rowRanks["ranks"], rowRanks["officialRanks"])
	result := deepCopyMap(ranklist)
	resultRows := []map[string]any{}
	for index, row := range rows {
		copied := deepCopyMap(row)
		rankValues := []any{}
		for _, fn := range fns {
			rankValues = append(rankValues, fn(row, index))
		}
		copied["rankValues"] = rankValues
		resultRows = append(resultRows, copied)
	}
	result["rows"] = resultRows
	return result
}
