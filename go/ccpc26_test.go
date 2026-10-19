package srkutils

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"testing"
)

func TestCCPC26MatchesSharedContract(t *testing.T) {
	cases, ok := loadFixtures(t)["ccpc26"].(map[string]any)
	if !ok {
		t.Fatal("missing CCPC26 contract fixtures")
	}
	for _, raw := range asSlice(cases["layouts"]) {
		testCase := asMap(raw)
		t.Run("layout/"+stringValue(testCase["name"]), func(t *testing.T) {
			ranklist := asMap(testCase["ranklist"])
			before := deepCopyMap(ranklist)
			assertJSONEqual(t, GetCCPC26ProblemLayout(ranklist), testCase["expected"])
			assertJSONEqual(t, ranklist, before)
		})
	}
	for _, raw := range asSlice(cases["orders"]) {
		testCase := asMap(raw)
		t.Run("order/"+stringValue(testCase["name"]), func(t *testing.T) {
			statuses := []map[string]any{}
			for _, rawStatus := range asSlice(testCase["statuses"]) {
				statuses = append(statuses, asMap(rawStatus))
			}
			encodedLayout, err := json.Marshal(testCase["layout"])
			if err != nil {
				t.Fatal(err)
			}
			var layout CCPC26ProblemLayout
			if err := json.Unmarshal(encodedLayout, &layout); err != nil {
				t.Fatal(err)
			}
			beforeStatuses := deepCopyAny(statuses)
			beforeLayout := deepCopyAny(layout)
			assertJSONEqual(t, GetCCPC26RowProblemOrder(statuses, layout), testCase["expected"])
			assertJSONEqual(t, statuses, beforeStatuses)
			assertJSONEqual(t, layout, beforeLayout)
		})
	}
}

func ccpc26TestRanklist(threshold any) map[string]any {
	return makeRanklist(map[string]any{
		"problems": []map[string]any{{"alias": "A"}},
		"sorter": map[string]any{"algorithm": "ICPC", "config": map[string]any{
			"extendedAlgorithms": []map[string]any{{"algorithm": "CCPC26", "config": map[string]any{
				"problemRevealAcceptedThreshold": threshold,
			}}},
		}},
	})
}

func TestCCPC26NativeNumericThresholds(t *testing.T) {
	valid := []any{int(0), int8(0), int16(0), int32(0), int64(0), uint(0), uint8(0), uint16(0), uint32(0), uint64(0), float32(0), float64(0), json.Number("0")}
	invalid := []any{nil, true, false, "0", "1", math.NaN(), math.Inf(1), math.Inf(-1), json.Number("bad"), json.Number("1e999")}
	for _, field := range []string{"count", "ratio"} {
		for _, value := range valid {
			t.Run(fmt.Sprintf("%s/%T", field, value), func(t *testing.T) {
				layout := GetCCPC26ProblemLayout(ccpc26TestRanklist(map[string]any{field: value}))
				assertJSONEqual(t, layout, CCPC26ProblemLayout{RevealedProblemIndexes: []int{0}, HiddenProblemIndexes: []int{}})
			})
		}
		for _, value := range invalid {
			t.Run(fmt.Sprintf("%s/invalid/%T/%v", field, value, value), func(t *testing.T) {
				layout := GetCCPC26ProblemLayout(ccpc26TestRanklist(map[string]any{field: value}))
				assertJSONEqual(t, layout, CCPC26ProblemLayout{RevealedProblemIndexes: []int{}, HiddenProblemIndexes: []int{0}})
			})
		}
	}
}

func TestCCPC26RatioRoundingAndOverflow(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		ratio    float64
		rows     int
		revealed bool
	}{
		{"below positive half", math.Nextafter(0.5, 0), 1, true},
		{"positive half", 0.5, 1, false},
		{"negative half", -0.5, 1, true},
		{"positive product overflow", math.MaxFloat64, 2, false},
		{"negative product overflow", -math.MaxFloat64, 2, true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			ranklist := ccpc26TestRanklist(map[string]any{"ratio": testCase.ratio, "rounding": "round"})
			rows := []map[string]any{}
			for i := 0; i < testCase.rows; i++ {
				rows = append(rows, makeRow(fmt.Sprint(i), nil, nil, nil))
			}
			ranklist["rows"] = rows
			layout := GetCCPC26ProblemLayout(ranklist)
			if revealed := len(layout.RevealedProblemIndexes) == 1; revealed != testCase.revealed {
				t.Fatalf("revealed = %v, want %v", revealed, testCase.revealed)
			}
		})
	}
}

