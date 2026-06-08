package srkutils

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"testing"
)

func loadFixtures(t *testing.T) map[string]any {
	t.Helper()
	data, err := os.ReadFile("testdata/fixtures/contract-fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures map[string]any
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	return fixtures
}

func object(values map[string]any) map[string]any {
	return values
}

func array(values ...any) []any {
	return values
}

func makeRanklist(overrides map[string]any) map[string]any {
	ranklist := map[string]any{
		"type":    "general",
		"version": "0.3.9",
		"contest": map[string]any{
			"title":    "Contest",
			"startAt":  "2026-01-01T00:00:00+08:00",
			"duration": array(5, "h"),
		},
		"problems": array(object(map[string]any{"alias": "A"}), object(map[string]any{"alias": "B"})),
		"series":   array(object(map[string]any{"title": "Rank", "rule": object(map[string]any{"preset": "Normal"})})),
		"rows":     array(),
		"sorter":   object(map[string]any{"algorithm": "ICPC", "config": object(map[string]any{})}),
	}
	for key, value := range overrides {
		ranklist[key] = value
	}
	return ranklist
}

func makeRow(userID string, score any, statuses any, user map[string]any) map[string]any {
	if score == nil {
		score = object(map[string]any{"value": 0, "time": array(0, "ms")})
	}
	if statuses == nil {
		statuses = array(
			object(map[string]any{"result": nil, "solutions": array()}),
			object(map[string]any{"result": nil, "solutions": array()}),
		)
	}
	mergedUser := map[string]any{"id": userID, "name": userID}
	for key, value := range user {
		mergedUser[key] = value
	}
	return object(map[string]any{"user": mergedUser, "score": score, "statuses": statuses})
}

func fixture(fixtures map[string]any, path ...string) any {
	var current any = fixtures
	for _, key := range path {
		current = current.(map[string]any)[key]
	}
	return current
}

func assertJSONEqual(t *testing.T, actual any, expected any) {
	t.Helper()
	actualJSON, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	expectedJSON, err := json.Marshal(expected)
	if err != nil {
		t.Fatal(err)
	}
	var actualValue any
	var expectedValue any
	if err := json.Unmarshal(actualJSON, &actualValue); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(expectedJSON, &expectedValue); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actualValue, expectedValue) {
		t.Fatalf("actual JSON %s\nexpected JSON %s", actualJSON, expectedJSON)
	}
}

