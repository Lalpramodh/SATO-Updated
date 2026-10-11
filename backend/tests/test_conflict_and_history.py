from services.timetable_service import timetable_service
from app import app
import app as app_module
import services.timetable_service as timetable_service_module


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


def test_faculty_create_route_rejects_overlap_and_rolls_back_new_faculty(monkeypatch):
    timetable_id = "timetable-1"
    existing_entries = [
        {"id": "entry-existing", "faculty_id": "faculty-1", "course_id": "course-1", "group_id": "group-1", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09", "duration_hours": 1},
        {"id": "entry-requested", "faculty_id": None, "course_id": "course-2", "group_id": "group-2", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09-11", "duration_hours": 2},
    ]
    deleted_faculty = []
    updated_entries = []

    monkeypatch.setattr(timetable_service_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(timetable_service, "insert_faculty", lambda payload: {"id": "faculty-1", **payload})
    monkeypatch.setattr(timetable_service, "delete_faculty", deleted_faculty.append)
    monkeypatch.setattr(timetable_service, "get_timetable_entries", lambda timetable_id=None: existing_entries)
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: [
        {"id": "course-1", "course_code": "CSE101", "course_name": "Existing course", "department_id": "department-1"},
        {"id": "course-2", "course_code": "CSE102", "course_name": "Requested course", "department_id": "department-1"},
    ])
    monkeypatch.setattr(timetable_service, "get_student_groups", lambda semester=None: [
        {"id": "group-1", "name": "CSE-AIML-Y2-S3-A"},
        {"id": "group-2", "name": "CSE-AIML-Y2-S3-B"},
    ])
    monkeypatch.setattr(timetable_service, "get_timetables", lambda academic_year=None, semester=None: [{"id": timetable_id}])
    monkeypatch.setattr(timetable_service, "get_time_slots", _slots)
    monkeypatch.setattr(timetable_service, "get_faculty_availability", lambda: [])
    monkeypatch.setattr(timetable_service.supabase, "update_timetable_entries_faculty", lambda *args: updated_entries.append(args))

    with app.test_client() as client:
        response = client.post("/api/faculty", json={
            "employee_code": "CSE-FAC-106",
            "name": "Dr. Ravi",
            "email": "ravi@example.edu",
            "department_id": "department-1",
            "semester": 3,
            "course_id": "course-2",
            "max_hours_per_week": 16,
        })

    assert response.status_code == 409
    payload = response.get_json()
    assert payload["error"] == "FACULTY_SCHEDULING_CONFLICT"
    assert payload["details"] == {
        "faculty": "Dr. Ravi",
        "faculty_employee_code": "CSE-FAC-106",
        "day": "Monday",
        "requested_course": "CSE102 - Requested course (CSE-AIML-Y2-S3-B)",
        "requested_class": "CSE102 - Requested course (CSE-AIML-Y2-S3-B)",
        "requested_time": "09:00-11:00",
        "conflicting_course": "CSE101 - Existing course (CSE-AIML-Y2-S3-A)",
        "conflicting_class": "CSE101 - Existing course (CSE-AIML-Y2-S3-A)",
        "conflicting_time": "09:00-10:00",
    }
    assert not updated_entries
    assert deleted_faculty == ["faculty-1"]


def test_existing_faculty_second_assignment_is_rejected_before_update(monkeypatch):
    timetable_id = "timetable-1"
    entries = [
        {"id": "entry-existing", "faculty_id": "faculty-1", "course_id": "course-1", "group_id": "group-1", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09", "duration_hours": 1},
        {"id": "entry-requested", "faculty_id": None, "course_id": "course-2", "group_id": "group-2", "timetable_id": timetable_id, "time_slot_id": "slot-mon-09-11", "duration_hours": 2},
    ]
    updated_entries = []

    monkeypatch.setattr(timetable_service_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: [
        {"id": "course-1", "course_code": "CSE101", "course_name": "Existing course", "department_id": "department-1"},
        {"id": "course-2", "course_code": "CSE102", "course_name": "Requested course", "department_id": "department-1"},
    ])
    monkeypatch.setattr(timetable_service, "get_timetables", lambda academic_year=None, semester=None: [{"id": timetable_id}])
    monkeypatch.setattr(timetable_service, "get_timetable_entries", lambda timetable_id=None: entries)
    monkeypatch.setattr(timetable_service, "get_time_slots", _slots)
    monkeypatch.setattr(timetable_service, "get_faculty_availability", lambda: [])
    monkeypatch.setattr(timetable_service, "get_student_groups", lambda semester=None: [
        {"id": "group-1", "name": "CSE-AIML-Y2-S3-A"},
        {"id": "group-2", "name": "CSE-AIML-Y2-S3-B"},
    ])
    monkeypatch.setattr(timetable_service.supabase, "update_timetable_entries_faculty", lambda *args: updated_entries.append(args))

    result = timetable_service.assign_faculty_to_selected_course(
        {"id": "faculty-1", "name": "Dr. Ravi", "employee_code": "CSE-FAC-106", "department_id": "department-1"},
        3,
        "course-2",
    )

    assert result["assigned"] is False
    assert result["error"] == "FACULTY_SCHEDULING_CONFLICT"
    assert result["details"]["requested_time"] == "09:00-11:00"
    assert result["details"]["conflicting_time"] == "09:00-10:00"
    assert result["details"]["conflicting_class"] == "CSE101 - Existing course (CSE-AIML-Y2-S3-A)"
    assert not updated_entries


def _mock_existing_faculty_assignment(monkeypatch, target_slot):
    entries = [
        {"id": "entry-existing", "faculty_id": "faculty-1", "course_id": "course-1", "group_id": "group-1", "timetable_id": "timetable-1", "time_slot_id": "slot-mon-09", "duration_hours": 1},
        {"id": "entry-target", "faculty_id": "faculty-2", "course_id": "course-2", "group_id": "group-2", "timetable_id": "timetable-1", "time_slot_id": target_slot, "duration_hours": 1},
    ]
    updated = []
    monkeypatch.setattr(app_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(timetable_service_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(timetable_service, "get_faculty", lambda: [
        {"id": "faculty-1", "name": "Dr. Ravi", "employee_code": "CSE-FAC-106", "department_id": "department-1"},
        {"id": "faculty-2", "name": "Dr. Mehta", "employee_code": "CSE-FAC-107", "department_id": "department-1"},
    ])
    monkeypatch.setattr(timetable_service, "get_timetable", lambda timetable_id: [{"id": timetable_id, "semester": 3}])
    monkeypatch.setattr(timetable_service, "get_timetable_entries", lambda timetable_id=None: entries)
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: [
        {"id": "course-1", "course_code": "CSE101", "course_name": "Existing course", "department_id": "department-1"},
        {"id": "course-2", "course_code": "CSE102", "course_name": "Requested course", "department_id": "department-1"},
    ])
    monkeypatch.setattr(timetable_service, "get_student_groups", lambda semester=None: [
        {"id": "group-1", "name": "CSE-AIML-Y2-S3-A"},
        {"id": "group-2", "name": "CSE-AIML-Y2-S3-B"},
    ])
    monkeypatch.setattr(timetable_service, "get_time_slots", _slots)
    monkeypatch.setattr(timetable_service, "get_faculty_availability", lambda: [])
    monkeypatch.setattr(timetable_service.supabase, "update_timetable_entry_faculty", lambda *args: updated.append(args) or [entries[1]])
    return updated


def test_assign_existing_faculty_endpoint_returns_conflict_without_write(monkeypatch):
    updated = _mock_existing_faculty_assignment(monkeypatch, "slot-mon-09-11")

    with app.test_client() as client:
        response = client.put(
            "/api/timetable/timetable-1/entries/entry-target/faculty",
            json={"faculty_id": "faculty-1"},
        )

    assert response.status_code == 409
    assert response.get_json()["error"] == "FACULTY_SCHEDULING_CONFLICT"
    assert response.get_json()["details"]["requested_class"] == "CSE102 - Requested course (CSE-AIML-Y2-S3-B)"
    assert response.get_json()["details"]["requested_time"] == "09:00-11:00"
    assert response.get_json()["details"]["conflicting_time"] == "09:00-10:00"
    assert not updated


def test_assign_existing_faculty_endpoint_persists_adjacent_assignment(monkeypatch):
    updated = _mock_existing_faculty_assignment(monkeypatch, "slot-mon-10")

    with app.test_client() as client:
        response = client.put(
            "/api/timetable/timetable-1/entries/entry-target/faculty",
            json={"faculty_id": "faculty-1"},
        )

    assert response.status_code == 200
    assert response.get_json()["assigned"] is True
    assert updated == [("timetable-1", "entry-target", "faculty-1")]
