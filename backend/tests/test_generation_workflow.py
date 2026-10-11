from copy import deepcopy

import app as app_module
import optimizer.scheduler as scheduler_module
from optimizer.validation import validate_candidate_assignments
from services.timetable_service import timetable_service


DEPARTMENTS = [{"id": "dept-1", "code": "CSE-AIML", "name": "CSE-AIML"}]
COURSES = [
    {"id": "course-1", "course_code": "CSE101", "department_id": "dept-1", "semester": 3, "course_type": "theory", "sessions_per_week": 1, "duration_hours": 1},
    {"id": "course-2", "course_code": "CSE102", "department_id": "dept-1", "semester": 3, "course_type": "theory", "sessions_per_week": 1, "duration_hours": 1},
]
FACULTY = [
    {"id": "faculty-1", "name": "Dr. Ravi", "department_id": "dept-1"},
    {"id": "faculty-2", "name": "Dr. Mehta", "department_id": "dept-1"},
]
GROUPS = [
    {"id": "group-1", "name": "CSE-AIML-Y2-S3-A", "department_id": "dept-1", "semester": 3, "student_count": 40},
    {"id": "group-2", "name": "CSE-AIML-Y2-S3-B", "department_id": "dept-1", "semester": 3, "student_count": 35},
]
ROOMS = [
    {"id": "room-1", "name": "CR-01", "room_type": "classroom", "capacity": 60},
    {"id": "room-2", "name": "CR-02", "room_type": "classroom", "capacity": 60},
]
SLOTS = [
    {"id": "mon-09", "day_of_week": 1, "start_time": "09:00:00", "end_time": "10:00:00"},
    {"id": "mon-10", "day_of_week": 1, "start_time": "10:00:00", "end_time": "11:00:00"},
    {"id": "tue-09", "day_of_week": 2, "start_time": "09:00:00", "end_time": "10:00:00"},
]


def install_fixture(monkeypatch):
    monkeypatch.setenv("OPTIMIZER_MAX_TIME_SECONDS", "5")
    monkeypatch.setattr(app_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(scheduler_module, "HAS_SUPABASE_CONFIG", True)
    monkeypatch.setattr(timetable_service, "get_departments", lambda: DEPARTMENTS)
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: COURSES)
    monkeypatch.setattr(timetable_service, "get_faculty", lambda: FACULTY)
    monkeypatch.setattr(timetable_service, "get_student_groups", lambda semester=None: GROUPS)
    monkeypatch.setattr(timetable_service, "get_rooms", lambda: ROOMS)
    monkeypatch.setattr(timetable_service, "get_time_slots", lambda: SLOTS)
    monkeypatch.setattr(timetable_service, "get_faculty_availability", lambda: [])
    saved = [{"id": "previous", "name": "2026-27-sem3", "academic_year": "2026-27", "semester": 3}]
    saved_entries = [{"id": "previous-entry", "timetable_id": "previous", "course_id": "course-1"}]
    writes = []

    def insert_metadata(payload):
        writes.append(("metadata", deepcopy(payload)))
        saved.append({"id": "new-timetable", **payload})
        return saved[-1]

    def insert_entries(rows):
        writes.append(("entries", deepcopy(rows)))
        saved_entries.extend(deepcopy(rows))
        return rows

    monkeypatch.setattr(scheduler_module.supabase_service, "insert_timetable", insert_metadata)
    monkeypatch.setattr(scheduler_module.supabase_service, "insert_timetable_entries", insert_entries)
    return saved, saved_entries, writes


def test_original_generate_route_validates_once_before_saving(monkeypatch):
    saved, entries, writes = install_fixture(monkeypatch)
    validations = []

    def validate(*args):
        assert writes == []
        validations.append(args)
        return validate_candidate_assignments(*args)

    monkeypatch.setattr(scheduler_module, "validate_candidate_assignments", validate)
    with app_module.app.test_client() as client:
        response = client.post("/api/timetable/generate", json={
            "academic_year": "2026-27", "semester": 3, "department": "CSE-AIML", "student_group": "group-1",
        })

    payload = response.get_json()
    assert response.status_code == 200
    assert payload["success"] is True
    assert payload["validation"] == {"valid": True, "violation_count": 0, "violations": []}
    assert payload["solver_status"] in {"OPTIMAL", "FEASIBLE"}
    assert len(validations) == 1
    assert validations[0][3] == [GROUPS[0]]
    assert len(writes) == 2
    assert all(row["group_id"] == "group-1" for row in writes[1][1])
    assert saved[0]["id"] == "previous"
    assert entries[0]["id"] == "previous-entry"


