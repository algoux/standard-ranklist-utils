package srkutils

import "testing"

func TestTypedPublicAPIAcceptsExportedTypes(t *testing.T) {
	minutes := FormatTimeDuration(TimeDuration{Value: 1.5, Unit: TimeUnitHours}, "min", nil)
	if minutes != 90 {
		t.Fatalf("typed TimeDuration converted to %v, want 90", minutes)
	}
}

func TestResolveColorAcceptsNumericSlices(t *testing.T) {
	if ResolveColor([]int{1, 2, 3, 1}) != "rgba(1,2,3,1)" {
		t.Fatal("[]int RGBA color was not resolved")
	}
	if ResolveColor([]float64{1, 2, 3, 0.5}) != "rgba(1,2,3,0.5)" {
		t.Fatal("[]float64 RGBA color was not resolved")
	}
	if ResolveColor([]int{1, 2, 3}) != nil {
		t.Fatal("short native color slices should not panic or resolve")
	}
}

func TestNativeMarkersPreserveModernPrecedence(t *testing.T) {
	markers := []map[string]any{
		{"id": "official", "label": "Official"},
		{"id": "girls", "label": "Girls"},
	}
	resolved := ResolveUserMarkers(map[string]any{"marker": "official", "markers": []string{}}, markers)
	if len(resolved) != 0 {
		t.Fatal("empty native markers slice should suppress legacy marker fallback")
	}
	resolved = ResolveUserMarkers(map[string]any{"marker": "official", "markers": []string{"girls"}}, markers)
	if len(resolved) != 1 || resolved[0]["id"] != "girls" {
		t.Fatal("native []string markers should resolve in modern marker order")
	}
}

func TestTypedRowConversionHelpers(t *testing.T) {
	rows := RanklistRowsToMaps([]RanklistRow{
		{
			User: User{ID: "slow", Name: "Slow", Markers: []string{}},
			Score: RankScore{
				Value: 1,
				Time:  TimeDuration{Value: 30, Unit: TimeUnitMinutes},
			},
			Statuses: []RankProblemStatus{{Result: nil, Solutions: []Solution{}}},
		},
		{
			User: User{ID: "fast", Name: "Fast"},
			Score: RankScore{
				Value: 1,
				Time:  TimeDuration{Value: 20, Unit: TimeUnitMinutes},
			},
			Statuses: []RankProblemStatus{{Result: nil, Solutions: []Solution{}}},
		},
	})
	if _, ok := rows[0]["user"].(map[string]any)["markers"]; !ok {
		t.Fatal("typed row conversion should preserve explicit empty markers")
	}
	sorted := SortRows(rows, nil)
	if sorted[0]["user"].(map[string]any)["id"] != "fast" {
		t.Fatal("typed row conversion helpers should produce rows accepted by SortRows")
	}
}

func TestNativeUserFieldFilterValues(t *testing.T) {
	ranklist := makeRanklist(map[string]any{
		"series": array(object(map[string]any{
			"title":    "Native",
			"segments": array(object(map[string]any{"title": "Only"})),
			"rule": object(map[string]any{"preset": "ICPC", "options": object(map[string]any{
				"filter": object(map[string]any{
					"byUserFields": array(object(map[string]any{"field": "organization", "rule": "Team B"})),
				}),
				"count": object(map[string]any{"value": array(1)}),
			})}),
		})),
		"rows": array(
			makeRow("u1", object(map[string]any{"value": 2, "time": array(10, "min")}), nil, map[string]any{"organization": []string{"Team A", "Team B"}}),
			makeRow("u2", object(map[string]any{"value": 1, "time": array(20, "min")}), nil, map[string]any{"organization": map[string]string{"school": "Team C"}}),
		),
	})
	rows := ConvertToStaticRanklist(ranklist)["rows"].([]map[string]any)
	if rows[0]["rankValues"].([]any)[0].(map[string]any)["segmentIndex"] != 0 {
		t.Fatal("native []string user field values should be filterable")
	}
}
