from copy import deepcopy

import app as app_module
import optimizer.scheduler as scheduler_module
import pytest
import services.candidate_service as candidate_service_module
import services.timetable_service as timetable_service_module
from app import app
from services.timetable_service import timetable_service


DEPARTMENTS = [{"id": "dept-1", "code": "CSE-AIML", "name": "CSE-AIML"}]
COURSES = [
    {"id": "course-1", "course_code": "CSE101", "course_name": "Theory 1", "department_id": "dept-1", "semester": 3, "course_type": "theory", "sessions_per_week": 1, "duration_hours": 1},
    {"id": "course-2", "course_code": "CSE102", "course_name": "Theory 2", "department_id": "dept-1", "semester": 3, "course_type": "theory", "sessions_per_week": 1, "duration_hours": 1},
]
FACULTY = [
    {"id": "faculty-1", "name": "Dr. Ravi", "employee_code": "F1", "department_id": "dept-1"},
    {"id": "faculty-2", "name": "Dr. Mehta", "employee_code": "F2", "department_id": "dept-1"},
]
GROUPS = [
    {"id": "group-1", "name": "CSE-AIML-Y2-S3-A", "department_id": "dept-1", "semester": 3, "student_count": 40},
    {"id": "group-2", "name": "CSE-AIML-Y2-S3-B", "department_id": "dept-1", "semester": 3, "student_count": 35},
]
ROOMS = [{"id": "room-1", "name": "CR-01", "room_type": "classroom", "capacity": 60}, {"id": "room-2", "name": "CR-02", "room_type": "classroom", "capacity": 60}]
SLOTS = [
    {"id": "mon-09", "day_of_week": 1, "start_time": "09:00:00", "end_time": "10:00:00"},
    {"id": "mon-10", "day_of_week": 1, "start_time": "10:00:00", "end_time": "11:00:00"},
    {"id": "tue-09", "day_of_week": 2, "start_time": "09:00:00", "end_time": "10:00:00"},
]
PREVIOUS = {"id": "previous", "name": "2026-27-sem3", "academic_year": "2026-27", "semester": 3, "optimization_score": 86, "created_at": "2026-10-10T10:00:00Z"}
PREVIOUS_ENTRIES = [
    {"id": "old-1", "timetable_id": "previous", "course_id": "course-1", "faculty_id": "faculty-1", "group_id": "group-1", "room_id": "room-1", "time_slot_id": "mon-09", "duration_hours": 1},
    {"id": "old-2", "timetable_id": "previous", "course_id": "course-2", "faculty_id": "faculty-2", "group_id": "group-2", "room_id": "room-1", "time_slot_id": "mon-10", "duration_hours": 1},
]
VALID = [
    {"course_id": "course-1", "faculty_id": "faculty-1", "group_id": "group-1", "room_id": "room-1", "time_slot_ids": ["tue-09"], "duration_hours": 1},
    {"course_id": "course-2", "faculty_id": "faculty-2", "group_id": "group-2", "room_id": "room-1", "time_slot_ids": ["mon-10"], "duration_hours": 1},
]


def _install_scope(monkeypatch, records=None):
    monkeypatch.setattr(app_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(timetable_service, "get_departments", lambda: DEPARTMENTS)
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: COURSES)
    monkeypatch.setattr(timetable_service, "get_faculty", lambda: FACULTY)
    monkeypatch.setattr(timetable_service, "get_student_groups", lambda semester=None, department=None: GROUPS)
    monkeypatch.setattr(timetable_service, "get_rooms", lambda: ROOMS)
    monkeypatch.setattr(timetable_service, "get_time_slots", lambda: SLOTS)
    monkeypatch.setattr(timetable_service, "get_faculty_availability", lambda: [])
    monkeypatch.setattr(timetable_service, "get_timetables", lambda academic_year=None, semester=None: records or [])
    monkeypatch.setattr(timetable_service, "get_timetable_entries", lambda timetable_id=None: deepcopy(PREVIOUS_ENTRIES) if timetable_id == "previous" else [])