func TestCCPC26TypedDurationsAndRows(t *testing.T) {
	rows := RanklistRowsToMaps([]RanklistRow{{
		User: User{ID: "typed", Name: "Typed"}, Score: RankScore{Value: 1},
		Statuses: []RankProblemStatus{
			{Result: "FB", Time: TimeDuration{Value: 1, Unit: TimeUnitMinutes}},
			{Result: "AC", Time: TimeDuration{Value: 30, Unit: TimeUnitSeconds}},
			{Result: nil, Solutions: []Solution{{Result: "CE", Time: TimeDuration{Value: 0, Unit: TimeUnitMilliseconds}}}},
		},
	}})
	ranklist := ccpc26TestRanklist(map[string]any{"count": int16(1)})
	ranklist["problems"] = []map[string]any{{}, {}, {}}
	ranklist["rows"] = rows
	assertJSONEqual(t, GetCCPC26ProblemLayout(ranklist), CCPC26ProblemLayout{RevealedProblemIndexes: []int{0, 1}, HiddenProblemIndexes: []int{2}})
	statuses := []map[string]any{}
	for _, status := range asSlice(rows[0]["statuses"]) {
		statuses = append(statuses, asMap(status))
	}
	assertJSONEqual(t, GetCCPC26RowProblemOrder(statuses, CCPC26ProblemLayout{HiddenProblemIndexes: []int{0, 1, 2}}), []int{1, 0, 2})
}

func TestCCPC26NativeAndInvalidDurations(t *testing.T) {
	for _, value := range []any{int8(0), int16(0), int32(0), uint(0), uint8(0), uint16(0), uint32(0), uint64(0), json.Number("0")} {
		t.Run(fmt.Sprintf("native/%T", value), func(t *testing.T) {
			statuses := []map[string]any{{"result": "AC", "time": []any{1, "ms"}}, {"result": "FB", "time": []any{value, "ms"}}}
			assertJSONEqual(t, GetCCPC26RowProblemOrder(statuses, CCPC26ProblemLayout{HiddenProblemIndexes: []int{0, 1}}), []int{1, 0})
		})
	}
	for _, value := range []any{nil, true, false, "0", "1", math.NaN(), math.Inf(1), math.Inf(-1), json.Number("invalid"), -1} {
		t.Run(fmt.Sprintf("invalid/%T/%v", value, value), func(t *testing.T) {
			statuses := []map[string]any{{"result": "AC", "time": []any{value, "ms"}}, {"result": "FB", "time": TimeDuration{Value: 1, Unit: TimeUnitMilliseconds}}}
			assertJSONEqual(t, GetCCPC26RowProblemOrder(statuses, CCPC26ProblemLayout{HiddenProblemIndexes: []int{0, 1}}), []int{1, 0})
		})
	}
	statuses := []map[string]any{
		{"result": "AC", "time": TimeDuration{Value: math.MaxFloat64, Unit: TimeUnitDays}},
		{"result": "FB", "time": []any{0, "ms"}},
		{"result": "AC", "time": []any{0, "invalid"}},
	}
	assertJSONEqual(t, GetCCPC26RowProblemOrder(statuses, CCPC26ProblemLayout{HiddenProblemIndexes: []int{0, 1, 2}}), []int{1, 0, 2})
}

func TestCCPC26LayoutJSONAndSliceIndependence(t *testing.T) {
	ranklist := ccpc26TestRanklist(map[string]any{})
	ranklist["problems"] = []map[string]any{}
	layout := GetCCPC26ProblemLayout(ranklist)
	assertJSONEqual(t, layout, map[string]any{"revealedProblemIndexes": []any{}, "hiddenProblemIndexes": []any{}})
	assertJSONEqual(t, GetCCPC26RowProblemOrder(nil, CCPC26ProblemLayout{}), []int{})
	if GetCCPC26ProblemLayout(ccpc26TestRanklist(nil)) != nil {
		t.Fatal("absent threshold must produce nil layout")
	}
	var nilThreshold map[string]any
	if GetCCPC26ProblemLayout(ccpc26TestRanklist(nilThreshold)) != nil {
		t.Fatal("nil map represents an absent threshold")
	}
	backing := []int{2, 99, 98}
	layout = &CCPC26ProblemLayout{RevealedProblemIndexes: backing[:1], HiddenProblemIndexes: []int{1, 0}}
	order := GetCCPC26RowProblemOrder(nil, *layout)
	assertJSONEqual(t, order, []int{2, 0, 1})
	order[0], order[1] = 50, 51
	if !reflect.DeepEqual(backing, []int{2, 99, 98}) || !reflect.DeepEqual(layout.HiddenProblemIndexes, []int{1, 0}) {
		t.Fatal("output must not reuse or reorder layout backing arrays")
	}
}
