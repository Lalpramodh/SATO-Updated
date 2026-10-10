import { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronDown, CircleAlert, Download, Filter, Gauge, Layers3, Search, Users, X, Zap } from 'lucide-react';
import { DAYS, dayNamesByIndex, makeLanes, normalizeSessions, minutes } from './timetableLayout';

function typeClass(type) {
  return String(type || 'session').toLowerCase().replace(/\s+/g, '-');
}

const csvColumns = ['Academic Year', 'Semester', 'Day', 'Start Time', 'End Time', 'Duration', 'Course Code', 'Course Name', 'Course Type', 'Faculty', 'Student Group', 'Room', 'Room Type', 'Room Capacity'];

function csvValue(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function SelectFilter({ label, value, onChange, options }) {
  return <label className="timetable-filter"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14}/></label>;
}

export default function TimetablePage({ data, live, backendStatus = 'ready', department = 'All departments', onDepartmentChange = () => {}, onEntry, navigate, notify }) {
  const [group, setGroup] = useState('All groups');
  const [faculty, setFaculty] = useState('All faculty');
  const [room, setRoom] = useState('All rooms');
  const [day, setDay] = useState('All days');
  const [query, setQuery] = useState('');
  const semester = data?.timetable?.semester || 3;
  const academicYear = data?.timetable?.academic_year || '2026–27';
  useEffect(() => {
    onDepartmentChange('All departments');
    setGroup('All groups');
    setFaculty('All faculty');
    setRoom('All rooms');
    setDay('All days');
    setQuery('');
  }, [data?.timetable?.id, semester, onDepartmentChange]);
  useEffect(() => {
    setGroup('All groups');
  }, [department]);
  const sessions = useMemo(() => normalizeSessions(data.entries || [], data.timeSlots || []), [data.entries, data.timeSlots]);
  const departmentSessions = useMemo(() => sessions.filter((session) => department === 'All departments' || session.department === department), [sessions, department]);
  const options = (key, all) => [all, ...new Set(departmentSessions.map((session) => session[key]).filter(Boolean))];
  const filtered = useMemo(() => sessions.filter((session) =>
    (department === 'All departments' || session.department === department) &&
    (group === 'All groups' || session.group === group) &&
    (faculty === 'All faculty' || session.faculty === faculty) &&
    (room === 'All rooms' || session.room === room) &&
    (day === 'All days' || session.day === day) &&
    `${session.code} ${session.name} ${session.faculty} ${session.group} ${session.room}`.toLowerCase().includes(query.toLowerCase())
  ), [sessions, department, group, faculty, room, day, query]);
  const roomsUsed = new Set(filtered.map((session) => session.room)).size;
  const timeRows = (data.timeSlots || [])
    .map((slot) => ({ ...slot, day_name: slot.day_name || dayNamesByIndex()[slot.day_of_week] }))
    .filter((slot) => DAYS.includes(slot.day_name))
    .sort((left, right) => minutes(left.start_time) - minutes(right.start_time));
  const fallbackTimes = ['09:00', '10:00', '11:15', '12:15', '14:00', '15:00', '16:00'];
  const uniqueTimes = fallbackTimes.map((startTime) => timeRows.find((slot) => String(slot.start_time).slice(0, 5) === startTime) || { id: startTime, start_time: startTime, end_time: '' });
  const sessionsByDay = Object.fromEntries(DAYS.map((name) => [name, makeLanes(filtered.filter((session) => session.day === name))]));
  const scopeLabel = group !== 'All groups' ? `${department === 'All departments' ? 'All Departments' : department} · ${group}` : department === 'All departments' ? 'All Departments' : department;
  const clearFilters = () => { setDepartment('All departments'); setGroup('All groups'); setFaculty('All faculty'); setRoom('All rooms'); setDay('All days'); setQuery(''); };
  const exportCsv = () => {
    if (!data?.timetable || !filtered.length) {
      notify(filtered.length ? 'No timetable loaded.' : 'No sessions match the active filters.');
      return;
    }
    const rows = filtered.map((session) => [
      data.timetable.academic_year,
      data.timetable.semester,
      session.day,
      session.startTime,
      session.endTime,
      session.duration,
      session.code,
      session.name,
      session.type,
      session.faculty,
      session.group,
      session.room,
      session.roomType,
      session.capacity,
    ].map(csvValue).join(','));
    const csv = [csvColumns.join(','), ...rows].join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `timetable_${data.timetable.academic_year}_semester-${data.timetable.semester}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`Exported ${filtered.length} filtered sessions.`);
  };

  if (backendStatus === 'connecting' || !live) return <section className="timetable-empty panel"><Activity className="spin" size={24}/><h2>Loading timetable...</h2><p>Fetching persisted timetable data.</p></section>;

  return <>
    <div className="timetable-page-header"><div><div className="eyebrow">ACADEMIC OPERATIONS / WEEKLY VIEW</div><h1>Weekly Timetable</h1><p>{academicYear} · Semester {semester} · {scopeLabel} · Live persisted schedule</p></div><div className="timetable-header-actions"><span className="live-chip"><i/> Live backend data</span><button className="button" onClick={exportCsv}><Download size={15}/> Export CSV</button><button className="button primary" onClick={() => navigate('generate')}><Zap size={15}/> Generate / Re-optimize</button></div></div>
    <div className="timetable-controls panel"><div className="timetable-selectors"><SelectFilter label="Department" value={department} onChange={onDepartmentChange} options={['All departments', ...(data.departments || []).map((item) => item.code || item.short_name || item.name)]}/><SelectFilter label="Student group" value={group} onChange={setGroup} options={options('group', 'All groups')}/><SelectFilter label="Faculty" value={faculty} onChange={setFaculty} options={options('faculty', 'All faculty')}/><SelectFilter label="Room" value={room} onChange={setRoom} options={options('room', 'All rooms')}/><SelectFilter label="Day" value={day} onChange={setDay} options={['All days', ...DAYS]}/></div><div className="timetable-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search course, faculty, group or room"/><button className="icon-button" onClick={clearFilters} aria-label="Clear timetable filters"><X size={15}/></button></div></div>
    <div className="timetable-summary"><Summary icon={CalendarDays} label="Total sessions" value={data.entries.length}/><Summary icon={Gauge} label="Optimization score" value={data.timetable.optimization_score}/><Summary icon={CircleAlert} label="Conflicts" value={data.timetable.total_conflicts}/><Summary icon={Layers3} label="Rooms used" value={roomsUsed}/></div>
    <section className="weekly-panel panel"><div className="weekly-heading"><div><span className="eyebrow">WEEKLY SCHEDULE</span><h2>Semester {semester} timetable</h2><p>{filtered.length} visual sessions from {data.entries.length} persisted timetable rows</p></div><span className="filter-result"><Filter size={14}/> Filters update locally</span></div><div className="weekly-scroll"><div className="weekly-board"><div className="weekly-time-head">TIME</div>{DAYS.map((name) => <div className="weekly-day-head" key={name}>{name}<small>{sessionsByDay[name].length} sessions</small></div>)}<div className="weekly-time-column">{uniqueTimes.map((slot) => <div className="weekly-time-label" key={slot.id || slot.start_time}><strong>{String(slot.start_time).slice(0, 5)}</strong><span>{String(slot.end_time).slice(0, 5)}</span></div>)}</div>{DAYS.map((name) => <DayColumn key={name} sessions={sessionsByDay[name]} timeRows={uniqueTimes} onEntry={onEntry}/>)}</div></div></section>
  </>;
}

function Summary({ icon: Icon, label, value }) {
  return <div className="timetable-summary-card"><span className="summary-icon"><Icon size={17}/></span><div><small>{label}</small><strong>{value}</strong></div></div>;
}

function DayColumn({ sessions, timeRows, onEntry }) {
  const laneCount = Math.max(1, ...sessions.map((session) => session.lane + 1));
  return <div className="weekly-day-column" style={{ '--lane-count': laneCount, gridTemplateRows: `repeat(${timeRows.length}, var(--timetable-row-height))`, gridTemplateColumns: `repeat(${laneCount}, minmax(0, 1fr))` }}>
    <div className="day-grid-lines">{timeRows.map((slot) => <span key={slot.id || slot.start_time}/>)}</div>
    {sessions.map((session) => {
      const row = timeRows.findIndex((slot) => String(slot.start_time).slice(0, 5) === session.startTime);
      const rowStart = Math.max(0, row) + 1;
      const rowSpan = Math.max(1, Number(session.rowSpan) || session.duration || 1);
      return <button key={`${session.id}-${session.startTime}`} className={`weekly-session ${typeClass(session.type)}`} title={`${session.code} · ${session.name}`} style={{ gridColumn: `${session.lane + 1} / span 1`, gridRow: `${rowStart} / span ${rowSpan}`, margin: rowSpan === 1 ? '2px 0' : 0 }} onClick={() => onEntry(session)}><span className="session-type">{session.type}</span><strong>{session.code}</strong><span className="session-name">{session.name}</span><small>{session.faculty}</small><small>{session.room} · {session.group}</small><em>{session.startTime}–{session.endTime}{rowSpan > 1 ? ' · 2 hours' : ''}</em></button>;
    })}
  </div>;
}