def _optimizer_result(assignments, status="OPTIMAL", optimization_score=90):
    return {
        "success": True,
        "status": status,
        "assignments": deepcopy(assignments),
        "optimization_score": optimization_score,
        "generation_time_ms": 10,
    }


def test_candidate_route_validates_and_does_not_persist_before_accept(monkeypatch):
    _install_scope(monkeypatch, [PREVIOUS])
    monkeypatch.setattr(candidate_service_module, "generate_timetable", lambda *args, **kwargs: _optimizer_result(VALID))
    writes = []
    monkeypatch.setattr(timetable_service.supabase, "insert_timetable", lambda payload: writes.append(payload))
    monkeypatch.setattr(timetable_service.supabase, "insert_timetable_entries", lambda rows: writes.append(rows))

    with app.test_client() as client:
        response = client.post("/api/timetable/candidate", json={"academic_year": "2026-27", "semester": 3})

    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["validation"]["valid"] is True
    assert payload["comparison"]["previous"]["timetable_id"] == "previous"
    assert payload["comparison"]["candidate"]["validation"]["violation_count"] == 0
    assert payload["comparison"]["optimization_score_delta"] == 4.0
    assert writes == []


def test_candidate_comparison_distinguishes_move_from_conflict(monkeypatch):
    _install_scope(monkeypatch, [PREVIOUS])

    with app.test_client() as client:
        response = client.post("/api/timetable/candidate/compare", json={
            "academic_year": "2026-27",
            "semester": 3,
            "base_latest_timetable_id": "previous",
            "assignments": VALID,
            "generation_time_ms": 1234,
        })

    payload = response.get_json()
    assert response.status_code == 200
    assert payload["candidate"]["validation"]["violation_count"] == 0
    assert payload["previous"]["validation"]["violation_count"] == 0
    assert payload["assignment_changes"]["change_count"] == 1
    assert payload["assignment_changes"]["changed"][0]["changes"]
    assert payload["optimization_score_delta"] == 4.0


def test_no_previous_timetable_is_reported_without_fabricating_comparison(monkeypatch):
    _install_scope(monkeypatch, [])
    monkeypatch.setattr(candidate_service_module, "generate_timetable", lambda *args, **kwargs: _optimizer_result(VALID))

    result = candidate_service_module.generate_timetable_candidate("2026-27", 3)

    assert result["success"] is True
    assert result["comparison"]["previous"] is None
    assert result["comparison"]["assignment_changes"] is None
    assert "No previous timetable" in result["comparison"]["message"]


def test_selected_group_excludes_courses_pinned_to_other_groups(monkeypatch):
    _install_scope(monkeypatch, [PREVIOUS])
    group_pinned_course = {
        "id": "course-3", "course_code": "CSE103", "course_name": "Other cohort course",
        "department_id": "dept-1", "group_id": "group-2", "semester": 3,
        "course_type": "theory", "sessions_per_week": 1, "duration_hours": 1,
    }
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: [*COURSES, group_pinned_course])
    captured = {}

    def optimizer(*args, **kwargs):
        captured.update(kwargs)
        selected_group_assignments = [dict(VALID[0]), {**VALID[1], "group_id": "group-1"}]
        return _optimizer_result(selected_group_assignments)

    monkeypatch.setattr(candidate_service_module, "generate_timetable", optimizer)
    result = candidate_service_module.generate_timetable_candidate("2026-27", 3, student_group="group-1")

    assert result["success"] is True
    assert captured["course_ids"] == {"course-1", "course-2"}


