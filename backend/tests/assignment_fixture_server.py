import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as app_module
import services.timetable_service as timetable_service_module
from services.timetable_service import timetable_service


department = {"id": "department-1", "code": "CSE-AIML", "name": "CSE-AIML"}
courses = [
    {"id": "course-1", "course_code": "CSE101", "course_name": "Existing class", "course_type": "theory", "department_id": department["id"], "semester": 3, "duration_hours": 1},
    {"id": "course-2", "course_code": "CSE102", "course_name": "Overlapping class", "course_type": "theory", "department_id": department["id"], "semester": 3, "duration_hours": 2},
    {"id": "course-3", "course_code": "CSE103", "course_name": "Adjacent class", "course_type": "theory", "department_id": department["id"], "semester": 3, "duration_hours": 1},
]
groups = [
    {"id": "group-1", "name": "CSE-AIML-Y2-S3-A", "semester": 3, "department_id": department["id"]},
    {"id": "group-2", "name": "CSE-AIML-Y2-S3-B", "semester": 3, "department_id": department["id"]},
]
rooms = [{"id": "room-1", "name": "CR-01", "room_type": "Classroom", "capacity": 60}]
time_slots = [
    {"id": "slot-mon-09", "day_of_week": 1, "start_time": "09:00:00", "end_time": "10:00:00"},
    {"id": "slot-mon-10", "day_of_week": 1, "start_time": "10:00:00", "end_time": "11:00:00"},
    {"id": "slot-mon-09-11", "day_of_week": 1, "start_time": "09:00:00", "end_time": "11:00:00"},
]
faculty = [
    {"id": "faculty-1", "name": "Dr. Ravi", "employee_code": "CSE-FAC-106", "email": "ravi@example.edu", "department_id": department["id"], "max_hours_per_week": 16},
    {"id": "faculty-2", "name": "Dr. Mehta", "employee_code": "CSE-FAC-107", "email": "mehta@example.edu", "department_id": department["id"], "max_hours_per_week": 16},
]
timetable = {"id": "fixture-timetable", "academic_year": "2026-27", "semester": 3, "status": "generated"}
entries = [
    {"id": "entry-existing", "timetable_id": timetable["id"], "course_id": "course-1", "faculty_id": "faculty-1", "group_id": "group-1", "room_id": "room-1", "time_slot_id": "slot-mon-09", "duration_hours": 1},
    {"id": "entry-overlap", "timetable_id": timetable["id"], "course_id": "course-2", "faculty_id": "faculty-2", "group_id": "group-2", "room_id": "room-1", "time_slot_id": "slot-mon-09-11", "duration_hours": 2},
    {"id": "entry-adjacent", "timetable_id": timetable["id"], "course_id": "course-3", "faculty_id": "faculty-2", "group_id": "group-2", "room_id": "room-1", "time_slot_id": "slot-mon-10", "duration_hours": 1},
]


def get_enriched_entries(timetable_id, semester=None):
    day_names = {1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday"}
    enriched = []
    for entry in entries:
        if entry["timetable_id"] != timetable_id:
            continue
        course = next(row for row in courses if row["id"] == entry["course_id"])
        member = next((row for row in faculty if row["id"] == entry["faculty_id"]), None)
        group = next(row for row in groups if row["id"] == entry["group_id"])
        room = next(row for row in rooms if row["id"] == entry["room_id"])
        slot = next(row for row in time_slots if row["id"] == entry["time_slot_id"])
        enriched.append({
            **entry,
            "course": {"course_code": course["course_code"], "course_name": course["course_name"]},
            "faculty": {"name": member["name"], "employee_code": member["employee_code"]} if member else None,
            "group": {"name": group["name"], "student_count": 50},
            "room": room,
            "time_slot": {
                "day_of_week": slot["day_of_week"],
                "day_name": day_names[slot["day_of_week"]],
                "start_time": slot["start_time"],
                "end_time": slot["end_time"],
            },
        })
    return enriched


def insert_faculty(payload):
    record = {"id": f"faculty-{len(faculty) + 1}", **payload}
    faculty.append(record)
    return record


def update_course_faculty(timetable_id, course_id, faculty_id):
    changed = []
    for entry in entries:
        if entry["timetable_id"] == timetable_id and entry["course_id"] == course_id:
            entry["faculty_id"] = faculty_id
            changed.append(dict(entry))
    return changed


def update_entry_faculty(timetable_id, entry_id, faculty_id):
    entry = next((row for row in entries if row["timetable_id"] == timetable_id and row["id"] == entry_id), None)
    if entry is None:
        return []
    entry["faculty_id"] = faculty_id
    return [dict(entry)]


def install_fixture():
    app_module.HAS_SUPABASE_CONFIG = True
    timetable_service_module.HAS_SUPABASE_CONFIG = True
    timetable_service.get_departments = lambda: [department]
    timetable_service.get_courses = lambda semester=None: [row for row in courses if semester is None or row["semester"] == semester]
    timetable_service.get_faculty = lambda: faculty
    timetable_service.get_student_groups = lambda semester=None, department=None: groups
    timetable_service.get_rooms = lambda: rooms
    timetable_service.get_time_slots = lambda: time_slots
    timetable_service.get_faculty_availability = lambda: []
    timetable_service.get_timetable = lambda timetable_id: [timetable] if timetable_id == timetable["id"] else []
    timetable_service.get_timetables = lambda academic_year=None, semester=None: [timetable]
    timetable_service.get_timetable_entries = lambda timetable_id=None: [
        dict(row) for row in entries if timetable_id is None or row["timetable_id"] == timetable_id
    ]
    timetable_service.get_enriched_timetable_entries = get_enriched_entries
    timetable_service.build_timetable_summary = lambda semester=None: {
        "success": True,
        "semester": semester,
        "summary": {"courses": len(courses), "faculty": len(faculty), "student_groups": len(groups), "rooms": len(rooms), "time_slots": len(time_slots), "availability_records": 0},
    }
    timetable_service.insert_faculty = insert_faculty
    timetable_service.delete_faculty = lambda faculty_id: faculty.remove(next(row for row in faculty if row["id"] == faculty_id))
    timetable_service.supabase.update_timetable_entries_faculty = update_course_faculty
    timetable_service.supabase.update_timetable_entry_faculty = update_entry_faculty


if __name__ == "__main__":
    install_fixture()
    app_module.app.run(host="127.0.0.1", port=5001, use_reloader=False)