from __future__ import annotations

import os
import re
import time
import uuid
from typing import Any

from optimizer.scheduler import generate_timetable
from optimizer.validation import persisted_entries_to_assignments, validate_candidate_assignments
from services.timetable_service import timetable_service


DAY_NAMES = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday"}
MAX_ADDITIONAL_ATTEMPTS = 3


def _scope_context(academic_year: str, semester: int, department: str | None, student_group: str | None) -> dict[str, Any]:
    departments = timetable_service.get_departments()
    selected_department = None
    if department:
        selected_department = next(
            (row for row in departments if department in {row.get("code"), row.get("short_name"), row.get("name"), str(row.get("id"))}),
            None,
        )
        if not selected_department:
            raise ValueError(f"Unknown department: {department}.")

    courses = timetable_service.get_courses(semester)
    if selected_department:
        courses = [row for row in courses if str(row.get("department_id")) == str(selected_department.get("id"))]
    if not courses:
        raise ValueError(f"No courses found for academic_year={academic_year}, semester={semester}.")

    groups = timetable_service.get_student_groups(semester)
    if selected_department:
        groups = [row for row in groups if str(row.get("department_id")) == str(selected_department.get("id"))]
    selected_group = None
    if student_group:
        selected_group = next((row for row in groups if student_group in {str(row.get("id")), row.get("name")}), None)
        if not selected_group:
            raise ValueError("The selected student group is not valid for this semester and department.")
        groups = [selected_group]
    if not groups:
        raise ValueError(f"No student groups found for semester {semester}.")
    group_ids = {str(row.get("id")) for row in groups}
    courses = [row for row in courses if row.get("group_id") is None or str(row.get("group_id")) in group_ids]
    if not courses:
        raise ValueError("No courses are applicable to the selected student-group scope.")

    records = timetable_service.get_timetables(academic_year, semester)
    latest = records[0] if records else None
    return {
        "academic_year": academic_year,
        "semester": semester,
        "department": selected_department,
        "student_group": selected_group,
        "courses": courses,
        "faculty": timetable_service.get_faculty(),
        "groups": groups,
        "rooms": timetable_service.get_rooms(),
        "time_slots": timetable_service.get_time_slots(),
        "availability": timetable_service.get_faculty_availability(),
        "records": records,
        "latest": latest,
        "base_latest_timetable_id": latest.get("id") if latest else None,
    }


def _scope_label(context: dict[str, Any]) -> str:
    parts = []
    if context["department"]:
        parts.append(context["department"].get("code") or context["department"].get("name") or str(context["department"].get("id")))
    if context["student_group"]:
        parts.append(context["student_group"].get("name") or str(context["student_group"].get("id")))
    return " / ".join(parts)


def _timetable_name(context: dict[str, Any]) -> str:
    base = f"{context['academic_year']}-sem{context['semester']}"
    scope = _scope_label(context)
    return f"{base} [{scope}]" if scope else base


def _pending_timetable_name() -> str:
    return f"SATO-CANDIDATE-PENDING-{uuid.uuid4()}"


def _scope_record_matches(record: dict[str, Any], context: dict[str, Any]) -> bool:
    name = str(record.get("name") or "")
    base = f"{context['academic_year']}-sem{context['semester']}"
    if name == base or not name.startswith(f"{base} ["):
        return True
    return name == f"{base} [{_scope_label(context)}]"


