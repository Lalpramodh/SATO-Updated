from services.timetable_service import timetable_service


def test_validate_faculty_assignment_conflict_detects_overlap():
    timetable_id = "timetable-1"
    time_slots = [
        {"id": "slot-1", "day_of_week": 1, "start_time": "09:00:00", "end_time": "10:00:00"},
        {"id": "slot-2", "day_of_week": 1, "start_time": "10:00:00", "end_time": "11:00:00"},
        {"id": "slot-3", "day_of_week": 2, "start_time": "09:00:00", "end_time": "10:00:00"},
    ]
    existing_entries = [
        {"id": "entry-1", "faculty_id": "faculty-1", "course_id": "course-1", "timetable_id": timetable_id, "time_slot_id": "slot-1", "duration_hours": 1},
        {"id": "entry-2", "faculty_id": "faculty-2", "course_id": "course-2", "timetable_id": timetable_id, "time_slot_id": "slot-2", "duration_hours": 1},
    ]

    result = timetable_service.validate_faculty_assignment_conflict(
        faculty_id="faculty-1",
        timetable_id=timetable_id,
        candidate_slot_ids=["slot-1"],
        target_course_id="course-3",
        existing_entries=existing_entries,
        time_slots=time_slots,
    )

    assert result is not None
    assert result["error"] == "FACULTY_SCHEDULING_CONFLICT"
    assert result["details"]["faculty"] == "faculty-1"


def test_get_previous_timetable_for_scope_uses_latest_earlier_record(monkeypatch):
    timetable_current = {"id": "current", "academic_year": "2026-27", "semester": 3, "created_at": "2026-10-11T09:00:00Z"}
    timetable_previous = {"id": "previous", "academic_year": "2026-27", "semester": 3, "created_at": "2026-10-10T09:00:00Z"}
    timetable_other = {"id": "other", "academic_year": "2025-26", "semester": 3, "created_at": "2026-10-09T09:00:00Z"}

    monkeypatch.setattr(timetable_service, "get_timetables", lambda academic_year=None, semester=None: [timetable_current, timetable_previous, timetable_other])
    monkeypatch.setattr(timetable_service, "get_timetable_entries", lambda timetable_id=None: [
        {"id": "e1", "course_id": "course-1", "faculty_id": "faculty-1", "timetable_id": timetable_id, "time_slot_id": "slot-1"},
    ])

    result = timetable_service.get_previous_timetable_for_scope("2026-27", 3, current_timetable_id="current")

    assert result is not None
    assert result["timetable"]["id"] == "previous"
    assert result["entries"][0]["timetable_id"] == "previous"
