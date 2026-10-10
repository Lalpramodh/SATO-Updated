export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export function minutes(value) {
  const [hours, minutesValue] = String(value || '').slice(0, 5).split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutesValue) ? hours * 60 + minutesValue : 0;
}

export function normalizeSessions(entries, timeSlots = []) {
  const slotsById = Object.fromEntries((timeSlots || []).map((slot) => [slot.id, slot]));

  const source = (entries || [])
    .map((entry) => {
      const slot = slotsById[entry.timeSlotId] || {};
      const startTime = entry.time || String(slot.start_time || '').slice(0, 5);
      const endTime = entry.endTime || String(slot.end_time || '').slice(0, 5);
      return {
        ...entry,
        day: entry.day || slot.day_name,
        startTime,
        endTime,
        duration: Number(entry.duration || entry.duration_hours) || Math.max(1, Math.round((minutes(endTime) - minutes(startTime)) / 60)),
      };
    })
    .filter((entry) => DAYS.includes(entry.day) && entry.startTime);

  const grouped = new Map();
  source.forEach((entry) => {
    const key = [entry.courseId, entry.facultyId, entry.groupId, entry.roomId, entry.day].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  });

  const sessions = [];
  grouped.forEach((rows) => {
    rows.sort((left, right) => minutes(left.startTime) - minutes(right.startTime));

    let current = null;
    rows.forEach((row) => {
      if (!current) {
        current = {
          ...row,
          startTime: row.startTime,
          endTime: row.endTime,
          duration: Number(row.duration) || 1,
          sourceIds: [row.id],
        };
        return;
      }

      const currentEndMinutes = minutes(current.endTime);
      const nextStartMinutes = minutes(row.startTime);

      if (nextStartMinutes === currentEndMinutes) {
        const mergedEndTime = row.endTime || current.endTime;
        current = {
          ...current,
          endTime: mergedEndTime,
          duration: Math.max(1, Math.round((minutes(mergedEndTime) - minutes(current.startTime)) / 60)),
          sourceIds: [...current.sourceIds, row.id],
        };
        return;
      }

      sessions.push(current);
      current = {
        ...row,
        startTime: row.startTime,
        endTime: row.endTime,
        duration: Number(row.duration) || 1,
        sourceIds: [row.id],
      };
    });

    if (current) {
      sessions.push(current);
    }
  });

  return sessions.sort((left, right) => DAYS.indexOf(left.day) - DAYS.indexOf(right.day) || minutes(left.startTime) - minutes(right.startTime));
}

export function calculateTimetableLayout(sessions = []) {
  const dayNames = DAYS;
  const layoutByDay = new Map();

  dayNames.forEach((day) => {
    const daySessions = [...(sessions || [])]
      .filter((session) => session.day === day)
      .map((session, originalIndex) => ({ session, originalIndex }))
      .sort((left, right) => minutes(left.session.startTime) - minutes(right.session.startTime) || minutes(right.session.endTime) - minutes(left.session.endTime) || left.originalIndex - right.originalIndex);

    const laneEnds = [];
    const dayLayout = daySessions.map(({ session, originalIndex }) => {
      const start = minutes(session.startTime);
      const end = minutes(session.endTime);
      const lane = laneEnds.findIndex((value) => value <= start);
      const assignedLane = lane >= 0 ? lane : laneEnds.length;
      laneEnds[assignedLane] = end;
      return {
        id: session.id,
        day,
        startSlot: start,
        endSlot: end,
        rowSpan: Math.max(1, Number(session.duration) || 1),
        lane: assignedLane,
        laneCount: 1,
        originalIndex,
      };
    });
    const laneCount = Math.max(1, ...dayLayout.map((item) => item.lane + 1));
    dayLayout.forEach((item) => { item.laneCount = laneCount; });
    dayLayout.sort((left, right) => left.originalIndex - right.originalIndex);

    layoutByDay.set(day, dayLayout);
  });

  return [...layoutByDay.values()].flat();
}

export function validateVisualLayout(layout = []) {
  const violations = [];
  const seen = new Set();

  for (const item of layout) {
    if (!item || !item.id) {
      violations.push('Missing session id');
      continue;
    }
    if (seen.has(item.id)) {
      violations.push(`Duplicate session: ${item.id}`);
    }
    seen.add(item.id);

    if (!Number.isFinite(item.startSlot) || !Number.isFinite(item.endSlot) || item.endSlot <= item.startSlot) {
      violations.push(`Invalid slot range for ${item.id}`);
    }
    if (item.rowSpan !== 1 && item.rowSpan !== 2) {
      violations.push(`Unexpected rowSpan for ${item.id}: ${item.rowSpan}`);
    }
    if (item.lane < 0 || item.laneCount < item.lane + 1) {
      violations.push(`Invalid lane metadata for ${item.id}`);
    }
  }

  const byDay = new Map();
  for (const item of layout) {
    if (!item) continue;
    if (!byDay.has(item.day)) byDay.set(item.day, []);
    byDay.get(item.day).push(item);
  }

  for (const [day, items] of byDay.entries()) {
    const lanes = new Map();
    for (const item of items) {
      if (!lanes.has(item.lane)) lanes.set(item.lane, []);
      lanes.get(item.lane).push(item);
    }
    for (const [lane, laneItems] of lanes.entries()) {
      const sorted = [...laneItems].sort((left, right) => left.startSlot - right.startSlot);
      for (let index = 1; index < sorted.length; index += 1) {
        const prev = sorted[index - 1];
        const current = sorted[index];
        if (current.startSlot < prev.endSlot) {
          violations.push(`Overlapping sessions on ${day} in lane ${lane}: ${prev.id} and ${current.id}`);
        }
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

export function makeLanes(sessions = []) {
  return calculateTimetableLayout(sessions).map((session) => ({
    ...sessions.find((entry) => entry.id === session.id),
    lane: session.lane,
    laneCount: session.laneCount,
    rowSpan: session.rowSpan,
  }));
}

export function dayNamesByIndex() {
  return { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday' };
}
