import logging
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS
from pydantic import BaseModel, Field, ValidationError

from config import FLASK_DEBUG, FLASK_HOST, FLASK_PORT, HAS_SUPABASE_CONFIG
from optimizer.scheduler import generate_timetable
from services.candidate_service import accept_timetable_candidate, compare_timetable_candidate, generate_timetable_candidate
from services.timetable_service import timetable_service

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)


class GenerateTimetableRequest(BaseModel):
    academic_year: str = Field(..., min_length=1)
    semester: int = Field(..., ge=3, le=3)
    department: str | None = None
    student_group: str | None = None


class CandidateTimetableRequest(GenerateTimetableRequest):
    additional_attempts: int = Field(default=0, ge=0, le=3)
    check_base: bool = False
    expected_base_timetable_id: str | None = None
    best_candidate: dict[str, Any] | None = None


class CandidateComparisonRequest(GenerateTimetableRequest):
    base_latest_timetable_id: str | None = None
    assignments: list[dict[str, Any]]


class CandidateAcceptanceRequest(GenerateTimetableRequest):
    base_latest_timetable_id: str | None = None
    assignments: list[dict[str, Any]]
    generation_time_ms: int = Field(default=0, ge=0)


class CreateFacultyRequest(BaseModel):
    employee_code: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    email: str = Field(..., min_length=3, max_length=320)
    department_id: str = Field(..., min_length=1)
    semester: int = Field(..., ge=3, le=3)
    course_id: str = Field(..., min_length=1)
    max_hours_per_week: int = Field(..., ge=1, le=168)


class FacultyEntryAssignmentRequest(BaseModel):
    faculty_id: str = Field(..., min_length=1)


def parse_semester(value):
    if value in (None, ''):
        return None
    try:
        semester = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("semester must be an integer.") from exc
    if semester != 3:
        raise ValueError("Only Semester 3 is supported for the active academic scope.")
    return semester


@app.get('/api/health')
def health_check():
    return jsonify({"status": "ok", "service": "Smart Academic Timetable Optimizer"})


@app.get('/api/departments')
def get_departments():
    try:
        if not HAS_SUPABASE_CONFIG:
            return jsonify({"error": "Supabase is not configured."}), 503
        data = timetable_service.get_departments()
        return jsonify(data), 200
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to fetch departments")
        return jsonify({"error": "Unable to load departments."}), 500


@app.route('/api/faculty', methods=['GET', 'POST'])
def faculty_endpoint():
    if request.method == 'GET':
        try:
            if not HAS_SUPABASE_CONFIG:
                return jsonify({"error": "Supabase is not configured."}), 503
            return jsonify(timetable_service.get_faculty()), 200
        except Exception:  # pragma: no cover - defensive logging
            logger.exception("Failed to fetch faculty")
            return jsonify({"error": "Unable to load faculty."}), 500

    try:
        payload = request.get_json(silent=True)
        if not payload:
            return jsonify({"error": "Request body is required."}), 400
        request_model = CreateFacultyRequest.model_validate(payload)
        record = timetable_service.insert_faculty(request_model.model_dump(exclude={"semester", "course_id"}))
        assignment = timetable_service.assign_faculty_to_selected_course(record, request_model.semester, request_model.course_id)
        if not assignment.get("assigned", False) and assignment.get("error") == "FACULTY_SCHEDULING_CONFLICT":
            try:
                timetable_service.delete_faculty(str(record["id"]))
            except Exception:
                logger.exception("Failed to remove faculty record after a rejected timetable assignment")
            return jsonify({
                "error": assignment["error"],
                "message": assignment["message"],
                "details": assignment.get("details", {})
            }), 409
        return jsonify({"faculty": record, "assignment": assignment, "message": assignment["message"]}), 201
    except ValidationError as exc:
        return jsonify({"error": "Invalid faculty details.", "details": exc.errors()}), 400
    except Exception as exc:  # pragma: no cover - defensive logging
        message = str(exc).lower()
        if "23505" in message or "duplicate" in message or "unique" in message:
            if "employee_code" in message:
                return jsonify({"error": "Faculty with this employee code already exists."}), 409
            if "email" in message:
                return jsonify({"error": "Faculty with this email already exists."}), 409
            return jsonify({"error": "A faculty record with these details already exists."}), 409
        logger.exception("Failed to create faculty")
        return jsonify({"error": f"Unable to add faculty: {str(exc) or 'Unknown backend error.'}"}), 500


