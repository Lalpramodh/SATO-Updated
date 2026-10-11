from __future__ import annotations

from datetime import datetime
from typing import Any

DAY_NAMES = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday"}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _minutes(value: Any) -> int | None:
    if value is None:
        return None
    for time_format in ("%H:%M:%S", "%H:%M"):
        try:
            parsed = datetime.strptime(str(value).strip(), time_format)
            return parsed.hour * 60 + parsed.minute
        except ValueError:
            pass
    return None


def _ordered_slots(time_slots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        time_slots,
        key=lambda slot: (
            _safe_int(slot.get("day_of_week")),
            _minutes(slot.get("start_time")) if _minutes(slot.get("start_time")) is not None else -1,
            str(slot.get("id")),
        ),
    )


def _contiguous_block(
    time_slots: list[dict[str, Any]],
    slot_map: dict[str, dict[str, Any]],
    start_slot_id: Any,
    duration_hours: int,
) -> list[str] | None:
    ordered = _ordered_slots(time_slots)
    start_index = next((i for i, slot in enumerate(ordered) if str(slot.get("id")) == str(start_slot_id)), None)
    if start_index is None or duration_hours < 1 or start_index + duration_hours > len(ordered):
        return None

    block = ordered[start_index:start_index + duration_hours]
    day = _safe_int(block[0].get("day_of_week"), -1)
    for offset, slot in enumerate(block):
        if _safe_int(slot.get("day_of_week"), -2) != day:
            return None
        if offset:
            previous_end = _minutes(block[offset - 1].get("end_time"))
            current_start = _minutes(slot.get("start_time"))
            if previous_end is None or current_start is None or previous_end != current_start:
                return None
    return [str(slot["id"]) for slot in block if slot.get("id") is not None]


def _course_group_matches(course: dict[str, Any], group: dict[str, Any]) -> bool:
    if course.get("group_id") is not None:
        return str(course.get("group_id")) == str(group.get("id"))
    course_department = course.get("department_id")
    group_department = group.get("department_id")
    return course_department is None or group_department is None or str(course_department) == str(group_department)


def _course_room_matches(course: dict[str, Any], room: dict[str, Any]) -> bool:
    course_type = str(course.get("course_type") or "").lower()
    room_type = str(room.get("room_type") or "").lower()
    course_room_type = str(course.get("room_type") or "").lower()
    if course_type == "lab" and room_type != "lab":
        return False
    if course_room_type == "lab" and room_type != "lab":
        return False
    if course_type in {"seminar", "project"} or course_room_type in {"seminar", "project"}:
        return room_type in {"seminar", "project"}
    if course_type in {"theory", "lecture", "classroom"} or course_room_type in {"theory", "classroom"}:
        return room_type == "classroom"
    return not course_room_type or room_type == course_room_type


def _class_label(assignment: dict[str, Any], course_map: dict[str, dict[str, Any]], group_map: dict[str, dict[str, Any]]) -> str:
    course = course_map.get(str(assignment.get("course_id")), {})
    group = group_map.get(str(assignment.get("group_id")), {})
    course_name = " - ".join(
        str(value) for value in (course.get("course_code"), course.get("course_name")) if value
    ) or str(assignment.get("course_id") or "Unknown course")
    group_name = group.get("name") or group.get("code") or assignment.get("group_id")
    return f"{course_name} ({group_name})" if group_name else course_name


