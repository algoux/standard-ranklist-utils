package srkutils

import (
	"encoding/json"
	"fmt"
)

type TimeUnit string

const (
	TimeUnitMilliseconds TimeUnit = "ms"
	TimeUnitSeconds      TimeUnit = "s"
	TimeUnitMinutes      TimeUnit = "min"
	TimeUnitHours        TimeUnit = "h"
	TimeUnitDays         TimeUnit = "d"
)

type TimeDuration struct {
	Value float64
	Unit  TimeUnit
}

func (t TimeDuration) MarshalJSON() ([]byte, error) {
	return json.Marshal([]any{t.Value, t.Unit})
}

func (t *TimeDuration) UnmarshalJSON(data []byte) error {
	var raw []any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if len(raw) != 2 {
		return fmt.Errorf("time duration must have two elements")
	}
	value, ok := raw[0].(float64)
	if !ok {
		return fmt.Errorf("time duration value must be numeric")
	}
	unit, ok := raw[1].(string)
	if !ok {
		return fmt.Errorf("time duration unit must be a string")
	}
	t.Value = value
	t.Unit = TimeUnit(unit)
	return nil
}

type RankValue struct {
	Rank         *int `json:"rank"`
	SegmentIndex *int `json:"segmentIndex"`
}

type Solution struct {
	Result string   `json:"result"`
	Time   any      `json:"time"`
	Score  *float64 `json:"score,omitempty"`
	Link   string   `json:"link,omitempty"`
}

type RankScore struct {
	Value float64 `json:"value"`
	Time  any     `json:"time,omitempty"`
}

type RankProblemStatus struct {
	Result    any        `json:"result"`
	Score     *float64   `json:"score,omitempty"`
	Time      any        `json:"time,omitempty"`
	Tries     *int       `json:"tries,omitempty"`
	Solutions []Solution `json:"solutions,omitempty"`
}

type User struct {
	ID           string   `json:"id"`
	Name         any      `json:"name"`
	Official     *bool    `json:"official,omitempty"`
	Organization any      `json:"organization,omitempty"`
	Marker       string   `json:"marker,omitempty"`
	Markers      []string `json:"markers,omitempty"`
}

type RanklistRow struct {
	User     User                `json:"user"`
	Score    RankScore           `json:"score"`
	Statuses []RankProblemStatus `json:"statuses"`
}

type Ranklist map[string]any

func UserToMap(user User) map[string]any {
	result := map[string]any{
		"id":   user.ID,
		"name": user.Name,
	}
	if user.Official != nil {
		result["official"] = *user.Official
	}
	if user.Organization != nil {
		result["organization"] = user.Organization
	}
	if user.Marker != "" {
		result["marker"] = user.Marker
	}
	if user.Markers != nil {
		result["markers"] = user.Markers
	}
	return result
}

func RankScoreToMap(score RankScore) map[string]any {
	result := map[string]any{"value": score.Value}
	if score.Time != nil {
		result["time"] = score.Time
	}
	return result
}

func SolutionToMap(solution Solution) map[string]any {
	result := map[string]any{
		"result": solution.Result,
	}
	if solution.Time != nil {
		result["time"] = solution.Time
	}
	if solution.Score != nil {
		result["score"] = *solution.Score
	}
	if solution.Link != "" {
		result["link"] = solution.Link
	}
	return result
}

func RankProblemStatusToMap(status RankProblemStatus) map[string]any {
	result := map[string]any{"result": status.Result}
	if status.Score != nil {
		result["score"] = *status.Score
	}
	if status.Time != nil {
		result["time"] = status.Time
	}
	if status.Tries != nil {
		result["tries"] = *status.Tries
	}
	if status.Solutions != nil {
		solutions := make([]any, len(status.Solutions))
		for index, solution := range status.Solutions {
			solutions[index] = SolutionToMap(solution)
		}
		result["solutions"] = solutions
	}
	return result
}

func RanklistRowToMap(row RanklistRow) map[string]any {
	statuses := make([]any, len(row.Statuses))
	for index, status := range row.Statuses {
		statuses[index] = RankProblemStatusToMap(status)
	}
	return map[string]any{
		"user":     UserToMap(row.User),
		"score":    RankScoreToMap(row.Score),
		"statuses": statuses,
	}
}

func RanklistRowsToMaps(rows []RanklistRow) []map[string]any {
	result := make([]map[string]any, len(rows))
	for index, row := range rows {
		result[index] = RanklistRowToMap(row)
	}
	return result
}