@app.put('/api/timetable/<timetable_id>/entries/<entry_id>/faculty')
def assign_faculty_to_timetable_entry_endpoint(timetable_id, entry_id):
    if not HAS_SUPABASE_CONFIG:
        return jsonify({"error": "Supabase is not configured."}), 503
    try:
        payload = request.get_json(silent=True)
        if not payload:
            return jsonify({"error": "Request body is required."}), 400
        request_model = FacultyEntryAssignmentRequest.model_validate(payload)
        result = timetable_service.assign_faculty_to_timetable_entry(
            timetable_id,
            entry_id,
            request_model.faculty_id,
        )
        if not result.get("assigned", False):
            status = result.get("status", 422)
            return jsonify({
                "error": result.get("error", "FACULTY_ASSIGNMENT_REJECTED"),
                "message": result.get("message", "Unable to assign faculty to this class."),
                "details": result.get("details", {}),
            }), status
        return jsonify(result), 200
    except ValidationError as exc:
        return jsonify({"error": "Invalid faculty assignment.", "details": exc.errors()}), 400
    except Exception:
        logger.exception("Failed to assign faculty to timetable entry %s", entry_id)
        return jsonify({"error": "Unable to assign faculty to this class."}), 500


@app.get('/api/student-groups')
def get_student_groups():
    try:
        if not HAS_SUPABASE_CONFIG:
            return jsonify({"error": "Supabase is not configured."}), 503
        parsed_semester = parse_semester(request.args.get('semester'))
        return jsonify(timetable_service.get_student_groups(parsed_semester, request.args.get('department'))), 200
    except ValueError:
        return jsonify({"error": "semester must be an integer."}), 400
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to fetch student groups")
        return jsonify({"error": "Unable to load student groups."}), 500


@app.get('/api/rooms')
def get_rooms():
    try:
        if not HAS_SUPABASE_CONFIG:
            return jsonify({"error": "Supabase is not configured."}), 503
        return jsonify(timetable_service.get_rooms()), 200
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to fetch rooms")
        return jsonify({"error": "Unable to load rooms."}), 500


@app.get('/api/time-slots')
def get_time_slots():
    try:
        if not HAS_SUPABASE_CONFIG:
            return jsonify({"error": "Supabase is not configured."}), 503
        return jsonify(timetable_service.get_time_slots()), 200
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to fetch time slots")
        return jsonify({"error": "Unable to load time slots."}), 500


@app.get('/api/courses')
def get_courses():
    try:
        if not HAS_SUPABASE_CONFIG:
            return jsonify({"error": "Supabase is not configured."}), 503
        parsed_semester = parse_semester(request.args.get('semester'))
        data = timetable_service.get_courses(parsed_semester)
        return jsonify(data), 200
    except ValueError:
        return jsonify({"error": "semester must be an integer."}), 400
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to fetch courses")
        return jsonify({"error": "Unable to load courses."}), 500


@app.get('/api/timetable/data')
def timetable_data():
    try:
        if not HAS_SUPABASE_CONFIG:
            return jsonify({"error": "Supabase is not configured."}), 503
        semester = request.args.get('semester')
        if semester in (None, ''):
            parsed_semester = None
        else:
            try:
                parsed_semester = int(semester)
            except ValueError:
                return jsonify({"error": "semester must be an integer."}), 400
            if parsed_semester != 3:
                return jsonify({"error": "Only Semester 3 is supported for the active academic scope."}), 400
        summary = timetable_service.build_timetable_summary(parsed_semester)
        return jsonify(summary), 200
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to fetch timetable summary")
        return jsonify({"error": "Unable to load scheduling data."}), 500


@app.get('/api/timetables')
def get_timetables():
    try:
        if not HAS_SUPABASE_CONFIG:
            return jsonify({"error": "Supabase is not configured."}), 503
        academic_year = request.args.get('academic_year')
        semester = request.args.get('semester')
        semester_value = parse_semester(semester)
        records = timetable_service.get_timetables(academic_year=academic_year or None, semester=semester_value)
        return jsonify(records), 200
    except ValueError:
        return jsonify({"error": "semester must be an integer."}), 400
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to fetch timetables")
        return jsonify({"error": "Unable to load timetables."}), 500


@app.get('/api/timetable/<timetable_id>')
def get_timetable_by_id(timetable_id):
    try:
        if not HAS_SUPABASE_CONFIG:
            return jsonify({"error": "Supabase is not configured."}), 503
        timetable = timetable_service.get_timetable(timetable_id)
        if not timetable:
            return jsonify({"error": "Timetable not found."}), 404
        entries = timetable_service.get_enriched_timetable_entries(timetable_id, timetable[0].get("semester") if isinstance(timetable, list) else timetable.get("semester"))
        return jsonify({"timetable": timetable[0] if isinstance(timetable, list) and timetable else timetable, "entries": entries}), 200
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Failed to fetch timetable %s", timetable_id)
        return jsonify({"error": "Unable to load timetable."}), 500


