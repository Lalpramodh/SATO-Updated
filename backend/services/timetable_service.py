import logging
from typing import Any

from config import HAS_SUPABASE_CONFIG
from services.supabase_service import supabase_service

logger = logging.getLogger(__name__)

SUPPORTED_DEPARTMENTS = ("CSE-AIML", "CSE-DS", "CSE-CYBER")
SUPPORTED_GROUP_CODES = (
    "CSE-AIML-Y2-S3-A",
    "CSE-AIML-Y2-S3-B",
    "CSE-DS-Y2-S3-A",
    "CSE-CYBER-Y2-S3-A",
)


def _normalize_value(value: Any) -> str:
    return str(value or "").strip()


def is_supported_semester(semester: Any) -> bool:
    try:
        return int(semester) == 3
    except (TypeError, ValueError):
        return False


def filter_supported_departments(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not rows:
        return []
    return [
        row for row in rows
        if _normalize_value(row.get("code")) in SUPPORTED_DEPARTMENTS
        or _normalize_value(row.get("short_name")) in SUPPORTED_DEPARTMENTS
        or _normalize_value(row.get("name")) in SUPPORTED_DEPARTMENTS
    ]


def filter_supported_student_groups(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not rows:
        return []
    return [
        row for row in rows
        if _normalize_value(row.get("name")) in SUPPORTED_GROUP_CODES
        or _normalize_value(row.get("code")) in SUPPORTED_GROUP_CODES
    ]


class TimetableService:
    def __init__(self):
        self.supabase = supabase_service

    def get_departments(self):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        return filter_supported_departments(self.supabase.get_departments())

    def get_courses(self, semester: int | None = None):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        if semester is not None and not is_supported_semester(semester):
            return []
        rows = self.supabase.get_courses(semester)
        allowed_department_ids = {str(item.get("id")) for item in self.get_departments()}
        filtered = []
        for course in rows:
            if not is_supported_semester(course.get("semester")) and semester is None:
                continue
            department_id = _normalize_value(course.get("department_id"))
            department_name = _normalize_value(course.get("department_name"))
            department_code = _normalize_value(course.get("department_code"))
            if department_id and department_id not in allowed_department_ids:
                continue
            if department_name and department_name not in SUPPORTED_DEPARTMENTS:
                continue
            if department_code and department_code not in SUPPORTED_DEPARTMENTS:
                continue
            filtered.append(course)
        return filtered

    def get_faculty(self):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        departments = self.get_departments()
        allowed_department_ids = {str(item.get("id")) for item in departments}
        rows = self.supabase.get_faculty()
        filtered = []
        for faculty in rows:
            department_id = _normalize_value(faculty.get("department_id"))
            department_name = _normalize_value(faculty.get("department_name"))
            department_code = _normalize_value(faculty.get("department_code"))
            if department_id and department_id in allowed_department_ids:
                filtered.append(faculty)
                continue
            if department_name in SUPPORTED_DEPARTMENTS or department_code in SUPPORTED_DEPARTMENTS:
                filtered.append(faculty)
        return filtered

    def insert_faculty(self, payload: dict[str, Any]):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        return self.supabase.insert_faculty(payload)

    def validate_faculty_assignment_conflict(
        self,
        faculty_id: str | int,
        timetable_id: str | None = None,
        candidate_slot_ids: list[str] | None = None,
        target_course_id: str | None = None,
        existing_entries: list[dict[str, Any]] | None = None,
        time_slots: list[dict[str, Any]] | None = None,
        faculty_name: str | None = None,
        candidate_duration_hours: int = 1,
        exclude_entry_id: str | None = None,
    ) -> dict[str, Any] | None:
        if faculty_id in (None, '') or not candidate_slot_ids:
            return None

        if existing_entries is None:
            try:
                existing_entries = self.get_timetable_entries(timetable_id) if timetable_id else self.get_timetable_entries()
            except RuntimeError:
                existing_entries = []
        if time_slots is None:
            try:
                time_slots = self.get_time_slots()
            except RuntimeError:
                time_slots = []

        slot_map = {str(slot.get("id")): slot for slot in time_slots if slot.get("id") is not None}
        try:
            course_lookup = {str(item.get("id")): item for item in self.get_courses()}
        except RuntimeError:
            course_lookup = {}
        day_names = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday"}

        for candidate_slot_id in candidate_slot_ids:
            candidate_slot = slot_map.get(str(candidate_slot_id))
            if candidate_slot is None:
                continue
            for entry in existing_entries:
                if str(entry.get("id")) == str(exclude_entry_id):
                    continue
                if str(entry.get("faculty_id")) != str(faculty_id):
                    continue
                if target_course_id is not None and str(entry.get("course_id")) == str(target_course_id):
                    continue

                occupied_slot = slot_map.get(str(entry.get("time_slot_id")))
                if occupied_slot is None:
                    continue

                duration = max(1, int(entry.get("duration_hours") or candidate_duration_hours or 1))
                candidate_duration = max(1, int(candidate_duration_hours or 1))
                if self._time_slots_overlap(
                    candidate_slot,
                    {"duration_hours": candidate_duration},
                    occupied_slot,
                    {"duration_hours": duration},
                ):
                    conflicting_course = course_lookup.get(str(entry.get("course_id"))) or {}
                    requested_day_name = day_names.get(int(candidate_slot.get("day_of_week") or 0), "Unknown")
                    requested_start = str(candidate_slot.get("start_time") or "00:00")[:5]
                    requested_end = str(candidate_slot.get("end_time") or "00:00")[:5]
                    conflicting_slot_start = str(occupied_slot.get("start_time") or "00:00")[:5]
                    conflicting_slot_end = str(occupied_slot.get("end_time") or "00:00")[:5]
                    return {
                        "error": "FACULTY_SCHEDULING_CONFLICT",
                        "message": "This faculty member is already assigned to another class during this time slot. Please select a different faculty member or time slot.",
                        "details": {
                            "faculty": faculty_name or str(faculty_id),
                            "day": requested_day_name,
                            "requested_time": f"{requested_start}-{requested_end}",
                            "conflicting_course": conflicting_course.get("course_name") or conflicting_course.get("course_code") or "Assigned course",
                            "conflicting_time": f"{conflicting_slot_start}-{conflicting_slot_end}",
                        },
                    }
        return None

    def assign_faculty_to_selected_course(self, faculty: dict[str, Any], semester: int, course_id: str):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")

        faculty_id = faculty.get("id")
        department_id = faculty.get("department_id")
        if not faculty_id or not department_id:
            return {"assigned": False, "message": "Faculty added successfully, but no conflict-free timetable assignment was available."}

        existing_assignments = [
            entry for entry in self.get_timetable_entries()
            if str(entry.get("faculty_id")) == str(faculty_id)
        ]
        if existing_assignments:
            return {
                "assigned": False,
                "message": "Faculty added successfully, but this faculty already has a timetable subject assignment.",
            }
        courses = self.get_courses(semester)
        course = next((item for item in courses if str(item.get("id")) == str(course_id)), None)
        if not course or str(course.get("department_id")) != str(department_id):
            return {"assigned": False, "message": "The selected subject does not belong to the selected department and semester."}

        timetables = self.get_timetables("2026-27", semester)
        if not timetables:
            return {"assigned": False, "message": "No existing timetable is available for the selected semester."}

        timetable = timetables[0]
        timetable_id = timetable.get("id")
        entries = self.get_timetable_entries(timetable_id) if timetable_id else []
        course_entries = [entry for entry in entries if str(entry.get("course_id")) == str(course_id)]
        if not course_entries:
            return {"assigned": False, "message": "The selected subject has no occurrences in the selected timetable."}

        time_slots = self.get_time_slots()
        availability = [row for row in self.get_faculty_availability() if str(row.get("faculty_id")) == str(faculty_id)]
        slots = {str(slot.get("id")): slot for slot in time_slots}
        available_slots = {str(row.get("time_slot_id")) for row in availability if row.get("available") is True}
        if any(not slots.get(str(entry.get("time_slot_id"))) for entry in course_entries):
            return {"assigned": False, "message": "The selected subject has an invalid timetable slot."}
        if availability and any(str(entry.get("time_slot_id")) not in available_slots for entry in course_entries):
            return {"assigned": False, "message": "Faculty cannot be assigned to this subject because of a timetable conflict."}

        occupied = [entry for entry in entries if str(entry.get("faculty_id")) == str(faculty_id)]
        for candidate in course_entries:
            conflict = self.validate_faculty_assignment_conflict(
                faculty_id=faculty_id,
                timetable_id=timetable_id,
                candidate_slot_ids=[str(candidate.get("time_slot_id"))],
                target_course_id=str(course_id),
                existing_entries=entries,
                time_slots=time_slots,
                faculty_name=faculty.get("name"),
                candidate_duration_hours=int(candidate.get("duration_hours") or 1),
                exclude_entry_id=None,
            )
            if conflict:
                return {
                    "assigned": False,
                    "error": conflict["error"],
                    "message": conflict["message"],
                    "details": conflict["details"],
                }

        entry_ids = [entry["id"] for entry in course_entries]
        updated = self.supabase.update_timetable_entries_faculty(timetable_id, str(course_id), str(faculty_id))
        return {
            "assigned": True,
            "timetable_id": timetable_id,
            "course_id": str(course_id),
            "timetable_entry_ids": entry_ids,
            "faculty": updated,
            "message": "Faculty added successfully",
        }

    @staticmethod
    def _time_slots_overlap(left_slot: dict[str, Any] | None, left_entry: dict[str, Any], right_slot: dict[str, Any] | None, right_entry: dict[str, Any]):
        if not left_slot or not right_slot or left_slot.get("day_of_week") != right_slot.get("day_of_week"):
            return False

        def to_minutes(value):
            hours, minutes, *_ = str(value or "").split(":")
            return int(hours) * 60 + int(minutes)

        left_start = to_minutes(left_slot.get("start_time"))
        left_end = to_minutes(left_slot.get("end_time"))
        right_start = to_minutes(right_slot.get("start_time"))
        right_end = to_minutes(right_slot.get("end_time"))
        left_duration = max(1, int(left_entry.get("duration_hours") or 1)) * 60
        right_duration = max(1, int(right_entry.get("duration_hours") or 1)) * 60
        left_end = max(left_end, left_start + left_duration)
        right_end = max(right_end, right_start + right_duration)
        return left_start < right_end and right_start < left_end

    def get_student_groups(self, semester: int | None = None, department: str | None = None):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        if semester is not None and not is_supported_semester(semester):
            return []

        groups = self.supabase.get_student_groups(semester)
        if semester is None:
            groups = [group for group in groups if is_supported_semester(group.get("semester"))]
        groups = filter_supported_student_groups(groups)
        if not department:
            return groups
        departments = self.get_departments()
        department_row = next((item for item in departments if department in {item.get("code"), item.get("short_name"), item.get("name"), str(item.get("id"))}), None)
        if not department_row:
            raise ValueError(f"Unknown department: {department}.")
        return [group for group in groups if str(group.get("department_id")) == str(department_row.get("id"))]

    def get_rooms(self):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        return self.supabase.get_rooms()

    def get_time_slots(self):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        return self.supabase.get_time_slots()

    def get_faculty_availability(self):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        return self.supabase.get_faculty_availability()

    def get_timetable(self, timetable_id: str):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        return self.supabase.get_timetable(timetable_id)

    def get_timetables(self, academic_year: str | None = None, semester: int | None = None):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        query = self.supabase.client.table("timetables").select("*") if self.supabase.client else None
        if query is None:
            raise RuntimeError("Supabase is not configured.")
        if academic_year is not None:
            query = query.filter("academic_year", "eq", academic_year)
        if semester is not None:
            query = query.filter("semester", "eq", semester)
        response = query.order("created_at", desc=True).execute()
        return response.data if hasattr(response, "data") else response

    def get_timetable_entries(self, timetable_id: str | None = None):
        if not HAS_SUPABASE_CONFIG:
            raise RuntimeError("Supabase is not configured.")
        return self.supabase.get_timetable_entries(timetable_id)

    def get_enriched_timetable_entries(self, timetable_id: str, semester: int | None = None):
        entries = self.get_timetable_entries(timetable_id)
        courses = self.get_courses(semester)
        departments = self.get_departments()
        faculty = self.get_faculty()
        groups = self.get_student_groups(semester)
        rooms = self.get_rooms()
        time_slots = self.get_time_slots()

        course_map = {str(item.get("id")): item for item in courses}
        department_map = {str(item.get("id")): item for item in departments}
        faculty_map = {str(item.get("id")): item for item in faculty}
        group_map = {str(item.get("id")): item for item in groups}
        room_map = {str(item.get("id")): item for item in rooms}
        time_slot_map = {str(item.get("id")): item for item in time_slots}
        day_names = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday"}

        enriched = []
        for entry in entries:
            course = course_map.get(str(entry.get("course_id")))
            department = department_map.get(str(course.get("department_id"))) if course else None
            faculty_member = faculty_map.get(str(entry.get("faculty_id")))
            group = group_map.get(str(entry.get("group_id")))
            room = room_map.get(str(entry.get("room_id")))
            time_slot = time_slot_map.get(str(entry.get("time_slot_id")))
            enriched_entry = dict(entry)
            enriched_entry["course"] = ({
                "course_code": course.get("course_code"),
                "course_name": course.get("course_name"),
                "course_type": course.get("course_type"),
                "course_category": course.get("course_category"),
                "semester": course.get("semester"),
                "department_id": course.get("department_id"),
                "department_code": department.get("code") or department.get("short_name") if department else None,
                "department_name": department.get("name") if department else None,
            } if course else None)
            enriched_entry["faculty"] = ({
                "name": faculty_member.get("name"),
                "employee_code": faculty_member.get("employee_code"),
            } if faculty_member else None)
            enriched_entry["group"] = ({
                "name": group.get("name"),
                "student_count": group.get("student_count"),
            } if group else None)
            enriched_entry["room"] = ({
                "name": room.get("name"),
                "room_type": room.get("room_type"),
                "capacity": room.get("capacity"),
                "building": room.get("building"),
                "floor": room.get("floor"),
            } if room else None)
            enriched_entry["time_slot"] = ({
                "day_of_week": time_slot.get("day_of_week"),
                "day_name": day_names.get(time_slot.get("day_of_week")),
                "start_time": time_slot.get("start_time"),
                "end_time": time_slot.get("end_time"),
            } if time_slot else None)
            enriched.append(enriched_entry)
        return enriched

    def build_timetable_summary(self, semester: int | None = None) -> dict[str, Any]:
        courses = self.get_courses(semester)
        faculty = self.get_faculty()
        groups = self.get_student_groups(semester)
        rooms = self.get_rooms()
        time_slots = self.get_time_slots()
        availability = self.get_faculty_availability()

        return {
            "success": True,
            "semester": semester,
            "summary": {
                "courses": len(courses),
                "faculty": len(faculty),
                "student_groups": len(groups),
                "rooms": len(rooms),
                "time_slots": len(time_slots),
                "availability_records": len(availability),
            },
        }


timetable_service = TimetableService()
