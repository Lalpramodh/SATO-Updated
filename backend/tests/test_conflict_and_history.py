from services.timetable_service import timetable_service


def _slots():
    return [
        {"id": "slot-mon-09", "day_of_week": 1, "start_time": "09:00:00", "end_time": "10:00:00"},
        {"id": "slot-mon-10", "day_of_week": 1, "start_time": "10:00:00", "end_time": "11:00:00"},
        {"id": "slot-mon-09-11", "day_of_week": 1, "start_time": "09:00:00", "end_time": "11:00:00"},
        {"id": "slot-tue-09", "day_of_week": 2, "start_time": "09:00:00", "end_time": "10:00:00"},
    ]


def test_validate_faculty_assignment_conflict_detects_same_slot_overlap():
    timetable_id = "timetable-1"
    existing_entries = [
        {"id": "entry-1", "faculty_id": "faculty-1", "course_id": "course-1", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09", "duration_hours": 1},
    ]

    result = timetable_service.validate_faculty_assignment_conflict(
        faculty_id="faculty-1",
        timetable_id=timetable_id,
        candidate_slot_ids=["slot-mon-09"],
        target_course_id="course-3",
        existing_entries=existing_entries,
        time_slots=_slots(),
        faculty_name="Dr. Ravi",
        candidate_duration_hours=1,
    )

    assert result is not None
    assert result["error"] == "FACULTY_SCHEDULING_CONFLICT"
    assert result["details"]["faculty"] == "Dr. Ravi"
    assert result["details"]["day"] == "Monday"


def test_validate_faculty_assignment_conflict_allows_adjacent_slots():
    timetable_id = "timetable-1"
    existing_entries = [
        {"id": "entry-1", "faculty_id": "faculty-1", "course_id": "course-1", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09", "duration_hours": 1},
    ]

    result = timetable_service.validate_faculty_assignment_conflict(
        faculty_id="faculty-1",
        timetable_id=timetable_id,
        candidate_slot_ids=["slot-mon-10"],
        target_course_id="course-3",
        existing_entries=existing_entries,
        time_slots=_slots(),
        faculty_name="Dr. Ravi",
        candidate_duration_hours=1,
    )

    assert result is None


def test_validate_faculty_assignment_conflict_allows_different_days():
    timetable_id = "timetable-1"
    existing_entries = [
        {"id": "entry-1", "faculty_id": "faculty-1", "course_id": "course-1", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09", "duration_hours": 1},
    ]

    result = timetable_service.validate_faculty_assignment_conflict(
        faculty_id="faculty-1",
        timetable_id=timetable_id,
        candidate_slot_ids=["slot-tue-09"],
        target_course_id="course-3",
        existing_entries=existing_entries,
        time_slots=_slots(),
        faculty_name="Dr. Ravi",
        candidate_duration_hours=1,
    )

    assert result is None


def test_validate_faculty_assignment_conflict_detects_two_hour_overlap():
    timetable_id = "timetable-1"
    existing_entries = [
        {"id": "entry-1", "faculty_id": "faculty-1", "course_id": "course-1", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09-11", "duration_hours": 2},
    ]

    result = timetable_service.validate_faculty_assignment_conflict(
        faculty_id="faculty-1",
        timetable_id=timetable_id,
        candidate_slot_ids=["slot-mon-10"],
        target_course_id="course-3",
        existing_entries=existing_entries,
        time_slots=_slots(),
        faculty_name="Dr. Ravi",
        candidate_duration_hours=1,
    )

    assert result is not None
    assert result["error"] == "FACULTY_SCHEDULING_CONFLICT"


def test_validate_faculty_assignment_conflict_excludes_current_assignment_when_editing():
    timetable_id = "timetable-1"
    existing_entries = [
        {"id": "entry-1", "faculty_id": "faculty-1", "course_id": "course-1", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09", "duration_hours": 1},
    ]

    result = timetable_service.validate_faculty_assignment_conflict(
        faculty_id="faculty-1",
        timetable_id=timetable_id,
        candidate_slot_ids=["slot-mon-09"],
        target_course_id="course-1",
        existing_entries=existing_entries,
        time_slots=_slots(),
        faculty_name="Dr. Ravi",
        candidate_duration_hours=1,
        exclude_entry_id="entry-1",
    )

    assert result is None