@app.post('/api/timetable/generate')
def generate_timetable_endpoint():
    try:
        payload = request.get_json(silent=True)
        if not payload:
            return jsonify({"error": "Request body is required."}), 400

        request_model = GenerateTimetableRequest.model_validate(payload)
        result = generate_timetable(request_model.academic_year, request_model.semester, request_model.department, request_model.student_group)
        return jsonify(result), 200 if result.get('success') else 400
    except ValidationError as exc:
        logger.warning("Invalid timetable generation payload: %s", exc)
        return jsonify({"error": "Invalid request body.", "details": exc.errors()}), 400
    except ValueError as exc:
        logger.warning("Timetable generation validation failed: %s", exc)
        return jsonify({"error": str(exc)}), 400
    except RuntimeError as exc:
        logger.exception("Timetable generation failed because the backend is misconfigured")
        return jsonify({"error": str(exc) or "Supabase is not configured."}), 503
    except Exception:  # pragma: no cover - defensive logging
        logger.exception("Timetable generation failed")
        return jsonify({"error": "Unable to generate timetable."}), 500


@app.post('/api/timetable/candidate')
def generate_timetable_candidate_endpoint():
    try:
        payload = request.get_json(silent=True)
        if not payload:
            return jsonify({"error": "Request body is required."}), 400
        request_model = CandidateTimetableRequest.model_validate(payload)
        result = generate_timetable_candidate(
            request_model.academic_year,
            request_model.semester,
            request_model.department,
            request_model.student_group,
            additional_attempts=request_model.additional_attempts,
            expected_base_timetable_id=request_model.expected_base_timetable_id,
            check_base=request_model.check_base,
            best_candidate=request_model.best_candidate,
        )
        if result.get("success"):
            return jsonify(result), 200
        return jsonify(result), result.get("status", 422)
    except ValidationError as exc:
        return jsonify({"error": "Invalid candidate request.", "details": exc.errors()}), 400
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError:
        logger.exception("Candidate generation backend is unavailable")
        return jsonify({"error": "Candidate generation backend is unavailable."}), 503
    except Exception:
        logger.exception("Candidate generation failed")
        return jsonify({"error": "Unable to generate a timetable candidate."}), 500


@app.post('/api/timetable/candidate/compare')
def compare_timetable_candidate_endpoint():
    try:
        payload = request.get_json(silent=True)
        if not payload:
            return jsonify({"error": "Request body is required."}), 400
        request_model = CandidateComparisonRequest.model_validate(payload)
        result = compare_timetable_candidate(
            request_model.academic_year,
            request_model.semester,
            request_model.department,
            request_model.student_group,
            request_model.assignments,
            request_model.base_latest_timetable_id,
        )
        return (jsonify(result), 200) if result.get("success") else (jsonify(result), result.get("status", 422))
    except ValidationError as exc:
        return jsonify({"error": "Invalid candidate comparison request.", "details": exc.errors()}), 400
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        logger.exception("Timetable candidate comparison failed")
        return jsonify({"error": "Unable to compare timetable candidates."}), 500


@app.post('/api/timetable/candidate/accept')
def accept_timetable_candidate_endpoint():
    try:
        payload = request.get_json(silent=True)
        if not payload:
            return jsonify({"error": "Request body is required."}), 400
        request_model = CandidateAcceptanceRequest.model_validate(payload)
        result = accept_timetable_candidate(
            request_model.academic_year,
            request_model.semester,
            request_model.department,
            request_model.student_group,
            request_model.assignments,
            request_model.base_latest_timetable_id,
            request_model.generation_time_ms,
        )
        return (jsonify(result), 201) if result.get("success") else (jsonify(result), result.get("status", 422))
    except ValidationError as exc:
        return jsonify({"error": "Invalid candidate acceptance request.", "details": exc.errors()}), 400
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except RuntimeError:
        logger.exception("Candidate acceptance backend is unavailable")
        return jsonify({"error": "Candidate acceptance backend is unavailable."}), 503
    except Exception:
        logger.exception("Timetable candidate acceptance failed")
        return jsonify({"error": "Unable to accept the timetable candidate."}), 500


if __name__ == '__main__':
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)