func TestConstantsFormattersAndResolversMatchContract(t *testing.T) {
	fixtures := loadFixtures(t)

	if MinRegenSupportedVersion != fixture(fixtures, "constants").(map[string]any)["minRegenSupportedVersion"] {
		t.Fatal("unexpected min regeneration version")
	}
	if SrkSupportedVersions != fixture(fixtures, "constants").(map[string]any)["srkSupportedVersions"] {
		t.Fatal("unexpected supported version range")
	}
	assertJSONEqual(t, EnumTheme, fixture(fixtures, "constants").(map[string]any)["enumTheme"])

	formatters := fixture(fixtures, "formatters").(map[string]any)
	if FormatTimeDuration(array(1.5, "h"), "min", nil) != formatters["formatTimeDuration"].(map[string]any)["hoursToMinutes"] {
		t.Fatal("hours to minutes mismatch")
	}
	if FormatTimeDuration(array(61, "s"), "min", math.Ceil) != formatters["formatTimeDuration"].(map[string]any)["secondsToMinutesCeil"] {
		t.Fatal("seconds ceil mismatch")
	}
	if FormatTimeDuration(array(2, "s"), "ms", func(float64) float64 { return 0 }) != formatters["formatTimeDuration"].(map[string]any)["secondsToMillisecondsIgnoresFormatter"] {
		t.Fatal("milliseconds conversion mismatch")
	}
	if _, err := FormatTimeDurationChecked(array(-1, "s"), "ms", nil); err == nil {
		t.Fatal("expected invalid negative time error")
	}
	if _, err := FormatTimeDurationChecked(array(1, "week"), "ms", nil); err == nil {
		t.Fatal("expected invalid source unit error")
	}
	if _, err := FormatTimeDurationChecked(array(1, "s"), "week", nil); err == nil {
		t.Fatal("expected invalid target unit error")
	}

	assertJSONEqual(t, PreZeroFill(7, 3), formatters["preZeroFill"].(map[string]any)["short"])
	assertJSONEqual(t, PreZeroFill(1234, 3), formatters["preZeroFill"].(map[string]any)["long"])
	assertJSONEqual(t, SecToTimeStr(3661, SecToTimeStrOptions{FillHour: true}), formatters["secToTimeStr"].(map[string]any)["fillHour"])
	assertJSONEqual(t, SecToTimeStr(90061, SecToTimeStrOptions{ShowDay: true}), formatters["secToTimeStr"].(map[string]any)["showDay"])
	assertJSONEqual(t, SecToTimeStr(-1, SecToTimeStrOptions{}), formatters["secToTimeStr"].(map[string]any)["negative"])
	assertJSONEqual(t, NumberToAlphabet(702), formatters["alphabet"].(map[string]any)["aaa"])
	assertJSONEqual(t, AlphabetToNumber("ac"), formatters["alphabet"].(map[string]any)["numberLowerAc"])

	resolvers := fixture(fixtures, "resolvers").(map[string]any)
	assertJSONEqual(t, ResolveText(nil, nil), resolvers["text"].(map[string]any)["undefined"])
	assertJSONEqual(t, ResolveText("plain", nil), resolvers["text"].(map[string]any)["plain"])
	assertJSONEqual(t, ResolveText(object(map[string]any{"fallback": "Fallback", "en-US": "English", "zh-CN": "中文"}), []string{"en-GB"}), resolvers["text"].(map[string]any)["enGB"])
	assertJSONEqual(t, ResolveText(object(map[string]any{"fallback": "Fallback", "zh-CN": "中文"}), []string{"zh-Hans-CN"}), resolvers["text"].(map[string]any)["zhHansCN"])
	assertJSONEqual(t, ResolveText(object(map[string]any{"fallback": "Fallback", "en-US": ""}), []string{"en-US"}), resolvers["text"].(map[string]any)["emptyMatch"])
	assertJSONEqual(t, ResolveContributor("bLue <mail@example.com> (https://example.com/)"), resolvers["contributor"].(map[string]any)["full"])
	assertJSONEqual(t, ResolveColor(array(1, 2, 3, 0.5)), resolvers["color"].(map[string]any)["rgbaTuple"])
	assertJSONEqual(t, ResolveThemeColor(object(map[string]any{"light": "#ffffff", "dark": "#000000"})), resolvers["themeColor"].(map[string]any)["pair"])
	assertJSONEqual(t, ResolveStyle(object(map[string]any{"backgroundColor": object(map[string]any{"light": "#ffffff", "dark": "#000000"})})), resolvers["style"].(map[string]any)["auto"])
	assertJSONEqual(t, ResolveStyle(object(map[string]any{"backgroundColor": "#00c000"})), resolvers["style"].(map[string]any)["autoGreen"])
	assertJSONEqual(t, ResolveStyle(object(map[string]any{"backgroundColor": "#0c0"})), resolvers["style"].(map[string]any)["autoShortHex"])
	assertJSONEqual(t, ResolveUserMarkers(
		object(map[string]any{"id": "u1", "name": "U1", "marker": "official", "markers": array("girls", "none")}),
		[]map[string]any{{"id": "official", "label": "Official", "style": "blue"}, {"id": "girls", "label": "Girls", "style": "pink"}},
	), resolvers["markers"].(map[string]any)["modernPrecedence"])
}

func TestRanklistHelpersMatchContract(t *testing.T) {
	fixtures := loadFixtures(t)
	expected := fixture(fixtures, "ranklist").(map[string]any)

	sortedRows := SortRows([]map[string]any{
		makeRow("slow", object(map[string]any{"value": 1, "time": array(30, "min")}), nil, nil),
		makeRow("fast", object(map[string]any{"value": 1, "time": array(20, "min")}), nil, nil),
		makeRow("solved-more", object(map[string]any{"value": 2, "time": array(90, "min")}), nil, nil),
	}, nil)
	ids := []string{}
	for _, row := range sortedRows {
		ids = append(ids, row["user"].(map[string]any)["id"].(string))
	}
	assertJSONEqual(t, ids, expected["sortedRows"])
}

