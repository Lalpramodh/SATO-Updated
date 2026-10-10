from __future__ import annotations

from typing import Any


def normalize_course(course: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(course)
    normalized["sessions_per_week"] = int(normalized.get("sessions_per_week") or 1)
    normalized["duration_hours"] = int(normalized.get("duration_hours") or 1)
    return normalized


def build_course_map(courses: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(course.get("id")): normalize_course(course) for course in courses if course.get("id") is not None}


def match_faculty_by_department(course: dict[str, Any], faculty_members: list[dict[str, Any]]) -> list[dict[str, Any]]:
    course_dept = course.get("department_id")
    course_dept_name = (course.get("department_name") or "").strip().lower()
    course_name = (course.get("course_name") or course.get("name") or "").strip().lower()

    matches: list[dict[str, Any]] = []
    for faculty in faculty_members:
        faculty_dept = faculty.get("department_id")
        faculty_name = (faculty.get("department_name") or "").strip().lower()
        if course_dept is not None and faculty_dept == course_dept:
            matches.append(faculty)
            continue
        if faculty_name and course_dept_name and faculty_name == course_dept_name:
            matches.append(faculty)
            continue
        if course_name and faculty_name and course_name.startswith(faculty_name):
            matches.append(faculty)
    return sorted(matches, key=lambda item: str(item.get("name") or item.get("id")))


def match_groups_for_course(course: dict[str, Any], groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    course_dept = course.get("department_id")
    course_dept_name = (course.get("department_name") or "").strip().lower()
    course_semester = course.get("semester")

    matches: list[dict[str, Any]] = []
    for group in groups:
        group_dept = group.get("department_id")
        group_dept_name = (group.get("department_name") or "").strip().lower()
        group_semester = group.get("semester")
        if course_semester is not None and group_semester is not None and int(group_semester) != int(course_semester):
            continue
        if course_dept is not None and group_dept == course_dept:
            matches.append(group)
            continue
        if group_dept_name and course_dept_name and group_dept_name == course_dept_name:
            matches.append(group)
    return sorted(matches, key=lambda item: str(item.get("name") or item.get("id")))


def room_matches_course(course: dict[str, Any], room: dict[str, Any]) -> bool:
    room_type = str(room.get("room_type") or "").strip().lower()
    course_type = str(course.get("course_type") or "").strip().lower()
    course_room_type = str(course.get("room_type") or "").strip().lower()

    if course_type == "lab" and room_type != "lab":
        return False
    if course_room_type and course_room_type != "" and room_type != "" and course_room_type != room_type:
        return False
    return True


def room_capacity_is_valid(course: dict[str, Any], room: dict[str, Any], group: dict[str, Any]) -> bool:
    room_capacity = int(room.get("capacity") or 0)
    group_count = int(group.get("student_count") or 0)
    if room_capacity <= 0:
        return False
    return room_capacity >= group_count