def test_real_clock_overlap_is_rejected_without_writes_or_automatic_retry(monkeypatch):
    saved, entries, writes = install_fixture(monkeypatch)
    before = deepcopy((saved, entries))
    # Distinct slot IDs with overlapping clock times expose a real validation
    # failure even when the existing solver's per-slot constraints are satisfied.
    overlapping_slots = [SLOTS[0], {**SLOTS[0], "id": "mon-09-other"}]
    courses = [{**row, "faculty_id": "faculty-1"} for row in COURSES]
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: courses)
    monkeypatch.setattr(timetable_service, "get_time_slots", lambda: overlapping_slots)
    solver_calls = []
    original_solve = scheduler_module.cp_model.CpSolver.Solve

    def solve(self, model):
        solver_calls.append(model)
        return original_solve(self, model)

    monkeypatch.setattr(scheduler_module.cp_model.CpSolver, "Solve", solve)
    scope = {"academic_year": "2026-27", "semester": 3, "department": "CSE-AIML"}
    with app_module.app.test_client() as client:
        for attempt in range(2):
            response = client.post("/api/timetable/generate", json=scope)
            assert response.status_code == 400
            payload = response.get_json()
            assert payload["success"] is False
            assert payload["error"] == "SCHEDULING_CONFLICT"
            violation = next(item for item in payload["validation"]["violations"] if item["code"] == "faculty_overlap")
            assert violation["resource"] == "Dr. Ravi"
            assert violation["day"] == "Monday"
            assert violation["requested_time"] == "09:00-10:00"
            assert len(solver_calls) == attempt + 1
            assert writes == []
            assert (saved, entries) == before


def test_valid_manual_regeneration_saves_only_the_valid_attempt(monkeypatch):
    saved, entries, writes = install_fixture(monkeypatch)
    # The solver's existing fallback for a missing required faculty produces a
    # concrete hard-constraint violation, caught independently before saving.
    courses = [{**COURSES[0], "faculty_id": "missing-faculty"}, COURSES[1]]
    monkeypatch.setattr(timetable_service, "get_courses", lambda semester=None: courses)
    scope = {"academic_year": "2026-27", "semester": 3, "student_group": "group-1"}
    with app_module.app.test_client() as client:
        failure = client.post("/api/timetable/generate", json=scope)
        assert failure.status_code == 400
        assert "course_faculty_mismatch" in {item["code"] for item in failure.get_json()["validation"]["violations"]}
        assert writes == []
        assert len(saved) == len(entries) == 1
        courses[0] = COURSES[0]
        success = client.post("/api/timetable/generate", json=scope)

    assert success.status_code == 200
    assert success.get_json()["validation"]["valid"] is True
    assert success.get_json()["timetable_id"] == "new-timetable"
    assert len(writes) == 2
    assert entries[0]["id"] == "previous-entry"


def test_infeasibility_is_not_reported_as_a_scheduling_violation(monkeypatch):
    saved, entries, writes = install_fixture(monkeypatch)
    monkeypatch.setattr(timetable_service, "get_rooms", lambda: [{**ROOMS[0], "capacity": 1}])
    with app_module.app.test_client() as client:
        response = client.post("/api/timetable/generate", json={"academic_year": "2026-27", "semester": 3})
    assert response.status_code == 400
    assert "validation" not in response.get_json()
    assert writes == []
    assert len(saved) == len(entries) == 1


def test_candidate_comparison_and_acceptance_routes_are_removed():
    assert not any("candidate" in rule.rule for rule in app_module.app.url_map.iter_rules())
    with app_module.app.test_client() as client:
        for path in ("/api/timetable/candidate", "/api/timetable/candidate/compare", "/api/timetable/candidate/accept"):
            # The original GET /timetable/<id> route can match the first URL.
            assert client.post(path, json={}).status_code in {404, 405}