func TestRanklistRegenerationAndStaticRanksMatchContract(t *testing.T) {
	fixtures := loadFixtures(t)
	expected := fixture(fixtures, "ranklist").(map[string]any)

	original := makeRanklist(map[string]any{
		"rows": array(
			makeRow("u1", nil, nil, nil),
			makeRow("u2", nil, nil, nil),
			makeRow("u3", object(map[string]any{"value": 0, "time": array(0, "ms")}), nil, map[string]any{"official": false}),
		),
		"problems": array(object(map[string]any{"alias": "A", "statistics": object(map[string]any{"accepted": 0, "submitted": 0})}), object(map[string]any{"alias": "B"})),
	})
	assertJSONEqual(t, RegenerateRanklistBySolutions(original, [][]any{
		array("u1", 0, "WA", array(10, "min")),
		array("u1", 0, "CE", array(15, "min")),
		array("u3", 0, "AC", array(20, "min")),
		array("u2", 0, "AC", array(30, "min")),
		array("u1", 0, "AC", array(50, "min")),
		array("u2", 1, "WA", array(100, "min")),
		array("u1", 1, "AC", array(120, "min")),
	}), expected["regenerated"])

	defaultNoPenalty := makeRanklist(map[string]any{
		"problems": array(object(map[string]any{"alias": "A"})),
		"rows":     array(makeRow("u1", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil)),
	})
	assertJSONEqual(t, RegenerateRanklistBySolutions(defaultNoPenalty, [][]any{
		array("u1", 0, "WA", array(10, "min")),
		array("u1", 0, "CE", array(15, "min")),
		array("u1", 0, "WA", array(20, "min")),
		array("u1", 0, "?", array(25, "min")),
		array("u1", 0, "AC", array(30, "min")),
	}), expected["defaultNoPenalty"])

	unknownNoAC := makeRanklist(map[string]any{
		"problems": array(object(map[string]any{"alias": "A"})),
		"rows":     array(makeRow("u1", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil)),
	})
	assertJSONEqual(t, RegenerateRanklistBySolutions(unknownNoAC, [][]any{
		array("u1", 0, "WA", array(1, "min")),
		array("u1", 0, "CE", array(2, "min")),
		array("u1", 0, "NOUT", array(3, "min")),
		array("u1", 0, "UKE", array(4, "min")),
		array("u1", 0, "WA", array(5, "min")),
		array("u1", 0, "?", array(6, "min")),
		array("u1", 0, "?", array(7, "min")),
		array("u1", 0, "?", array(8, "min")),
	}), expected["unknownNoAc"])

	customNoPenalty := makeRanklist(map[string]any{
		"problems": array(object(map[string]any{"alias": "A"})),
		"rows":     array(makeRow("u1", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil)),
		"sorter":   object(map[string]any{"algorithm": "ICPC", "config": object(map[string]any{"noPenaltyResults": array("FB", "AC", "?", "NOUT", "UKE", nil)})}),
	})
	assertJSONEqual(t, RegenerateRanklistBySolutions(customNoPenalty, [][]any{
		array("u1", 0, "CE", array(10, "min")),
		array("u1", 0, "AC", array(30, "min")),
	}), expected["customNoPenalty"])

	postAC := makeRanklist(map[string]any{
		"problems": array(object(map[string]any{"alias": "A"})),
		"rows":     array(makeRow("u1", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil)),
	})
	assertJSONEqual(t, RegenerateRanklistBySolutions(postAC, [][]any{
		array("u1", 0, "WA", array(10, "min")),
		array("u1", 0, "AC", array(20, "min")),
		array("u1", 0, "WA", array(30, "min")),
		array("u1", 0, "FB", array(40, "min")),
	}), expected["postAc"])

	assertJSONEqual(t, RegenerateRanklistBySolutions(makeRanklist(map[string]any{
		"problems": array(object(map[string]any{"alias": "A"})),
		"rows":     array(makeRow("u1", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil)),
		"sorter":   object(map[string]any{"algorithm": "ICPC", "config": object(map[string]any{"timePrecision": "min", "timeRounding": "ceil"})}),
	}), [][]any{array("u1", 0, "AC", array(125, "s"))}), expected["timePrecision"])

	rankingPrecision := RegenerateRanklistBySolutions(makeRanklist(map[string]any{
		"problems": array(object(map[string]any{"alias": "A"})),
		"rows": array(
			makeRow("slow-original-first", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil),
			makeRow("fast-original-second", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil),
		),
		"sorter": object(map[string]any{"algorithm": "ICPC", "config": object(map[string]any{"rankingTimePrecision": "h", "rankingTimeRounding": "floor"})}),
	}), [][]any{
		array("slow-original-first", 0, "AC", array(359, "min")),
		array("fast-original-second", 0, "AC", array(301, "min")),
	})
	precisionIDs := []string{}
	for _, row := range rankingPrecision["rows"].([]map[string]any) {
		precisionIDs = append(precisionIDs, row["user"].(map[string]any)["id"].(string))
	}
	assertJSONEqual(t, precisionIDs, expected["rankingPrecisionOrder"])

	incremental := makeRanklist(map[string]any{
		"problems": array(object(map[string]any{"alias": "A"})),
		"rows": array(
			makeRow("u1", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil),
			makeRow("u2", object(map[string]any{"value": 0, "time": array(0, "ms")}), array(object(map[string]any{"result": nil, "solutions": array()})), nil),
		),
	})
	assertJSONEqual(t, RegenerateRowsByIncrementalSolutions(incremental, [][]any{
		array("u1", 0, "WA", array(10, "min")),
		array("u1", 0, "CE", array(15, "min")),
		array("u2", 0, "AC", array(20, "min")),
		array("u1", 0, "AC", array(35, "min")),
	}), expected["incrementalRows"])

	incrementalPostAC := makeRanklist(map[string]any{
		"problems": array(object(map[string]any{"alias": "A"})),
		"rows": array(makeRow("u1", object(map[string]any{"value": 1, "time": array(20, "min")}), array(object(map[string]any{
			"result": "AC",
			"time":   array(20, "min"),
			"tries":  1,
			"solutions": array(
				object(map[string]any{"result": "AC", "time": array(20, "min")}),
			),
		})), nil)),
	})
	assertJSONEqual(t, RegenerateRowsByIncrementalSolutions(incrementalPostAC, [][]any{
		array("u1", 0, "WA", array(30, "min")),
		array("u1", 0, "AC", array(40, "min")),
	}), expected["incrementalPostAcRows"])

	staticRanklist := makeRanklist(map[string]any{
		"series": array(
			object(map[string]any{"title": "Overall", "rule": object(map[string]any{"preset": "Normal"})}),
			object(map[string]any{"title": "Official", "rule": object(map[string]any{"preset": "Normal", "options": object(map[string]any{"includeOfficialOnly": true})})}),
			object(map[string]any{"title": "School", "rule": object(map[string]any{"preset": "UniqByUserField", "options": object(map[string]any{"field": "organization"})})}),
			object(map[string]any{"title": "Medals", "segments": array(object(map[string]any{"title": "Gold"}), object(map[string]any{"title": "Silver"})), "rule": object(map[string]any{"preset": "ICPC", "options": object(map[string]any{"count": object(map[string]any{"value": array(1, 1), "noTied": true})})})}),
		),
		"rows": array(
			makeRow("u1", object(map[string]any{"value": 2, "time": array(100, "min")}), nil, map[string]any{"organization": "School A"}),
			makeRow("u2", object(map[string]any{"value": 2, "time": array(100, "min")}), nil, map[string]any{"organization": "School A"}),
			makeRow("u3", object(map[string]any{"value": 1, "time": array(50, "min")}), nil, map[string]any{"organization": "School B", "official": false}),
			makeRow("u4", object(map[string]any{"value": 1, "time": array(60, "min")}), nil, map[string]any{"organization": "School B"}),
		),
	})
	rankValues := []any{}
	for _, row := range ConvertToStaticRanklist(staticRanklist)["rows"].([]map[string]any) {
		rankValues = append(rankValues, row["rankValues"])
	}
	assertJSONEqual(t, rankValues, expected["staticRankValues"])

	markerRanklist := makeRanklist(map[string]any{
		"series": array(object(map[string]any{
			"title":    "Girls",
			"segments": array(object(map[string]any{"title": "Gold"}), object(map[string]any{"title": "Silver"})),
			"rule":     object(map[string]any{"preset": "ICPC", "options": object(map[string]any{"filter": object(map[string]any{"byMarker": "girls"}), "count": object(map[string]any{"value": array(1, 1)})})}),
		})),
		"rows": array(
			makeRow("modern-marker", object(map[string]any{"value": 3, "time": array(10, "min")}), nil, map[string]any{"markers": array("girls")}),
			makeRow("empty-modern-marker", object(map[string]any{"value": 2, "time": array(20, "min")}), nil, map[string]any{"marker": "girls", "markers": array()}),
			makeRow("legacy-marker", object(map[string]any{"value": 1, "time": array(30, "min")}), nil, map[string]any{"marker": "girls"}),
		),
	})
	markerValues := []any{}
	for _, row := range ConvertToStaticRanklist(markerRanklist)["rows"].([]map[string]any) {
		markerValues = append(markerValues, row["rankValues"].([]any)[0])
	}
	assertJSONEqual(t, markerValues, expected["markerRankValues"])

	invalidFilter := makeRanklist(map[string]any{
		"series": array(object(map[string]any{
			"title":    "Invalid filter",
			"segments": array(object(map[string]any{"title": "Gold"})),
			"rule": object(map[string]any{"preset": "ICPC", "options": object(map[string]any{
				"filter": object(map[string]any{"byUserFields": array(object(map[string]any{"field": "organization", "rule": "("}))}),
				"count":  object(map[string]any{"value": array(1)}),
			})}),
		})),
		"rows": array(makeRow("u1", object(map[string]any{"value": 1, "time": array(10, "min")}), nil, map[string]any{"organization": "SDUT"})),
	})
	invalidValue := ConvertToStaticRanklist(invalidFilter)["rows"].([]map[string]any)[0]["rankValues"].([]any)[0]
	assertJSONEqual(t, invalidValue, expected["invalidFilterRankValue"])

	ratioRows := []any{}
	for index := 0; index < 10; index++ {
		ratioRows = append(ratioRows, makeRow(
			fmt.Sprintf("ratio-u%d", index+1),
			object(map[string]any{"value": 10 - index, "time": array(index, "min")}),
			nil,
			nil,
		))
	}
	ratioRanklist := makeRanklist(map[string]any{
		"series": array(object(map[string]any{
			"title":    "Ratio",
			"segments": array(object(map[string]any{"title": "A"}), object(map[string]any{"title": "B"})),
			"rule": object(map[string]any{"preset": "ICPC", "options": object(map[string]any{
				"ratio": object(map[string]any{"value": array(0.1, 0.2), "rounding": "ceil"}),
			})}),
		})),
		"rows": ratioRows,
	})
	ratioValues := []any{}
	for _, row := range ConvertToStaticRanklist(ratioRanklist)["rows"].([]map[string]any) {
		ratioValues = append(ratioValues, row["rankValues"].([]any)[0])
	}
	assertJSONEqual(t, ratioValues, expected["ratioRankValues"])

	strictIDRanklist := makeRanklist(map[string]any{
		"series": array(object(map[string]any{
			"title":    "Strict ID",
			"segments": array(object(map[string]any{"title": "Only"})),
			"rule": object(map[string]any{"preset": "ICPC", "options": object(map[string]any{
				"filter": object(map[string]any{"byMarker": "girls"}),
				"count":  object(map[string]any{"value": array(2)}),
			})}),
		})),
		"rows": array(
			makeRow("fallback-a", object(map[string]any{"value": 2, "time": array(10, "min")}), nil, map[string]any{"id": nil, "name": "No ID A", "marker": "girls"}),
			makeRow("fallback-b", object(map[string]any{"value": 1, "time": array(20, "min")}), nil, map[string]any{"id": nil, "name": "No ID B"}),
		),
	})
	strictIDValues := []any{}
	for _, row := range ConvertToStaticRanklist(strictIDRanklist)["rows"].([]map[string]any) {
		strictIDValues = append(strictIDValues, row["rankValues"].([]any)[0])
	}
	assertJSONEqual(t, strictIDValues, expected["strictIdRankValues"])
}
