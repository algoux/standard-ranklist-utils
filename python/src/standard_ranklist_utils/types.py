from collections.abc import Sequence
from typing import Any, Literal, Optional, TypedDict, Union

TimeUnit = Literal["ms", "s", "min", "h", "d"]
TimeDuration = Sequence[Union[float, TimeUnit]]
I18NStringSet = dict[str, str]
Text = Union[str, I18NStringSet]
Color = Union[str, list[float]]
ThemeColorInput = Union[str, dict[str, str]]


class ThemeColor(TypedDict):
    light: Optional[str]
    dark: Optional[str]


class _RankValueRequired(TypedDict):
    rank: Optional[int]


class RankValue(_RankValueRequired, total=False):
    segmentIndex: Optional[int]


CalculatedSolutionTetrad = list[Any]
Ranklist = dict[str, Any]
RanklistRow = dict[str, Any]
RankProblemStatus = dict[str, Any]
Marker = dict[str, Any]