def validate_candidate_assignments(
    assignments: list[dict[str, Any]],
    courses: list[dict[str, Any]],
    faculty: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    rooms: list[dict[str, Any]],
    time_slots: list[dict[str, Any]],
    faculty_availability: list[dict[str, Any]],
) -> dict[str, Any]:
    """Validate candidate sessions independently of the solver status and score."""
    course_map = {str(row.get("id")): row for row in courses if row.get("id") is not None}
    faculty_map = {str(row.get("id")): row for row in faculty if row.get("id") is not None}
    group_map = {str(row.get("id")): row for row in groups if row.get("id") is not None}
    room_map = {str(row.get("id")): row for row in rooms if row.get("id") is not None}
    slot_map = {str(row.get("id")): row for row in time_slots if row.get("id") is not None}
    blocked_availability = {
        (str(row.get("faculty_id")), str(row.get("time_slot_id")))
        for row in faculty_availability
        if row.get("available") is False
    }
    violations: list[dict[str, Any]] = []
    checked: list[dict[str, Any]] = []
    course_counts: dict[str, int] = {}

    def add_violation(code: str, message: str, assignment: dict[str, Any] | None = None, **details: Any) -> None:
        violation = {"code": code, "message": message}
        if assignment is not None:
            violation["class"] = _class_label(assignment, course_map, group_map)
            slot_ids = assignment.get("time_slot_ids") or []
            slot = slot_map.get(str(slot_ids[0])) if slot_ids else None
            if slot:
                violation["day"] = DAY_NAMES.get(_safe_int(slot.get("day_of_week")), "Unknown")
                violation["requested_time"] = f"{str(slot.get('start_time') or '')[:5]}-{str(slot.get('end_time') or '')[:5]}"
        violation.update({key: value for key, value in details.items() if value is not None})
        violations.append(violation)

    if not isinstance(assignments, list):
        return {"valid": False, "violation_count": 1, "violations": [{"code": "invalid_assignments", "message": "Timetable assignments must be a list."}]}

    for assignment in assignments:
        if not isinstance(assignment, dict):
            add_violation("invalid_assignment", "A timetable assignment is malformed.")
            continue

        course_id = str(assignment.get("course_id") or "")
        faculty_id = str(assignment.get("faculty_id") or "")
        group_id = str(assignment.get("group_id") or "")
        room_id = str(assignment.get("room_id") or "")
        course = course_map.get(course_id)
        faculty_member = faculty_map.get(faculty_id)
        group = group_map.get(group_id)
        room = room_map.get(room_id)

        for reference, found, label in (
            (course_id, course, "course"),
            (faculty_id, faculty_member, "faculty"),
            (group_id, group, "student group"),
            (room_id, room, "room"),
        ):
            if not reference or found is None:
                add_violation("invalid_reference", f"Timetable references an unknown {label}.", assignment, reference=reference or None)

        duration = _safe_int(assignment.get("duration_hours"), 0)
        slot_ids = [str(value) for value in assignment.get("time_slot_ids", [])] if isinstance(assignment.get("time_slot_ids"), list) else []
        if duration < 1 or len(slot_ids) != duration:
            add_violation("invalid_duration", "Session duration does not match its occupied time blocks.", assignment, duration_hours=duration, occupied_blocks=len(slot_ids))
        if len(set(slot_ids)) != len(slot_ids) or any(slot_id not in slot_map for slot_id in slot_ids):
            add_violation("invalid_time_slot", "Timetable contains a duplicate or unknown time slot.", assignment)
        elif slot_ids and duration > 0:
            expected_block = _contiguous_block(time_slots, slot_map, slot_ids[0], duration)
            if expected_block != slot_ids:
                add_violation("invalid_duration_block", "A multi-hour session must use consecutive time blocks on one day.", assignment)

        if course is not None:
            course_counts[course_id] = course_counts.get(course_id, 0) + 1
            required_duration = max(1, _safe_int(course.get("duration_hours"), 1))
            if duration != required_duration:
                add_violation("course_duration_mismatch", "Session duration does not match the course requirement.", assignment, required_duration=required_duration)
            required_faculty = course.get("faculty_id")
            if required_faculty is not None and str(required_faculty) != faculty_id:
                add_violation("course_faculty_mismatch", "Timetable does not use the course's required faculty member.", assignment)
            if group is not None and (
                (course.get("group_id") is not None and str(course.get("group_id")) != group_id)
                or (course.get("group_id") is None and course.get("department_id") is not None and group.get("department_id") is not None and str(course.get("department_id")) != str(group.get("department_id")))
            ):
                add_violation("course_group_mismatch", "Student group is not eligible for this course.", assignment)
            if room is not None and not _course_room_matches(course, room):
                add_violation("room_type_mismatch", "Room type is not compatible with the course.", assignment)
        if room is not None and group is not None:
            room_capacity = _safe_int(room.get("capacity"), 0)
            group_size = _safe_int(group.get("student_count"), 0)
            if room_capacity <= 0 or group_size > room_capacity:
                add_violation("room_capacity", "Room capacity is insufficient for the student group.", assignment, room_capacity=room_capacity, group_size=group_size)
        if faculty_member is not None:
            for slot_id in slot_ids:
                if (faculty_id, slot_id) in blocked_availability:
                    add_violation("faculty_unavailable", "Faculty availability is blocked for an occupied session block.", assignment, faculty=faculty_member.get("name"))
                    break

        if course is not None and faculty_member is not None and group is not None and room is not None and slot_ids and all(slot_id in slot_map for slot_id in slot_ids):
            first_slot = slot_map[slot_ids[0]]
            last_slot = slot_map[slot_ids[-1]]
            start = _minutes(first_slot.get("start_time"))
            end = _minutes(last_slot.get("end_time"))
            if start is not None and end is not None:
                checked.append({
                    **assignment,
                    "course_id": course_id,
                    "faculty_id": faculty_id,
                    "group_id": group_id,
                    "room_id": room_id,
                    "day": _safe_int(first_slot.get("day_of_week"), -1),
                    "start": start,
                    "end": end,
                })

    for course_id, course in course_map.items():
        required_sessions = max(1, _safe_int(course.get("sessions_per_week"), 1))
        actual_sessions = course_counts.get(course_id, 0)
        if actual_sessions != required_sessions:
            course_name = " - ".join(str(value) for value in (course.get("course_code"), course.get("course_name")) if value) or course_id
            violations.append({
                "code": "session_count",
                "message": f"{course_name} requires {required_sessions} session(s), but the timetable has {actual_sessions}.",
                "course_id": course_id,
                "required_sessions": required_sessions,
                "actual_sessions": actual_sessions,
            })

    for index, left in enumerate(checked):
        for right in checked[index + 1:]:
            if left["day"] != right["day"] or left["start"] >= right["end"] or right["start"] >= left["end"]:
                continue
            conflicts = (
                ("faculty_overlap", "faculty_id", "Faculty"),
                ("group_overlap", "group_id", "Student group"),
                ("room_overlap", "room_id", "Room"),
            )
            for code, field, label in conflicts:
                if left[field] != right[field]:
                    continue
                left_class = _class_label(left, course_map, group_map)
                right_class = _class_label(right, course_map, group_map)
                left_time = f"{left['start'] // 60:02d}:{left['start'] % 60:02d}-{left['end'] // 60:02d}:{left['end'] % 60:02d}"
                right_time = f"{right['start'] // 60:02d}:{right['start'] % 60:02d}-{right['end'] // 60:02d}:{right['end'] % 60:02d}"
                violations.append({
                    "code": code,
                    "message": f"{label} is assigned to overlapping classes.",
                    "resource": faculty_map.get(left[field], {}).get("name") if field == "faculty_id" else group_map.get(left[field], {}).get("name") if field == "group_id" else room_map.get(left[field], {}).get("name"),
                    "day": DAY_NAMES.get(left["day"], "Unknown"),
                    "requested_time": left_time,
                    "conflicting_time": right_time,
                    "classes": [left_class, right_class],
                })

    return {"valid": not violations, "violation_count": len(violations), "violations": violations}