def _scoped_persisted_entries(record: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    rows = timetable_service.get_timetable_entries(str(record.get("id")))
    course_ids = {str(row.get("id")) for row in context["courses"]}
    group_ids = {str(row.get("id")) for row in context["groups"]}
    return [
        row for row in rows
        if str(row.get("course_id")) in course_ids and str(row.get("group_id")) in group_ids
    ]


def _previous_for_scope(context: dict[str, Any]) -> tuple[dict[str, Any] | None, list[dict[str, Any]], dict[str, Any] | None]:
    for record in context["records"]:
        if not _scope_record_matches(record, context):
            continue
        entries = _scoped_persisted_entries(record, context)
        if not entries:
            continue
        assignments = persisted_entries_to_assignments(entries, context["time_slots"])
        validation = validate_candidate_assignments(
            assignments,
            context["courses"],
            context["faculty"],
            context["groups"],
            context["rooms"],
            context["time_slots"],
            context["availability"],
        )
        return record, assignments, validation
    return None, [], None


def _objective_value(assignments: list[dict[str, Any]], faculty: list[dict[str, Any]], groups: list[dict[str, Any]], time_slots: list[dict[str, Any]]) -> int:
    slot_map = {str(slot.get("id")): slot for slot in time_slots}
    objective = 0
    faculty_day_counts: dict[tuple[str, int], int] = {}
    group_day_counts: dict[tuple[str, int], int] = {}
    total_day_counts: dict[int, int] = {}
    used_days: set[int] = set()

    for assignment in assignments:
        slot_ids = assignment.get("time_slot_ids") or []
        slots = [slot_map.get(str(slot_id)) for slot_id in slot_ids]
        slots = [slot for slot in slots if slot]
        buckets = [(_int(slot.get("day_of_week")), str(slot.get("start_time") or "00:00:00")) for slot in slots]
        if buckets:
            penalty = sum(index + 1 for index, _ in enumerate(buckets)) * 0.1
            objective += int(round(penalty * 100))
        days = {_int(slot.get("day_of_week")) for slot in slots}
        for day in days:
            used_days.add(day)
            faculty_key = (str(assignment.get("faculty_id")), day)
            group_key = (str(assignment.get("group_id")), day)
            faculty_day_counts[faculty_key] = faculty_day_counts.get(faculty_key, 0) + 1
            group_day_counts[group_key] = group_day_counts.get(group_key, 0) + 1
            total_day_counts[day] = total_day_counts.get(day, 0) + 1

    objective += sum(max(0, count - 2) * 150 for count in faculty_day_counts.values())
    objective += sum(max(0, count - 2) * 170 for count in group_day_counts.values())
    objective += sum(max(0, count - 7) * 100 for count in total_day_counts.values())
    objective -= len(used_days) * 450
    return objective


def _int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _presentation(assignment: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    courses = {str(row.get("id")): row for row in context["courses"]}
    faculty = {str(row.get("id")): row for row in context["faculty"]}
    groups = {str(row.get("id")): row for row in context["groups"]}
    rooms = {str(row.get("id")): row for row in context["rooms"]}
    slots = {str(row.get("id")): row for row in context["time_slots"]}
    course = courses.get(str(assignment.get("course_id")), {})
    member = faculty.get(str(assignment.get("faculty_id")), {})
    group = groups.get(str(assignment.get("group_id")), {})
    room = rooms.get(str(assignment.get("room_id")), {})
    slot_ids = assignment.get("time_slot_ids") or []
    first = slots.get(str(slot_ids[0])) if slot_ids else None
    last = slots.get(str(slot_ids[-1])) if slot_ids else None
    day_number = _int(first.get("day_of_week")) if first else 0
    return {
        **assignment,
        "course_code": course.get("course_code"),
        "course_name": course.get("course_name"),
        "faculty_name": member.get("name"),
        "faculty_employee_code": member.get("employee_code"),
        "group_name": group.get("name"),
        "room_name": room.get("name"),
        "day": DAY_NAMES.get(day_number, "Unknown"),
        "start_time": str(first.get("start_time") or "")[:5] if first else None,
        "end_time": str(last.get("end_time") or "")[:5] if last else None,
    }


def _compare_assignments(previous: list[dict[str, Any]], candidate: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, Any]:
    previous_by_course: dict[str, list[dict[str, Any]]] = {}
    candidate_by_course: dict[str, list[dict[str, Any]]] = {}
    for assignment in previous:
        previous_by_course.setdefault(str(assignment.get("course_id")), []).append(assignment)
    for assignment in candidate:
        candidate_by_course.setdefault(str(assignment.get("course_id")), []).append(assignment)

    def sort_assignments(rows):
        return sorted(rows, key=lambda row: (
            str(row.get("group_id")),
            _int(next((slot.get("day_of_week") for slot in context["time_slots"] if str(slot.get("id")) == str((row.get("time_slot_ids") or [None])[0])), 0)),
            str(next((slot.get("start_time") for slot in context["time_slots"] if str(slot.get("id")) == str((row.get("time_slot_ids") or [None])[0])), "")),
        ))

    added, removed, changed = [], [], []
    for course_id in sorted(set(previous_by_course) | set(candidate_by_course)):
        old_rows = sort_assignments(previous_by_course.get(course_id, []))
        new_rows = sort_assignments(candidate_by_course.get(course_id, []))
        shared = min(len(old_rows), len(new_rows))
        for index in range(shared):
            old, new = old_rows[index], new_rows[index]
            fields = (
                ("course_id", "Course"),
                ("faculty_id", "Faculty"),
                ("room_id", "Room"),
                ("group_id", "Student group"),
                ("time_slot_ids", "Day/time"),
                ("duration_hours", "Duration"),
            )
            differences = [
                {"field": label, "before": old.get(key), "after": new.get(key)}
                for key, label in fields
                if old.get(key) != new.get(key)
            ]
            if differences:
                changed.append({"before": _presentation(old, context), "after": _presentation(new, context), "changes": differences})
        removed.extend(_presentation(row, context) for row in old_rows[shared:])
        added.extend(_presentation(row, context) for row in new_rows[shared:])
    return {"added": added, "removed": removed, "changed": changed, "change_count": len(added) + len(removed) + len(changed)}


def _compare_payload(context: dict[str, Any], candidate_assignments: list[dict[str, Any]], candidate_score: float | None) -> dict[str, Any]:
    previous, previous_assignments, previous_validation = _previous_for_scope(context)
    candidate_validation = validate_candidate_assignments(
        candidate_assignments,
        context["courses"],
        context["faculty"],
        context["groups"],
        context["rooms"],
        context["time_slots"],
        context["availability"],
    )
    previous_score = previous.get("optimization_score") if previous else None
    score_delta = None
    if previous_score is not None and candidate_score is not None:
        try:
            score_delta = float(candidate_score) - float(previous_score)
        except (TypeError, ValueError):
            score_delta = None
    return {
        "previous": ({
            "timetable_id": previous.get("id"),
            "name": previous.get("name"),
            "optimization_score": previous_score,
            "validation": previous_validation,
            "assignments": [_presentation(row, context) for row in previous_assignments],
        } if previous else None),
        "candidate": {
            "optimization_score": candidate_score,
            "validation": candidate_validation,
            "assignments": [_presentation(row, context) for row in candidate_assignments],
        },
        "assignment_changes": _compare_assignments(previous_assignments, candidate_assignments, context) if previous else None,
        "optimization_score_delta": score_delta,
        "message": "No previous timetable exists for this academic year, semester, and scope." if not previous else None,
    }


def compare_timetable_candidate(
    academic_year: str,
    semester: int,
    department: str | None,
    student_group: str | None,
    assignments: list[dict[str, Any]],
    base_latest_timetable_id: str | None,
) -> dict[str, Any]:
    context = _scope_context(academic_year, semester, department, student_group)
    if context["base_latest_timetable_id"] != base_latest_timetable_id:
        return {"success": False, "error": "STALE_CANDIDATE", "message": "A newer timetable exists. Generate a fresh candidate before comparing.", "status": 409}
    comparison = _compare_payload(context, assignments, 90.0)
    return {"success": True, "base_latest_timetable_id": base_latest_timetable_id, **comparison}


def generate_timetable_candidate(
    academic_year: str,
    semester: int,
    department: str | None = None,
    student_group: str | None = None,
    additional_attempts: int = 0,
    expected_base_timetable_id: str | None = None,
    check_base: bool = False,
    best_candidate: dict[str, Any] | None = None,
) -> dict[str, Any]:
    context = _scope_context(academic_year, semester, department, student_group)
    if check_base and context["base_latest_timetable_id"] != expected_base_timetable_id:
        return {"success": False, "error": "STALE_CANDIDATE", "message": "A newer timetable exists. Generate a fresh candidate before retrying.", "status": 409}

    retry_limit = min(MAX_ADDITIONAL_ATTEMPTS, max(0, _int(additional_attempts)))
    optimizer_limit = max(1.0, float(os.getenv("OPTIMIZER_MAX_TIME_SECONDS", "300")))
    budget_seconds = max(1.0, float(os.getenv("OPTIMIZER_CANDIDATE_BUDGET_SECONDS", str(min(optimizer_limit, 240.0)))))
    deadline = time.monotonic() + min(budget_seconds, optimizer_limit)
    attempts = []
    best = None
    last_invalid = None

    if best_candidate and isinstance(best_candidate.get("assignments"), list):
        validation = validate_candidate_assignments(
            best_candidate["assignments"], context["courses"], context["faculty"], context["groups"],
            context["rooms"], context["time_slots"], context["availability"],
        )
        if validation["valid"]:
            best = {
                **best_candidate,
                "assignments": best_candidate["assignments"],
                "validation": validation,
                "objective_value": _objective_value(best_candidate["assignments"], context["faculty"], context["groups"], context["time_slots"]),
            }

    for attempt_number in range(1, retry_limit + 2):
        remaining = deadline - time.monotonic()
        if remaining <= 0.05:
            break
        result = generate_timetable(
            academic_year,
            semester,
            department,
            student_group,
            persist=False,
            max_time_seconds=remaining,
            course_ids={str(row.get("id")) for row in context["courses"]},
        )
        if not result.get("success"):
            attempts.append({"attempt": attempt_number, "status": result.get("status", "infeasible"), "valid": False, "message": result.get("error")})
            continue

        assignments = result.get("assignments") or []
        validation = validate_candidate_assignments(
            assignments,
            context["courses"],
            context["faculty"],
            context["groups"],
            context["rooms"],
            context["time_slots"],
            context["availability"],
        )
        objective_value = _objective_value(assignments, context["faculty"], context["groups"], context["time_slots"])
        attempts.append({
            "attempt": attempt_number,
            "status": result.get("status"),
            "valid": validation["valid"],
            "violation_count": validation["violation_count"],
            "objective_value": objective_value,
        })
        if not validation["valid"]:
            last_invalid = {"assignments": assignments, "validation": validation}
            continue

        candidate = {
            "candidate_id": str(uuid.uuid4()),
            "academic_year": academic_year,
            "semester": semester,
            "department": department,
            "student_group": student_group,
            "base_latest_timetable_id": context["base_latest_timetable_id"],
            "assignments": assignments,
            "optimization_score": result.get("optimization_score"),
            "objective_value": objective_value,
            "generation_time_ms": result.get("generation_time_ms"),
            "validation": validation,
        }
        if best is None or objective_value < best.get("objective_value", float("inf")):
            best = candidate
        if result.get("status") == "OPTIMAL":
            break

    if best:
        comparison = _compare_payload(context, best["assignments"], best.get("optimization_score"))
        return {"success": True, **best, "attempt_count": len(attempts), "attempts": attempts, "comparison": comparison}

    return {
        "success": False,
        "error": "NO_VALID_CANDIDATE",
        "message": "No acceptable candidate was found within the configured attempt and time limits. The saved timetable is unchanged.",
        "base_latest_timetable_id": context["base_latest_timetable_id"],
        "attempt_count": len(attempts),
        "attempts": attempts,
        "validation": last_invalid.get("validation") if last_invalid else None,
        "invalid_assignments": last_invalid.get("assignments") if last_invalid else None,
    }


def accept_timetable_candidate(
    academic_year: str,
    semester: int,
    department: str | None,
    student_group: str | None,
    assignments: list[dict[str, Any]],
    base_latest_timetable_id: str | None,
    generation_time_ms: int = 0,
) -> dict[str, Any]:
    context = _scope_context(academic_year, semester, department, student_group)
    if context["base_latest_timetable_id"] != base_latest_timetable_id:
        return {"success": False, "error": "STALE_CANDIDATE", "message": "A newer timetable exists. Generate and compare a fresh candidate before accepting.", "status": 409}

    validation = validate_candidate_assignments(
        assignments,
        context["courses"],
        context["faculty"],
        context["groups"],
        context["rooms"],
        context["time_slots"],
        context["availability"],
    )
    if not validation["valid"]:
        return {"success": False, "error": "INVALID_CANDIDATE", "message": "Candidate validation failed; the saved timetable was not changed.", "status": 422, "validation": validation}

    rows = []
    seen = set()
    for assignment in assignments:
        for slot_id in assignment.get("time_slot_ids", []):
            signature = (str(assignment.get("course_id")), str(assignment.get("group_id")), str(slot_id))
            if signature in seen:
                return {"success": False, "error": "INVALID_CANDIDATE", "message": "Candidate contains a duplicate class block.", "status": 422}
            seen.add(signature)
            rows.append({
                "course_id": assignment["course_id"],
                "faculty_id": assignment["faculty_id"],
                "group_id": assignment["group_id"],
                "room_id": assignment["room_id"],
                "time_slot_id": slot_id,
                "duration_hours": assignment["duration_hours"],
            })
    if not rows:
        return {"success": False, "error": "INVALID_CANDIDATE", "message": "Candidate has no assignments.", "status": 422}

    timetable_payload = {
        "name": _pending_timetable_name(),
        "academic_year": academic_year,
        "semester": semester,
        "status": "generated",
        "optimization_score": 90.0,
        "total_conflicts": 0,
        "generation_time_ms": max(0, _int(generation_time_ms)),
    }
    timetable_record = timetable_service.supabase.insert_timetable(timetable_payload)
    timetable_id = timetable_record.get("id") if isinstance(timetable_record, dict) else None
    if not timetable_id:
        raise RuntimeError("Failed to create the accepted timetable record.")
    rows = [{"timetable_id": timetable_id, **row} for row in rows]
    inserted = timetable_service.supabase.insert_timetable_entries(rows)
    persisted_rows = timetable_service.get_timetable_entries(str(timetable_id))
    if inserted is None or len(persisted_rows) != len(rows):
        raise RuntimeError("Accepted timetable entries could not be completely persisted.")
    final_name = _timetable_name(context)
    finalized = timetable_service.supabase.update_timetable_name(str(timetable_id), final_name)
    if not finalized:
        raise RuntimeError("Accepted timetable could not be made visible after entry persistence.")
    return {
        "success": True,
        "timetable_id": timetable_id,
        "academic_year": academic_year,
        "semester": semester,
        "name": final_name,
        "optimization_score": timetable_payload["optimization_score"],
        "total_conflicts": 0,
        "entries_created": len(inserted),
        "message": "Candidate accepted as a new timetable version.",
    }