def test_retry_limit_is_bounded_and_better_valid_objective_is_preferred(monkeypatch):
    _install_scope(monkeypatch, [PREVIOUS])
    spread_over_days = deepcopy(VALID)
    same_day = [
        {**VALID[0], "time_slot_ids": ["mon-09"]},
        deepcopy(VALID[1]),
    ]
    generated = iter([
        _optimizer_result(same_day, "FEASIBLE"),
        _optimizer_result(spread_over_days, "FEASIBLE"),
        _optimizer_result(same_day, "FEASIBLE"),
        _optimizer_result(same_day, "FEASIBLE"),
    ])
    calls = []

    def optimizer(*args, **kwargs):
        calls.append(kwargs)
        return next(generated)

    monkeypatch.setattr(candidate_service_module, "generate_timetable", optimizer)
    result = candidate_service_module.generate_timetable_candidate("2026-27", 3, additional_attempts=99)

    assert len(calls) == 4
    assert all(call["persist"] is False for call in calls)
    assert len(result["attempts"]) == 4
    assert result["success"] is True
    assert result["assignments"][0]["time_slot_ids"] == ["tue-09"]
    assert result["objective_value"] < _objective_for(same_day)


def _objective_for(assignments):
    return candidate_service_module._objective_value(assignments, FACULTY, GROUPS, SLOTS)


