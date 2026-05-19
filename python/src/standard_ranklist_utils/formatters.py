import math
from collections.abc import Sequence
from typing import Callable, Union

from .types import TimeUnit

NumberLike = Union[int, float, str]


def _to_milliseconds(time: Sequence[Union[int, float, str]]) -> float:
    value = time[0]
    unit = time[1]
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f"Invalid source time value {value}")
    if unit == "ms":
        return value
    if unit == "s":
        return value * 1000
    if unit == "min":
        return value * 1000 * 60
    if unit == "h":
        return value * 1000 * 60 * 60
    if unit == "d":
        return value * 1000 * 60 * 60 * 24
    raise ValueError(f"Invalid source time unit {unit}")


def format_time_duration(
    time: Sequence[Union[int, float, str]],
    target_unit: TimeUnit = "ms",
    fmt: Callable[[float], float] = lambda number: number,
) -> float:
    ms = _to_milliseconds(time)
    if target_unit == "ms":
        return ms
    if target_unit == "s":
        return fmt(ms / 1000)
    if target_unit == "min":
        return fmt(ms / 1000 / 60)
    if target_unit == "h":
        return fmt(ms / 1000 / 60 / 60)
    if target_unit == "d":
        return fmt(ms / 1000 / 60 / 60 / 24)
    raise ValueError(f"Invalid target time unit {target_unit}")


def pre_zero_fill(num: int, size: int) -> str:
    if num >= 10**size:
        return str(num)
    text = ("0" * size) + str(num)
    return text[len(text) - size :]


def sec_to_time_str(second: float, *, fill_hour: bool = False, show_day: bool = False) -> str:
    if second < 0:
        return "--"
    sec = second
    days = 0
    if show_day:
        days = math.floor(sec / 86400)
        sec %= 86400
    hours = math.floor(sec / 3600)
    sec %= 3600
    minutes = math.floor(sec / 60)
    sec %= 60
    seconds = math.floor(sec)
    day_text = f"{days}D " if show_day and days >= 1 else ""
    hour_text = pre_zero_fill(hours, 2) if fill_hour else str(hours)
    return f"{day_text}{hour_text}:{pre_zero_fill(minutes, 2)}:{pre_zero_fill(seconds, 2)}"


def number_to_alphabet(number: NumberLike) -> str:
    n = int(float(number))
    radix = 26
    count = 1
    power = radix
    while n >= power:
        n -= power
        count += 1
        power *= radix
    result = []
    while count > 0:
        result.append(chr((n % radix) + 65))
        n = math.trunc(n / radix)
        count -= 1
    return "".join(reversed(result))


def alphabet_to_number(alphabet: str) -> int:
    if not isinstance(alphabet, str) or not alphabet:
        return -1
    chars = list(reversed(alphabet.upper()))
    radix = 26
    power = 1
    result = -1
    for char in chars:
        result += (ord(char) - 65) * power + power
        power *= radix
    return result
