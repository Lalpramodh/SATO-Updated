import logging
from typing import Any

from supabase import Client, create_client

from config import HAS_SUPABASE_CONFIG, SUPABASE_KEY, SUPABASE_URL

logger = logging.getLogger(__name__)


class SupabaseService:
    def __init__(self):
        self.client: Client | None = None
        if HAS_SUPABASE_CONFIG:
            try:
                self.client = create_client(SUPABASE_URL, SUPABASE_KEY)
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.exception("Unable to initialize Supabase client: %s", exc)
                self.client = None

    def is_configured(self) -> bool:
        return self.client is not None

    def _select(self, table: str, *, select: str = "*", filters: list[tuple[str, str, Any]] | None = None, order: str | None = None):
        if not self.client:
            raise RuntimeError("Supabase is not configured.")

        rows = []
        page_size = 1000
        offset = 0
        while True:
            query = self.client.table(table).select(select)
            if filters:
                for column, operator, value in filters:
                    query = query.filter(column, operator, value)
            if order:
                query = query.order(order)
            response = query.range(offset, offset + page_size - 1).execute()
            page = response.data if hasattr(response, "data") else response
            if not isinstance(page, list):
                return page
            rows.extend(page)
            if len(page) < page_size:
                return rows
            offset += page_size

    def get_departments(self):
        return self._select("departments", order="name")

    def get_courses(self, semester: int | None = None):
        filters = []
        if semester is not None:
            filters.append(("semester", "eq", semester))
        return self._select("courses", filters=filters, order="course_code")

    def get_faculty(self):
        return self._select("faculty", order="name")

    def insert_faculty(self, payload: dict[str, Any]):
        if not self.client:
            raise RuntimeError("Supabase is not configured.")
        response = self.client.table("faculty").insert(payload).execute()
        if hasattr(response, "data") and response.data:
            return response.data[0]
        return response

    def update_timetable_entries_faculty(self, timetable_id: str, course_id: str, faculty_id: str):
        if not self.client:
            raise RuntimeError("Supabase is not configured.")
        response = (
            self.client.table("timetable_entries")
            .update({"faculty_id": faculty_id})
            .eq("timetable_id", timetable_id)
            .eq("course_id", course_id)
            .execute()
        )
        return response.data if hasattr(response, "data") else response

    def get_student_groups(self, semester: int | None = None):
        filters = []
        if semester is not None:
            filters.append(("semester", "eq", semester))
        return self._select("student_groups", filters=filters, order="name")

    def get_rooms(self):
        return self._select("rooms", order="name")

    def get_time_slots(self):
        return self._select("time_slots", order="day_of_week")

    def get_faculty_availability(self):
        return self._select("faculty_availability", order="faculty_id")

    def get_timetable(self, timetable_id: str | None = None):
        filters = []
        if timetable_id is not None:
            filters.append(("id", "eq", timetable_id))
        return self._select("timetables", filters=filters, order="created_at")

    def get_timetable_entries(self, timetable_id: str | None = None):
        filters = []
        if timetable_id is not None:
            filters.append(("timetable_id", "eq", timetable_id))
        return self._select("timetable_entries", filters=filters, order="time_slot_id")

    def insert_timetable(self, payload: dict[str, Any]):
        if not self.client:
            raise RuntimeError("Supabase is not configured.")
        response = self.client.table("timetables").insert(payload).execute()
        if hasattr(response, "data") and response.data:
            return response.data[0]
        return response

    def insert_timetable_entries(self, rows: list[dict[str, Any]]):
        if not self.client:
            raise RuntimeError("Supabase is not configured.")
        if not rows:
            return []
        response = self.client.table("timetable_entries").insert(rows).execute()
        if hasattr(response, "data"):
            return response.data
        return response


supabase_service = SupabaseService()
