package srkutils

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

func numberValue(value any) float64 {
	switch v := value.(type) {
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case float64:
		return v
	case float32:
		return float64(v)
	case json.Number:
		f, _ := v.Float64()
		return f
	default:
		f, _ := strconv.ParseFloat(fmt.Sprint(v), 64)
		return f
	}
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func asSlice(value any) []any {
	switch v := value.(type) {
	case []any:
		return v
	case TimeDuration:
		return []any{v.Value, string(v.Unit)}
	case []float64:
		result := make([]any, len(v))
		for i, item := range v {
			result[i] = item
		}
		return result
	case []int:
		result := make([]any, len(v))
		for i, item := range v {
			result[i] = item
		}
		return result
	case []int64:
		result := make([]any, len(v))
		for i, item := range v {
			result[i] = item
		}
		return result
	case []map[string]any:
		result := make([]any, len(v))
		for i, item := range v {
			result[i] = item
		}
		return result
	case []string:
		result := make([]any, len(v))
		for i, item := range v {
			result[i] = item
		}
		return result
	case nil:
		return []any{}
	default:
		return []any{}
	}
}

func asMap(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func FormatTimeDurationChecked(time any, targetUnit string, fmtFn func(float64) float64) (float64, error) {
	raw := asSlice(time)
	if len(raw) < 2 {
		return 0, fmt.Errorf("invalid source time duration")
	}
	value := numberValue(raw[0])
	unit := stringValue(raw[1])
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, fmt.Errorf("invalid source time value %v", raw[0])
	}
	ms := -1.0
	switch unit {
	case "ms":
		ms = value
	case "s":
		ms = value * 1000
	case "min":
		ms = value * 1000 * 60
	case "h":
		ms = value * 1000 * 60 * 60
	case "d":
		ms = value * 1000 * 60 * 60 * 24
	default:
		return 0, fmt.Errorf("invalid source time unit %s", unit)
	}
	if fmtFn == nil {
		fmtFn = func(number float64) float64 { return number }
	}
	switch targetUnit {
	case "", "ms":
		return ms, nil
	case "s":
		return fmtFn(ms / 1000), nil
	case "min":
		return fmtFn(ms / 1000 / 60), nil
	case "h":
		return fmtFn(ms / 1000 / 60 / 60), nil
	case "d":
		return fmtFn(ms / 1000 / 60 / 60 / 24), nil
	default:
		return 0, fmt.Errorf("invalid target time unit %s", targetUnit)
	}
}

func FormatTimeDuration(time any, targetUnit string, fmtFn func(float64) float64) float64 {
	value, err := FormatTimeDurationChecked(time, targetUnit, fmtFn)
	if err != nil {
		panic(err)
	}
	return value
}

func PreZeroFill(num int, size int) string {
	if float64(num) >= math.Pow(10, float64(size)) {
		return strconv.Itoa(num)
	}
	text := strings.Repeat("0", size) + strconv.Itoa(num)
	return text[len(text)-size:]
}

type SecToTimeStrOptions struct {
	FillHour bool
	ShowDay  bool
}

func SecToTimeStr(second float64, options SecToTimeStrOptions) string {
	if second < 0 {
		return "--"
	}
	sec := second
	days := 0
	if options.ShowDay {
		days = int(math.Floor(sec / 86400))
		sec = math.Mod(sec, 86400)
	}
	hours := int(math.Floor(sec / 3600))
	sec = math.Mod(sec, 3600)
	minutes := int(math.Floor(sec / 60))
	sec = math.Mod(sec, 60)
	seconds := int(math.Floor(sec))
	dayText := ""
	if options.ShowDay && days >= 1 {
		dayText = fmt.Sprintf("%dD ", days)
	}
	hourText := strconv.Itoa(hours)
	if options.FillHour {
		hourText = PreZeroFill(hours, 2)
	}
	return fmt.Sprintf("%s%s:%s:%s", dayText, hourText, PreZeroFill(minutes, 2), PreZeroFill(seconds, 2))
}

func NumberToAlphabet(number any) string {
	n := int(math.Trunc(numberValue(number)))
	radix := 26
	count := 1
	power := radix
	for n >= power {
		n -= power
		count++
		power *= radix
	}
	result := []byte{}
	for ; count > 0; count-- {
		result = append(result, byte((n%radix)+65))
		n = int(math.Trunc(float64(n) / float64(radix)))
	}
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return string(result)
}

func AlphabetToNumber(alphabet string) int {
	if alphabet == "" {
		return -1
	}
	upper := strings.ToUpper(alphabet)
	radix := 26
	power := 1
	result := -1
	for i := len(upper) - 1; i >= 0; i-- {
		result += (int(upper[i])-65)*power + power
		power *= radix
	}
	return result
}
