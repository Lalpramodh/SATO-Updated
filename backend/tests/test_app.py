import pytest

from app import app
from config import HAS_SUPABASE_CONFIG
from services.timetable_service import (
    filter_supported_departments,
    filter_supported_student_groups,
    is_supported_semester,
)


@pytest.fixture
def client():
    app.config.update(TESTING=True)
    with app.test_client() as client:
        yield client


def test_app_starts(client):
    response = client.get('/api/health')
    assert response.status_code == 200
    data = response.get_json()
    assert data['status'] == 'ok'
    assert data['service'] == 'Smart Academic Timetable Optimizer'


def test_supported_scope_filters():
    departments = [
        {'id': '1', 'code': 'CSE-AIML', 'name': 'CSE-AIML'},
        {'id': '2', 'code': 'CSE-DS', 'name': 'CSE-DS'},
        {'id': '3', 'code': 'CSE-CYBER', 'name': 'CSE-CYBER'},
        {'id': '4', 'code': 'ECE', 'name': 'ECE'},
    ]
    groups = [
        {'id': 'g1', 'name': 'CSE-AIML-Y2-S3-A', 'department_id': '1', 'semester': 3},
        {'id': 'g2', 'name': 'CSE-AIML-Y2-S3-B', 'department_id': '1', 'semester': 3},
        {'id': 'g3', 'name': 'CSE-DS-Y2-S3-A', 'department_id': '2', 'semester': 3},
        {'id': 'g4', 'name': 'CSE-CYBER-Y2-S3-A', 'department_id': '3', 'semester': 3},
        {'id': 'g5', 'name': 'ECE-Y2-S3-A', 'department_id': '4', 'semester': 3},
    ]

    assert [item['code'] for item in filter_supported_departments(departments)] == ['CSE-AIML', 'CSE-DS', 'CSE-CYBER']
    assert [item['name'] for item in filter_supported_student_groups(groups)] == [
        'CSE-AIML-Y2-S3-A',
        'CSE-AIML-Y2-S3-B',
        'CSE-DS-Y2-S3-A',
        'CSE-CYBER-Y2-S3-A',
    ]
    assert is_supported_semester(3) is True
    assert is_supported_semester(4) is False


@pytest.mark.skipif(not HAS_SUPABASE_CONFIG, reason='Supabase is not configured for database-backed tests.')
def test_database_routes(client):
    departments = client.get('/api/departments')
    assert departments.status_code == 200
    data = departments.get_json()
    assert isinstance(data, list)
    assert len(data) >= 1

    courses = client.get('/api/courses?semester=3')
    assert courses.status_code == 200
    payload = courses.get_json()
    assert isinstance(payload, list)

    summary = client.get('/api/timetable/data?semester=3')
    assert summary.status_code == 200
    summary_data = summary.get_json()
    assert summary_data['success'] is True
    assert summary_data['semester'] == 3

    for endpoint in ('/api/faculty', '/api/rooms', '/api/time-slots'):
        reference_response = client.get(endpoint)
        assert reference_response.status_code == 200
        assert isinstance(reference_response.get_json(), list)

    groups = client.get('/api/student-groups?semester=3')
    assert groups.status_code == 200
    assert len(groups.get_json()) >= 1

    timetable = client.get('/api/timetable/43202565-6691-4cbb-9045-6a7e18584c29')
    assert timetable.status_code == 200
    timetable_data = timetable.get_json()
    assert len(timetable_data['entries']) == 254
    assert all(entry['course'] and entry['faculty'] and entry['group'] and entry['room'] and entry['time_slot'] for entry in timetable_data['entries'])

    timetables = client.get('/api/timetables')
    assert timetables.status_code == 200
    timetable_rows = timetables.get_json()
    assert isinstance(timetable_rows, list)
    assert any(row['id'] == '19aedfbd-291f-4be7-832f-4557440f2cbc' for row in timetable_rows)

    empty_timetables = client.get('/api/timetables?academic_year=not-a-real-year&semester=8')
    assert empty_timetables.status_code == 200
    assert empty_timetables.get_json() == []
