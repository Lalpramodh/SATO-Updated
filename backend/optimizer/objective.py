from __future__ import annotations

from typing import Any


def compute_optimization_score(total_penalty: float, maximum_penalty: float) -> float:
    if maximum_penalty <= 0:
        return 100.0
    score = 100.0 - min(100.0, (total_penalty / maximum_penalty) * 100.0)
    return round(score, 2)


def build_objective_penalty(
    assignment: dict[str, Any],
    slot_order: int,
    room_capacity: int,
    group_size: int,
    day_of_week: int | None = None,
    daily_group_load: int = 0,
    daily_faculty_load: int = 0,
    daily_total_load: int = 0,
) -> float:
    penalty = 0.0
    penalty += slot_order * 0.15
    if room_capacity > 0:
        penalty += max(0, room_capacity - group_size) * 0.02
    if day_of_week is not None:
        penalty += max(0, daily_total_load - 7) * 0.35
    penalty += max(0, daily_group_load - 2) * 0.9
    penalty += max(0, daily_faculty_load - 2) * 0.8
    return penalty