def persisted_entries_to_assignments(
    entries: list[dict[str, Any]],
    time_slots: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Collapse the existing one-row-per-occupied-slot representation into sessions."""
    slot_map = {str(row.get("id")): row for row in time_slots if row.get("id") is not None}
    slot_order = _ordered_slots(time_slots)
    partitions: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for entry in entries:
        key = tuple(str(entry.get(field) or "") for field in ("course_id", "faculty_id", "group_id", "room_id"))
        partitions.setdefault(key, []).append(entry)

    assignments: list[dict[str, Any]] = []
    for rows in partitions.values():
        pending = {str(row.get("time_slot_id")): row for row in rows if row.get("time_slot_id") is not None}
        ordered_rows = sorted(
            rows,
            key=lambda row: (
                _safe_int(slot_map.get(str(row.get("time_slot_id")), {}).get("day_of_week")),
                _minutes(slot_map.get(str(row.get("time_slot_id")), {}).get("start_time")) or -1,
            ),
        )
        for row in ordered_rows:
            start_id = str(row.get("time_slot_id"))
            if start_id not in pending:
                continue
            duration = max(1, _safe_int(row.get("duration_hours"), 1))
            block = _contiguous_block(slot_order, slot_map, start_id, duration)
            if block and all(slot_id in pending for slot_id in block):
                slot_ids = block
                for slot_id in block:
                    pending.pop(slot_id, None)
            else:
                slot_ids = [start_id]
                pending.pop(start_id, None)
            assignments.append({
                "course_id": row.get("course_id"),
                "faculty_id": row.get("faculty_id"),
                "group_id": row.get("group_id"),
                "room_id": row.get("room_id"),
                "time_slot_ids": slot_ids,
                "duration_hours": duration,
            })
    return assignments