def _install_real_optimizer_data(monkeypatch):
    monkeypatch.setattr(scheduler_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(timetable_service_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(timetable_service, "get_departments", lambda: DEPARTMENTS)
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: COURSES)
    monkeypatch.setattr(timetable_service, "get_faculty", lambda: FACULTY)
    monkeypatch.setattr(timetable_service, "get_student_groups", lambda semester=None: GROUPS)
    monkeypatch.setattr(timetable_service, "get_rooms", lambda: ROOMS)
    monkeypatch.setattr(timetable_service, "get_time_slots", lambda: SLOTS)
    monkeypatch.setattr(timetable_service, "get_faculty_availability", lambda: [])


def test_real_optimizer_candidate_mode_validates_without_persisting(monkeypatch):
    _install_real_optimizer_data(monkeypatch)
    monkeypatch.setattr(scheduler_module.supabase_service, "insert_timetable", lambda payload: (_ for _ in ()).throw(AssertionError("candidate mode must not persist metadata")))
    monkeypatch.setattr(scheduler_module.supabase_service, "insert_timetable_entries", lambda rows: (_ for _ in ()).throw(AssertionError("candidate mode must not persist entries")))

    result = scheduler_module.generate_timetable("2026-27", 3, persist=False, max_time_seconds=5)
    validation = candidate_service_module.validate_candidate_assignments(
        result["assignments"], COURSES, FACULTY, GROUPS, ROOMS, SLOTS, [],
    )

    assert result["success"] is True
    assert result["objective_value"] == pytest.approx(candidate_service_module._objective_value(result["assignments"], FACULTY, GROUPS, SLOTS))
    assert validation["valid"] is True


def test_legacy_optimizer_default_still_persists_generated_timetable(monkeypatch):
    _install_real_optimizer_data(monkeypatch)
    inserted = []
    monkeypatch.setattr(scheduler_module.supabase_service, "insert_timetable", lambda payload: {"id": "legacy-generated"})
    monkeypatch.setattr(scheduler_module.supabase_service, "insert_timetable_entries", lambda rows: inserted.extend(rows) or rows)

    result = scheduler_module.generate_timetable("2026-27", 3, max_time_seconds=5)

    assert result["success"] is True
    assert result["timetable_id"] == "legacy-generated"
    assert len(inserted) == result["entries_created"] > 0


def test_no_valid_retry_leaves_saved_timetable_and_write_calls_untouched(monkeypatch):
    _install_scope(monkeypatch, [PREVIOUS])
    invalid = [deepcopy(VALID[0])]
    monkeypatch.setattr(candidate_service_module, "generate_timetable", lambda *args, **kwargs: _optimizer_result(invalid, "FEASIBLE"))
    writes = []
    monkeypatch.setattr(timetable_service.supabase, "insert_timetable", lambda payload: writes.append(payload))

    result = candidate_service_module.generate_timetable_candidate("2026-27", 3, additional_attempts=3)

    assert result["success"] is False
    assert result["error"] == "NO_VALID_CANDIDATE"
    assert result["attempt_count"] == 4
    assert writes == []
    assert result["validation"]["violation_count"] > 0


def test_accept_revalidates_and_appends_new_timetable_version(monkeypatch):
    _install_scope(monkeypatch, [PREVIOUS])
    inserted_metadata = []
    inserted_rows = []
    monkeypatch.setattr(timetable_service, "get_timetable_entries", lambda timetable_id=None: inserted_rows if timetable_id == "accepted" else PREVIOUS_ENTRIES)
    monkeypatch.setattr(timetable_service.supabase, "insert_timetable", lambda payload: inserted_metadata.append(dict(payload)) or {"id": "accepted"})
    monkeypatch.setattr(timetable_service.supabase, "insert_timetable_entries", lambda rows: inserted_rows.extend(rows) or rows)
    monkeypatch.setattr(timetable_service.supabase, "update_timetable_name", lambda timetable_id, name: inserted_metadata.append({"id": timetable_id, "final_name": name}) or [{"id": timetable_id}])

    with app.test_client() as client:
        response = client.post("/api/timetable/candidate/accept", json={
            "academic_year": "2026-27",
            "semester": 3,
            "base_latest_timetable_id": "previous",
            "assignments": VALID,
            "generation_time_ms": 1234,
        })

    assert response.status_code == 201
    assert response.get_json()["timetable_id"] == "accepted"
    assert inserted_metadata[0]["name"].startswith("SATO-CANDIDATE-PENDING-")
    assert inserted_metadata[0]["generation_time_ms"] == 1234
    assert inserted_metadata[1]["final_name"].startswith("2026-27-sem3")
    assert len(inserted_rows) == 2
    assert all(row["timetable_id"] == "accepted" for row in inserted_rows)
    assert PREVIOUS["id"] == "previous"


def test_invalid_and_stale_candidates_cannot_be_accepted(monkeypatch):
    _install_scope(monkeypatch, [PREVIOUS])
    writes = []
    monkeypatch.setattr(timetable_service.supabase, "insert_timetable", lambda payload: writes.append(payload))
    invalid = [deepcopy(VALID[0])]

    with app.test_client() as client:
        invalid_response = client.post("/api/timetable/candidate/accept", json={
            "academic_year": "2026-27", "semester": 3, "base_latest_timetable_id": "previous", "assignments": invalid,
        })
    assert invalid_response.status_code == 422

    monkeypatch.setattr(timetable_service, "get_timetables", lambda academic_year=None, semester=None: [{**PREVIOUS, "id": "newer"}])
    with app.test_client() as client:
        stale_response = client.post("/api/timetable/candidate/accept", json={
            "academic_year": "2026-27", "semester": 3, "base_latest_timetable_id": "previous", "assignments": VALID,
        })
    assert stale_response.status_code == 409
    assert stale_response.get_json()["error"] == "STALE_CANDIDATE"
    assert writes == []


def test_accept_revalidates_current_availability(monkeypatch):
    _install_scope(monkeypatch, [PREVIOUS])
    availability = []
    monkeypatch.setattr(timetable_service, "get_faculty_availability", lambda: availability)
    monkeypatch.setattr(candidate_service_module, "generate_timetable", lambda *args, **kwargs: _optimizer_result(VALID))
    candidate = candidate_service_module.generate_timetable_candidate("2026-27", 3)
    assert candidate["success"] is True

    availability.append({"faculty_id": "faculty-1", "time_slot_id": "tue-09", "available": False})
    writes = []
    monkeypatch.setattr(timetable_service.supabase, "insert_timetable", lambda payload: writes.append(payload))

    result = candidate_service_module.accept_timetable_candidate(
        "2026-27",
        3,
        None,
        None,
        candidate["assignments"],
        candidate["base_latest_timetable_id"],
    )

    assert result["success"] is False
    assert result["error"] == "INVALID_CANDIDATE"
    assert "faculty_unavailable" in {item["code"] for item in result["validation"]["violations"]}
    assert writes == []


def test_compare_rejects_candidate_when_latest_revision_changed(monkeypatch):
    _install_scope(monkeypatch, [{**PREVIOUS, "id": "newer"}])
    result = candidate_service_module.compare_timetable_candidate("2026-27", 3, None, None, VALID, "previous")
    assert result["success"] is False
    assert result["error"] == "STALE_CANDIDATE"
    assert result["status"] == 409
