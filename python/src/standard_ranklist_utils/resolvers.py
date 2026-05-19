import re
from collections.abc import Iterable
from typing import Any, Optional

from .enums import EnumTheme


def resolve_text(text: Any, languages: Optional[Iterable[str]] = None) -> str:
    if text is None:
        return ""
    if isinstance(text, str):
        return text
    langs = sorted((key for key in text.keys() if key and key != "fallback"), reverse=True)
    user_langs = list(languages or [])
    using_lang = ""
    for lang in user_langs:
        if lang in langs:
            using_lang = lang
            break
    if not using_lang:
        for lang in user_langs:
            primary = lang.split("-")[0]
            match = next(
                (candidate for candidate in langs if candidate == primary or candidate.startswith(f"{primary}-")),
                "",
            )
            if match:
                using_lang = match
                break
    if using_lang in text and text[using_lang] is not None:
        return text[using_lang]
    if text.get("fallback") is not None:
        return text["fallback"]
    return ""


def resolve_contributor(contributor: Optional[str]) -> Optional[dict[str, str]]:
    if not contributor:
        return None
    email = None
    url = None
    words = [part.strip() for part in contributor.split(" ")]
    index = len(words) - 1
    while index > 0:
        word = words[index]
        if word.startswith("<") and word.endswith(">"):
            email = word[1:-1]
            index -= 1
            continue
        if word.startswith("(") and word.endswith(")"):
            url = word[1:-1]
            index -= 1
            continue
        break
    result = {"name": " ".join(words[: index + 1])}
    if email is not None:
        result["email"] = email
    if url is not None:
        result["url"] = url
    return result


def resolve_color(color: Any) -> Optional[str]:
    if isinstance(color, list):
        return f"rgba({color[0]},{color[1]},{color[2]},{color[3]})"
    if color:
        return color
    return None


def resolve_theme_color(theme_color: Any) -> dict[str, Optional[str]]:
    if isinstance(theme_color, str):
        light = resolve_color(theme_color)
        dark = resolve_color(theme_color)
    else:
        theme_color = theme_color or {}
        light = resolve_color(theme_color.get("light"))
        dark = resolve_color(theme_color.get("dark"))
    return {EnumTheme.light.value: light, EnumTheme.dark.value: dark}


def _parse_color_rgb(color: str) -> tuple[float, float, float]:
    if color.startswith("#") and len(color) == 4:
        return (int(color[1] * 2, 16), int(color[2] * 2, 16), int(color[3] * 2, 16))
    if color.startswith("#") and len(color) == 7:
        return (int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16))
    match = re.match(r"rgba?\(([^,]+),([^,]+),([^,\)]+)", color)
    if match:
        return (float(match.group(1)), float(match.group(2)), float(match.group(3)))
    return (255, 255, 255)


def _auto_text_color(background_color: str) -> str:
    red, green, blue = _parse_color_rgb(background_color)
    return "#000000" if 0.213 * red + 0.715 * green + 0.072 * blue > 255 / 2 else "#ffffff"


def resolve_style(style: dict[str, Any]) -> dict[str, dict[str, Optional[str]]]:
    text_color = style.get("textColor")
    background_color = style.get("backgroundColor")
    using_text_color = text_color
    if background_color and not text_color:
        if isinstance(background_color, str):
            using_text_color = _auto_text_color(background_color)
        else:
            using_text_color = {
                "light": _auto_text_color(background_color["light"]) if background_color.get("light") else None,
                "dark": _auto_text_color(background_color["dark"]) if background_color.get("dark") else None,
            }
    return {
        "textColor": resolve_theme_color(using_text_color or ""),
        "backgroundColor": resolve_theme_color(background_color or ""),
    }


def resolve_user_markers(
    user: Optional[dict[str, Any]],
    markers_config: Optional[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    if not user:
        return []
    if isinstance(user.get("markers"), list):
        user_markers = user["markers"]
    else:
        user_markers = [user.get("marker")]
    markers = markers_config or []
    result = []
    for marker_id in filter(None, user_markers):
        match = next((marker for marker in markers if marker.get("id") == marker_id), None)
        if match:
            result.append(match)
    return result
