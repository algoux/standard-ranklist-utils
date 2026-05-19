package srkutils

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

func ResolveText(text any, languages []string) string {
	if text == nil {
		return ""
	}
	if value, ok := text.(string); ok {
		return value
	}
	values := asMap(text)
	langs := []string{}
	for key := range values {
		if key != "" && key != "fallback" {
			langs = append(langs, key)
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(langs)))
	usingLang := ""
	for _, lang := range languages {
		for _, candidate := range langs {
			if candidate == lang {
				usingLang = candidate
				break
			}
		}
		if usingLang != "" {
			break
		}
	}
	if usingLang == "" {
		for _, lang := range languages {
			primary := strings.Split(lang, "-")[0]
			for _, candidate := range langs {
				if candidate == primary || strings.HasPrefix(candidate, primary+"-") {
					usingLang = candidate
					break
				}
			}
			if usingLang != "" {
				break
			}
		}
	}
	if value, ok := values[usingLang].(string); ok {
		return value
	}
	if value, ok := values["fallback"].(string); ok {
		return value
	}
	return ""
}

func ResolveContributor(contributor string) map[string]any {
	if contributor == "" {
		return nil
	}
	words := strings.Fields(contributor)
	index := len(words) - 1
	email := ""
	url := ""
	for index > 0 {
		word := words[index]
		if strings.HasPrefix(word, "<") && strings.HasSuffix(word, ">") {
			email = word[1 : len(word)-1]
			index--
			continue
		}
		if strings.HasPrefix(word, "(") && strings.HasSuffix(word, ")") {
			url = word[1 : len(word)-1]
			index--
			continue
		}
		break
	}
	result := map[string]any{"name": strings.Join(words[:index+1], " ")}
	if email != "" {
		result["email"] = email
	}
	if url != "" {
		result["url"] = url
	}
	return result
}

func ResolveColor(color any) any {
	if raw := asSlice(color); len(raw) >= 4 {
		return fmt.Sprintf("rgba(%v,%v,%v,%v)", raw[0], raw[1], raw[2], raw[3])
	}
	if value, ok := color.(string); ok {
		if value != "" {
			return value
		}
	}
	return nil
}

func ResolveThemeColor(themeColor any) map[string]any {
	if value, ok := themeColor.(string); ok {
		color := ResolveColor(value)
		return map[string]any{"light": color, "dark": color}
	}
	values := asMap(themeColor)
	return map[string]any{"light": ResolveColor(values["light"]), "dark": ResolveColor(values["dark"])}
}

func parseColorRGB(color string) (float64, float64, float64) {
	if strings.HasPrefix(color, "#") && len(color) == 4 {
		r, _ := strconvParseHex(strings.Repeat(color[1:2], 2))
		g, _ := strconvParseHex(strings.Repeat(color[2:3], 2))
		b, _ := strconvParseHex(strings.Repeat(color[3:4], 2))
		return r, g, b
	}
	if strings.HasPrefix(color, "#") && len(color) == 7 {
		r, _ := strconvParseHex(color[1:3])
		g, _ := strconvParseHex(color[3:5])
		b, _ := strconvParseHex(color[5:7])
		return r, g, b
	}
	re := regexp.MustCompile(`rgba?\(([^,]+),([^,]+),([^,\)]+)`)
	match := re.FindStringSubmatch(color)
	if len(match) == 4 {
		return numberValue(match[1]), numberValue(match[2]), numberValue(match[3])
	}
	return 255, 255, 255
}

func strconvParseHex(value string) (float64, error) {
	var parsed int64
	_, err := fmt.Sscanf(value, "%x", &parsed)
	return float64(parsed), err
}

func autoTextColor(backgroundColor string) string {
	red, green, blue := parseColorRGB(backgroundColor)
	if 0.213*red+0.715*green+0.072*blue > 255/2 {
		return "#000000"
	}
	return "#ffffff"
}

func ResolveStyle(style map[string]any) map[string]any {
	textColor := style["textColor"]
	backgroundColor := style["backgroundColor"]
	usingTextColor := textColor
	if backgroundColor != nil && textColor == nil {
		if value, ok := backgroundColor.(string); ok {
			usingTextColor = autoTextColor(value)
		} else {
			theme := asMap(backgroundColor)
			result := map[string]any{}
			if theme["light"] != nil {
				result["light"] = autoTextColor(stringValue(theme["light"]))
			}
			if theme["dark"] != nil {
				result["dark"] = autoTextColor(stringValue(theme["dark"]))
			}
			usingTextColor = result
		}
	}
	return map[string]any{
		"textColor":       ResolveThemeColor(firstNonNil(usingTextColor, "")),
		"backgroundColor": ResolveThemeColor(firstNonNil(backgroundColor, "")),
	}
}

func firstNonNil(value any, fallback any) any {
	if value == nil {
		return fallback
	}
	return value
}

func ResolveUserMarkers(user map[string]any, markersConfig []map[string]any) []map[string]any {
	if user == nil {
		return []map[string]any{}
	}
	var userMarkers []any
	if markers, ok := user["markers"]; ok {
		userMarkers = asSlice(markers)
	} else {
		userMarkers = []any{user["marker"]}
	}
	result := []map[string]any{}
	for _, markerID := range userMarkers {
		if markerID == nil {
			continue
		}
		for _, marker := range markersConfig {
			if marker["id"] == markerID {
				result = append(result, marker)
				break
			}
		}
	}
	return result
}
