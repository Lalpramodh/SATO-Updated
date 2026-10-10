import os
from dotenv import load_dotenv
from supabase import create_client


load_dotenv()
client = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY'))

def select_all(table, columns):
    rows = []
    offset = 0
    while True:
        page = client.table(table).select(columns).range(offset, offset + 999).execute().data
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000


existing_slots = select_all('time_slots', 'day_of_week,start_time,end_time')
existing_keys = {(row['day_of_week'], row['start_time'], row['end_time']) for row in existing_slots}
required_slots = [
    {'day_of_week': 1, 'start_time': '16:00:00', 'end_time': '17:00:00'},
    {'day_of_week': 2, 'start_time': '16:00:00', 'end_time': '17:00:00'},
    {'day_of_week': 3, 'start_time': '16:00:00', 'end_time': '17:00:00'},
    {'day_of_week': 4, 'start_time': '16:00:00', 'end_time': '17:00:00'},
    {'day_of_week': 5, 'start_time': '16:00:00', 'end_time': '17:00:00'},
]
missing = [row for row in required_slots if (row['day_of_week'], row['start_time'], row['end_time']) not in existing_keys]
if missing:
    resp = client.table('time_slots').insert(missing).execute()
    print(f'inserted_slots={len(resp.data)}')
else:
    print('inserted_slots=0')

faculties = select_all('faculty', 'id')
slots = select_all('time_slots', 'id')
existing_availability = select_all('faculty_availability', 'faculty_id,time_slot_id')
existing_pairs = {(row['faculty_id'], row['time_slot_id']) for row in existing_availability}
rows = []
for faculty in faculties:
    faculty_id = faculty['id']
    for slot in slots:
        pair = (faculty_id, slot['id'])
        if pair in existing_pairs:
            continue
        rows.append({'faculty_id': faculty_id, 'time_slot_id': slot['id'], 'available': True})

print(f'rows_to_insert={len(rows)}')
for i in range(0, len(rows), 200):
    batch = rows[i:i + 200]
    response = client.table('faculty_availability').insert(batch).execute()
    print(f'batch_{i}={len(response.data)}')

final_slots = select_all('time_slots', 'id')
final_availability = select_all('faculty_availability', 'id')
print(f'final_slot_count={len(final_slots)}')
print(f'final_availability_count={len(final_availability)}')
