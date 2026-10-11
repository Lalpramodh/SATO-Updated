import pytest

from optimizer.validation import persisted_entries_to_assignments, validate_candidate_assignments


SLOTS = [
    {"id": "mon-09", "day_of_week": 1, "start_time": "09:00:00", "end_time": "10:00:00"},
    {"id": "mon-10", "day_of_week": 1, "start_time": "10:00:00", "end_time": "11:00:00"},
    {"id": "mon-11", "day_of_week": 1, "start_time": "11:00:00", "end_time": "12:00:00"},
    {"id": "tue-09", "day_of_week": 2, "start_time": "09:00:00", "end_time": "10:00:00"},
]
COURSES = [
    {"id": "course-1", "course_code": "CSE101", "course_name": "Theory", "department_id": "dept-1", "course_type": "theory", "sessions_per_week": 1, "duration_hours": 1},
    {"id": "course-2", "course_code": "CSE102", "course_name": "Second theory", "department_id": "dept-1", "course_type": "theory", "sessions_per_week": 1, "duration_hours": 1},
]
FACULTY = [
    {"id": "faculty-1", "name": "Dr. Ravi", "department_id": "dept-1"},
    {"id": "faculty-2", "name": "Dr. Mehta", "department_id": "dept-1"},
]
GROUPS = [
    {"id": "group-1", "name": "CSE-AIML-Y2-S3-A", "department_id": "dept-1", "student_count": 50},
    {"id": "group-2", "name": "CSE-AIML-Y2-S3-B", "department_id": "dept-1", "student_count": 40},
]
ROOMS = [
    {"id": "room-1", "name": "CR-01", "room_type": "classroom", "capacity": 60},
    {"id": "room-2", "name": "LAB-01", "room_type": "lab", "capacity": 60},
    {"id": "room-small", "name": "CR-SMALL", "room_type": "classroom", "capacity": 30},
]
VALID_ASSIGNMENTS = [
    {"course_id": "course-1", "faculty_id": "faculty-1", "group_id": "group-1", "room_id": "room-1", "time_slot_ids": ["mon-09"], "duration_hours": 1},
    {"course_id": "course-2", "faculty_id": "faculty-2", "group_id": "group-2", "room_id": "room-1", "time_slot_ids": ["mon-10"], "duration_hours": 1},
]


def validate(assignments, *, courses=COURSES, faculty=FACULTY, groups=GROUPS, rooms=ROOMS, availability=()):
    return validate_candidate_assignments(assignments, courses, faculty, groups, rooms, SLOTS, list(availability))


def test_valid_candidate_passes_independent_validation():
    result = validate(VALID_ASSIGNMENTS)
    assert result == {"valid": True, "violation_count": 0, "violations": []}


def test_candidate_rejects_faculty_overlap():
    assignments = [dict(VALID_ASSIGNMENTS[0]), {**VALID_ASSIGNMENTS[1], "faculty_id": "faculty-1", "room_id": "room-2", "time_slot_ids": ["mon-09"]}]
    result = validate(assignments)
    violation = next(item for item in result["violations"] if item["code"] == "faculty_overlap")
    assert violation["requested_time"] == "09:00-10:00"
    assert violation["conflicting_time"] == "09:00-10:00"
    assert violation["resource"] == "Dr. Ravi"
    assert violation["day"] == "Monday"


def test_candidate_rejects_student_group_overlap():
    assignments = [dict(VALID_ASSIGNMENTS[0]), {**VALID_ASSIGNMENTS[1], "group_id": "group-1", "room_id": "room-2", "time_slot_ids": ["mon-09"]}]
    result = validate(assignments)
    assert "group_overlap" in {item["code"] for item in result["violations"]}


def test_candidate_rejects_room_overlap():
    assignments = [dict(VALID_ASSIGNMENTS[0]), {**VALID_ASSIGNMENTS[1], "faculty_id": "faculty-2", "group_id": "group-2", "time_slot_ids": ["mon-09"]}]
    result = validate(assignments)
    assert "room_overlap" in {item["code"] for item in result["violations"]}


def test_candidate_rejects_unavailable_faculty():
    result = validate(VALID_ASSIGNMENTS, availability=[{"faculty_id": "faculty-1", "time_slot_id": "mon-09", "available": False}])
    assert "faculty_unavailable" in {item["code"] for item in result["violations"]}


def test_candidate_rejects_insufficient_room_capacity():
    assignments = [{**VALID_ASSIGNMENTS[0], "room_id": "room-small"}, dict(VALID_ASSIGNMENTS[1])]
    result = validate(assignments)
    assert "room_capacity" in {item["code"] for item in result["violations"]}


def test_candidate_rejects_incompatible_room_type():
    lab_course = {"id": "lab-course", "course_code": "CSL101", "course_name": "Lab", "department_id": "dept-1", "course_type": "lab", "sessions_per_week": 1, "duration_hours": 1}
    assignments = [dict(VALID_ASSIGNMENTS[0]), {**VALID_ASSIGNMENTS[1], "course_id": "lab-course", "room_id": "room-1"}]
    result = validate(assignments, courses=[*COURSES, lab_course])
    assert "room_type_mismatch" in {item["code"] for item in result["violations"]}


def test_candidate_rejects_invalid_duration_and_session_count():
    two_hour_course = {**COURSES[0], "duration_hours": 2}
    assignments = [{**VALID_ASSIGNMENTS[0], "duration_hours": 2, "time_slot_ids": ["mon-09"]}, dict(VALID_ASSIGNMENTS[1])]
    result = validate(assignments, courses=[two_hour_course, COURSES[1]])
    codes = {item["code"] for item in result["violations"]}
    assert "invalid_duration" in codes
    assert "invalid_duration_block" in codes
    assert "session_count" not in codes
    missing = validate([dict(VALID_ASSIGNMENTS[0])])
    assert "session_count" in {item["code"] for item in missing["violations"]}


def test_candidate_rejects_invalid_references():
    assignments = [{**VALID_ASSIGNMENTS[0], "room_id": "missing-room"}, dict(VALID_ASSIGNMENTS[1])]
    result = validate(assignments)
    assert "invalid_reference" in {item["code"] for item in result["violations"]}


def test_persisted_two_hour_rows_are_collapsed_to_one_session():
    rows = [
        {"course_id": "course-1", "faculty_id": "faculty-1", "group_id": "group-1", "room_id": "room-1", "time_slot_id": "mon-09", "duration_hours": 2},
        {"course_id": "course-1", "faculty_id": "faculty-1", "group_id": "group-1", "room_id": "room-1", "time_slot_id": "mon-10", "duration_hours": 2},
    ]
    result = persisted_entries_to_assignments(rows, SLOTS)
    assert len(result) == 1
    assert result[0]["time_slot_ids"] == ["mon-09", "mon-10"]
    assert result[0]["duration_hours"] == 2
