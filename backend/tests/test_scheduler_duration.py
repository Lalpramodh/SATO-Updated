from optimizer.scheduler import _build_session_block


SLOTS = [
    {"id": "m09", "day_of_week": 1, "start_time": "09:00:00", "end_time": "10:00:00"},
    {"id": "m10", "day_of_week": 1, "start_time": "10:00:00", "end_time": "11:00:00"},
    {"id": "m1115", "day_of_week": 1, "start_time": "11:15:00", "end_time": "12:15:00"},
    {"id": "m1215", "day_of_week": 1, "start_time": "12:15:00", "end_time": "13:15:00"},
    {"id": "m14", "day_of_week": 1, "start_time": "14:00:00", "end_time": "15:00:00"},
    {"id": "m15", "day_of_week": 1, "start_time": "15:00:00", "end_time": "16:00:00"},
    {"id": "m1600", "day_of_week": 1, "start_time": "16:00:00", "end_time": "17:00:00"},
]


def test_two_hour_blocks_require_clock_continuity():
    assert _build_session_block(SLOTS, 2, "m09") == ["m09", "m10"]
    assert _build_session_block(SLOTS, 2, "m1115") == ["m1115", "m1215"]
    assert _build_session_block(SLOTS, 2, "m14") == ["m14", "m15"]
    assert _build_session_block(SLOTS, 2, "m15") == ["m15", "m1600"]
    assert _build_session_block(SLOTS, 2, "m10") is None
    assert _build_session_block(SLOTS, 2, "m1215") is None


def test_two_hour_block_is_single_start_assignment_with_two_occupied_slots():
    block = _build_session_block(SLOTS, 2, "m09")
    assert block == ["m09", "m10"]
    assert len(block) == 2
    assert _build_session_block(SLOTS, 2, "m15") == ["m15", "m1600"]
