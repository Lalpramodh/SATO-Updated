import test from 'node:test';
import assert from 'node:assert/strict';

import { DAYS, calculateTimetableLayout, makeLanes, normalizeSessions } from './timetableLayout.js';

test('DAYS always contains all five weekday columns', () => {
  assert.deepEqual(DAYS, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  assert.deepEqual(calculateTimetableLayout([]), []);
});

test('single sessions occupy one deterministic lane', () => {
  const [session] = makeLanes([{ id: 'single', day: 'Wednesday', startTime: '09:00', endTime: '10:00' }]);
  assert.equal(session.lane, 0);
  assert.equal(session.laneCount, 1);
});

test('three simultaneous sessions receive three readable lanes', () => {
  const lanes = makeLanes([
    { id: 'A', day: 'Tuesday', startTime: '10:00', endTime: '11:00' },
    { id: 'B', day: 'Tuesday', startTime: '10:00', endTime: '11:00' },
    { id: 'C', day: 'Tuesday', startTime: '10:00', endTime: '11:00' },
  ]);
  assert.deepEqual(lanes.map((session) => session.lane), [0, 1, 2]);
  assert.ok(lanes.every((session) => session.laneCount === 3));
});

test('a two-hour session and following hour share a lane without overlap', () => {
  const lanes = makeLanes([
    { id: 'long', day: 'Friday', startTime: '14:00', endTime: '16:00', duration: 2 },
    { id: 'next', day: 'Friday', startTime: '16:00', endTime: '17:00', duration: 1 },
  ]);
  assert.deepEqual(lanes.map((session) => session.lane), [0, 0]);
  assert.equal(lanes.find((session) => session.id === 'long').rowSpan, 2);
  assert.equal(lanes.find((session) => session.id === 'next').rowSpan, 1);
});

test('makeLanes assigns non-overlapping lanes while keeping 2-hour blocks contiguous', () => {
  const sessions = [
    { id: 'A', day: 'Monday', startTime: '09:00', endTime: '11:00', duration: 2 },
    { id: 'B', day: 'Monday', startTime: '10:30', endTime: '12:30', duration: 2 },
    { id: 'C', day: 'Monday', startTime: '11:15', endTime: '13:15', duration: 2 },
    { id: 'D', day: 'Monday', startTime: '09:00', endTime: '10:00', duration: 1 },
  ];

  const lanes = makeLanes(sessions);

  assert.deepEqual(lanes.map((session) => session.lane), [0, 1, 0, 1]);
  assert.equal(lanes.find((session) => session.id === 'A').rowSpan, 2);
  assert.equal(lanes.find((session) => session.id === 'C').lane, 0);

  const starts = lanes.map((session) => session.startTime);
  assert.deepEqual(starts, ['09:00', '10:30', '11:15', '09:00']);
});

test('normalizeSessions merges continuation rows and preserves a 2-hour block as one visual session', () => {
  const entries = [
    { id: 's1', courseId: 'c1', facultyId: 'f1', groupId: 'g1', roomId: 'r1', day: 'Monday', time: '09:00', endTime: '10:00', duration: 1, code: 'CS101', name: 'Algorithms', type: 'Theory', faculty: 'Dr. Singh', group: 'CSE-A', room: 'A101', roomType: 'classroom', capacity: 60 },
    { id: 's2', courseId: 'c1', facultyId: 'f1', groupId: 'g1', roomId: 'r1', day: 'Monday', time: '10:00', endTime: '11:00', duration: 1, code: 'CS101', name: 'Algorithms', type: 'Theory', faculty: 'Dr. Singh', group: 'CSE-A', room: 'A101', roomType: 'classroom', capacity: 60 },
  ];

  const normalized = normalizeSessions(entries, []);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].duration, 2);
  assert.equal(normalized[0].endTime, '11:00');
});

test('normalizeSessions infers a 2-hour span from one persisted row', () => {
  const normalized = normalizeSessions([{ id: 'single', day: 'Tuesday', time: '14:00', endTime: '16:00' }]);
  assert.equal(normalized[0].duration, 2);
});
