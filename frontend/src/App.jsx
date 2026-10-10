import { useEffect, useMemo, useState } from 'react';
import {
  Activity, BarChart3, Bell, BookOpen, CalendarDays, Check, ChevronDown, Clock3, Database, LogOut,
  Download, FlaskConical, Gauge, Grid2X2, GraduationCap, LayoutDashboard, Menu, Moon, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen, Play, Plus, RefreshCw, Search, Settings as SettingsIcon, SlidersHorizontal,
  Sparkles, Sun, Users, X, Zap, Building2, CircleAlert, ArrowUpRight
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, waitForBackend } from './api';
import TimetablePage from './TimetablePage';
import Dashboard from './Dashboard';
import AnalyticsPage from './AnalyticsPage';
import GeneratePage from './GeneratePage';
import { useAuth } from './auth/AuthContext';
import AuthGate from './auth/AuthGate';
import { days, periods } from './mockData';

const departments = [];
const faculty = [];
const groupRows = [];
const groups = [];
const courseRows = [];
const rooms = [];

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'timetable', label: 'Timetable', icon: CalendarDays },
  { id: 'generate', label: 'Generate', icon: Zap },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'faculty', label: 'Faculty', icon: Users },
  { id: 'rooms', label: 'Rooms', icon: Building2 },
  { id: 'groups', label: 'Student Groups', icon: GraduationCap },
  { id: 'courses', label: 'Courses', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function ApplicationShell() {
  const { signOut } = useAuth();
  const [page, setPage] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dark, setDark] = useState(false);
  const [drawerEntry, setDrawerEntry] = useState(null);
  const [toast, setToast] = useState('');
  const [liveData, setLiveData] = useState(null);
  const [dataState, setDataState] = useState('connecting');
  const [timetableId, setTimetableId] = useState(null);
  const [selectedSemester, setSelectedSemester] = useState(3);
  const [selectedDepartment, setSelectedDepartment] = useState('All departments');
  const semesterOptions = [3];

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    const controller = new AbortController();

    const load = async () => {
      try {
        setLiveData(null);
        setDataState('connecting');
        await waitForBackend(controller.signal);
        if (cancelled) return;

        const timetableResponse = timetableId
          ? await api.getTimetable(timetableId, controller.signal)
          : await api.getTimetables('2026-27', selectedSemester, controller.signal).then((records) => records.length
            ? api.getTimetable(records[0].id, controller.signal)
            : { timetable: { academic_year: '2026-27', semester: selectedSemester }, entries: [] });
        const effectiveSemester = Number(timetableResponse.timetable?.semester || selectedSemester);
        const [coursesResponse, departmentsResponse, facultyResponse, groupsResponse, roomsResponse, timeSlotsResponse, summaryResponse] = await Promise.all([
          api.getCourses(effectiveSemester, controller.signal),
          api.getDepartments(controller.signal),
          api.getFaculty(controller.signal),
          api.getStudentGroups(effectiveSemester, controller.signal),
          api.getRooms(controller.signal),
          api.getTimeSlots(controller.signal),
          api.getSummary(effectiveSemester, controller.signal),
        ]);

        if (cancelled) return;
        const coursesById = Object.fromEntries(coursesResponse.map((course) => [course.id, course]));
        const departmentsById = Object.fromEntries(departmentsResponse.map((department) => [department.id, department]));
        const entries = timetableResponse.entries.map((entry) => {
          const course = coursesById[entry.course_id] || {};
          const slot = entry.time_slot || {};
          return {
            id: entry.id,
            courseId: entry.course_id,
            code: entry.course?.course_code || course.course_code || 'Unknown course',
            name: entry.course?.course_name || course.course_name || 'Unknown course',
            type: course.course_type === 'lab' ? 'Lab' : course.course_type === 'theory' ? 'Theory' : course.course_type || 'Session',
            department: departmentsById[course.department_id]?.code || departmentsById[course.department_id]?.short_name || departmentsById[course.department_id]?.name || course.department_id || 'Department reference',
            faculty: entry.faculty?.name || 'Unknown faculty',
            facultyId: entry.faculty_id,
            group: entry.group?.name || 'Unknown group',
            groupId: entry.group_id,
            studentCount: entry.group?.student_count,
            room: entry.room?.name || 'Unknown room',
            roomId: entry.room_id,
            roomType: entry.room?.room_type,
            building: entry.room?.building,
            capacity: entry.room?.capacity,
            day: slot.day_name || 'Unknown day',
            time: slot.start_time?.slice(0, 5) || 'Unknown time',
            endTime: slot.end_time?.slice(0, 5) || 'Unknown time',
            duration: entry.duration_hours || course.duration_hours,
            timeSlotId: entry.time_slot_id,
          };
        });

        setLiveData({
          timetable: timetableResponse.timetable,
          entries,
          courses: coursesResponse,
          departments: departmentsResponse,
          faculty: facultyResponse,
          groups: groupsResponse,
          rooms: roomsResponse,
          timeSlots: timeSlotsResponse,
          summary: summaryResponse.summary,
        });
        setDataState('live');
      } catch (error) {
        if (cancelled || error?.name === 'AbortError') return;
        setLiveData(null);
        setDataState('connecting');
        retryTimer = window.setTimeout(() => {
          if (!cancelled) {
            load();
          }
        }, 2500);
      }
    };

    load();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      controller.abort();
    };
  }, [timetableId, selectedSemester]);

  const data = liveData || { timetable: { academic_year: '2026-27', semester: selectedSemester }, entries: [], courses: [], departments: [], faculty: [], groups: [], rooms: [], timeSlots: [], summary: {} };

  const navigate = (next) => { setPage(next); setDrawerEntry(null); };
  const openEntry = (entry) => setDrawerEntry({ ...entry, timetable: data.timetable });
  const notify = (message) => { setToast(message); window.setTimeout(() => setToast(''), 2600); };
  const refreshFaculty = async () => {
    const facultyResponse = await api.getFaculty();
    setLiveData((current) => current ? { ...current, faculty: facultyResponse } : current);
  };

    return <div className={dark ? 'app dark' : 'app'}>
    <aside className={sidebarOpen ? 'sidebar' : 'sidebar collapsed'}>
      <div className="brand"><div className="brand-mark">S</div><div className="brand-copy"><strong>SATO</strong><span>Academic optimizer</span></div><button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>{sidebarOpen ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}</button></div>
      <nav className="nav" aria-label="Primary navigation">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(id)}><Icon size={17}/><span>{label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="system-label">SYSTEM STATUS</div><div className="system-status"><span className="status-dot"/> <span>Optimizer online</span></div><div className="system-status"><Database size={14}/> <span>Database connected</span></div><div className="sidebar-footer"><div className="avatar">AP</div><div className="profile-name"><strong>Admin portal</strong><span>Operations team</span></div><button className="icon-button" onClick={() => signOut().then(() => window.history.replaceState({}, '', '/login'))} aria-label="Sign out"><LogOut size={16}/></button></div></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><div className="mobile-brand"><button className="icon-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation"><Menu size={19}/></button><div className="brand-mark small">S</div></div><div className="topbar-context"><span className="eyebrow">ACADEMIC OPERATIONS</span><strong>{navItems.find((item) => item.id === page)?.label}</strong></div><div className="topbar-actions"><div className="select-compact"><span>2026–27</span><ChevronDown size={14}/></div><div className="select-compact"><select aria-label="Semester selector" value={selectedSemester} onChange={(event) => { setSelectedSemester(Number(event.target.value)); setTimetableId(null); }}>{semesterOptions.map((semester) => <option key={semester} value={semester}>Semester {semester}</option>)}</select></div><button className="icon-button notification" aria-label="Notifications"><Bell size={18}/><i/></button><button className="icon-button theme-button" onClick={() => setDark(!dark)} aria-label="Toggle dark mode">{dark ? <Sun size={18}/> : <Moon size={18}/>}</button><div className="top-profile"><div className="avatar">AP</div><ChevronDown size={14}/></div></div></header>
      <div className="page-container">
            {dataState === 'loading' && <div className="loading-banner"><Activity className="spin" size={16}/> Loading timetable...</div>}
            {dataState === 'empty' && <div className="fallback-banner"><CircleAlert size={16}/> No persisted timetable exists for this semester. Generate one to continue.</div>}
            {page === 'overview' && <Dashboard data={data} live={dataState === 'live'} backendStatus={dataState} navigate={navigate} onEntry={openEntry} onSelectTimetable={(id) => { setTimetableId(id); setPage('timetable'); }} notify={notify}/>} 
            {page === 'timetable' && <TimetablePage data={data} live={dataState === 'live'} backendStatus={dataState} department={selectedDepartment} onDepartmentChange={setSelectedDepartment} onEntry={openEntry} navigate={navigate} notify={notify}/>} 
            {page === 'generate' && <GeneratePage navigate={navigate} notify={notify} departments={data.departments} initialSemester={selectedSemester} onSemesterChange={setSelectedSemester} onGenerated={(id) => setTimetableId(id)}/>} 
            {page === 'analytics' && <AnalyticsPage data={data} department={selectedDepartment}/>} 
            {page === 'faculty' && <FacultyDirectory data={data} onRefresh={refreshFaculty} notify={notify}/>} 
            {page === 'rooms' && <Directory title="Room inventory" subtitle="Track learning spaces, capacity, and timetable utilization." icon={Building2} columns={['Room', 'Type', 'Location', 'Capacity', 'Utilization', 'Status']} rows={(liveData?.rooms || rooms).map((item) => [item.name, item.room_type || item.type, `${item.building || '—'}, Floor ${item.floor || '—'}`, item.capacity, item.utilization ? `${item.utilization}%` : '—', item.status || 'Ready'])}/>} 
            {page === 'groups' && <Directory title="Student groups" subtitle="Review cohorts, departments, semesters, and enrollment sizes." icon={GraduationCap} columns={['Group', 'Department', 'Semester', 'Students', 'Status']} rows={(data.groups || []).map((item) => [item.name, item.department_id || item.department || '—', item.semester ?? '—', item.student_count ?? item.size ?? '—', 'Active'])}/>} 
            {page === 'courses' && <Directory title="Course catalog" subtitle="Browse the courses available for the selected semester." icon={BookOpen} columns={['Course code', 'Course name', 'Type', 'Department', 'Semester', 'Credits']} rows={(data.courses || []).map((item) => [item.course_code, item.course_name, item.course_type || '—', item.department_id || item.department || '—', item.semester ?? '—', item.credits ?? '—'])}/>} 
            {page === 'settings' && <Settings/>} 
      </div>
</main>
    {drawerEntry && <DetailDrawer entry={drawerEntry} close={() => setDrawerEntry(null)}/>} {toast && <div className="toast"><Check size={16}/>{toast}</div>}
  </div>;
}

function PageHeader({ eyebrow, title, subtitle, actions }) { return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div><div className="page-actions">{actions}</div></div>; }
function Button({ children, primary = false, icon: Icon, onClick, className = '' }) { return <button className={primary ? `button primary ${className}` : `button ${className}`} onClick={onClick}>{Icon && <Icon size={16}/>}<span>{children}</span></button>; }
function MetricCard({ icon: Icon, label, value, detail, tone = 'cyan' }) { return <div className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18}/></div><div className="metric-content"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div><ArrowUpRight className="metric-arrow" size={15}/></div>; }
function StatusBadge({ children, tone = 'success' }) { return <span className={`status-badge ${tone}`}><i/>{children}</span>; }

function Overview({ data, live, navigate, onEntry }) {
  const stats = data.timetable;
  const summary = data.summary || {};
  const entryCount = data.entries.length;
  const courseCount = summary.courses || new Set(data.entries.map((entry) => entry.code)).size;
  const groupCount = summary.student_groups || new Set(data.entries.map((entry) => entry.group)).size;
  return <><PageHeader eyebrow="Overview / Academic operations" title="Scheduling command center" subtitle="Monitor timetable quality, utilization, and scheduling operations from one place." actions={<><Button icon={RefreshCw} onClick={() => window.location.reload()}>Refresh data</Button><Button primary icon={Plus} onClick={() => navigate('generate')}>New timetable</Button></>}/>
    <div className="welcome-strip"><div><span className="welcome-kicker"><Sparkles size={14}/> Good morning, admin</span><h2>Academic Scheduling Overview</h2><p>{live ? `Live Semester ${stats.semester ?? 3} data is connected and ready for operational review.` : 'Development data is shown while the backend is unavailable.'}</p></div><div className="welcome-meta"><span className="status-dot"/> {live ? 'Live from Supabase' : 'Offline development mode'}</div></div>
    <div className="metrics-grid"><MetricCard icon={Gauge} label="Optimization score" value={stats.optimization_score ?? '—'} detail="Excellent schedule health" tone="cyan"/><MetricCard icon={CircleAlert} label="Total conflicts" value={stats.total_conflicts ?? '—'} detail="All constraints satisfied" tone="green"/><MetricCard icon={BookOpen} label="Scheduled courses" value={courseCount} detail="Across live course data" tone="blue"/><MetricCard icon={Grid2X2} label="Timetable entries" value={entryCount} detail="Persisted sessions" tone="purple"/><MetricCard icon={Users} label="Student groups" value={groupCount} detail={`Semester ${stats.semester ?? 3} cohorts`} tone="amber"/><MetricCard icon={Clock3} label="Generation time" value={stats.generation_time_ms ? `${(stats.generation_time_ms / 1000).toFixed(1)}s` : '—'} detail="CP-SAT optimization" tone="slate"/></div>
    <div className="overview-grid"><OptimizationHealth data={stats}/><section className="panel preview-panel"><div className="panel-heading"><div><span className="eyebrow">Persisted schedule</span><h3>Timetable preview</h3></div><button className="text-button" onClick={() => navigate('timetable')}>Open full timetable <ArrowUpRight size={15}/></button></div><MiniSchedule entries={data.entries} onEntry={onEntry}/></section></div>
    <div className="bottom-grid"><section className="panel compact-panel"><div className="panel-heading"><div><span className="eyebrow">Validation status</span><h3>Conflict center</h3></div><StatusBadge>Validated</StatusBadge></div><div className="validation-row"><Validation label="Faculty"/><Validation label="Rooms"/><Validation label="Groups"/><Validation label="Availability"/><Validation label="Capacity"/></div><div className="healthy-callout"><div className="healthy-icon"><Check size={16}/></div><div><strong>{stats.total_conflicts === 0 ? 'No scheduling conflicts' : 'Conflicts require review'}</strong><span>Backend timetable metadata reports {stats.total_conflicts ?? 'unknown'} total conflicts.</span></div></div></section><section className="panel compact-panel utilization-panel"><div className="panel-heading"><div><span className="eyebrow">Capacity snapshot</span><h3>Room inventory</h3></div><button className="icon-button"><MoreHorizontal size={18}/></button></div>{live ? <div className="healthy-callout"><div className="healthy-icon"><Building2 size={16}/></div><div><strong>{summary.rooms ?? '—'} rooms connected</strong><span>Detailed utilization is not exposed by the current API.</span></div></div> : rooms.slice(0, 3).map((room) => <div className="utilization-row" key={room.name}><div><strong>{room.name}</strong><span>{room.type}</span></div><div className="progress"><i style={{ width: `${room.utilization}%` }}/></div><b>{room.utilization}%</b></div>)}</section></div>
  </>;
}
function Timetable({ data, live, onEntry, notify }) {
  const [department, setDepartment] = useState('All departments'); const [course, setCourse] = useState('All courses'); const [facultyFilter, setFacultyFilter] = useState('All faculty'); const [group, setGroup] = useState('All groups'); const [room, setRoom] = useState('All rooms'); const [day, setDay] = useState('All days'); const [query, setQuery] = useState('');
  const entries = data.entries || [];
  const departmentOptions = live ? ['All departments', ...data.departments.map((item) => item.name)] : departments;
  const unique = (key) => [...new Set(entries.map((entry) => entry[key]).filter(Boolean))];
  const filtered = useMemo(() => entries.filter((entry) => (department === 'All departments' || entry.department === department) && (course === 'All courses' || entry.code === course) && (facultyFilter === 'All faculty' || entry.faculty === facultyFilter) && (group === 'All groups' || entry.group === group) && (room === 'All rooms' || entry.room === room) && (day === 'All days' || entry.day === day) && `${entry.code} ${entry.name} ${entry.faculty} ${entry.room} ${entry.group}`.toLowerCase().includes(query.toLowerCase())), [entries, department, course, facultyFilter, group, room, day, query]);
  const select = (value, setter, options) => <select value={value} onChange={(event) => setter(event.target.value)}>{options.map((item) => <option key={item}>{item}</option>)}</select>;
  const semester = data?.timetable?.semester || 3;
  return <><PageHeader eyebrow={`Timetable / 2026–27 / Semester ${semester}`} title="Timetable" subtitle="A conflict-free view of the generated schedule from the backend." actions={<><Button icon={Download} onClick={() => notify('Export options are ready for backend integration')}>Export</Button><Button primary icon={Zap} onClick={() => notify('Open Generate to run a new optimization')}>Generate</Button></>}/><section className="panel timetable-panel"><div className="filter-bar"><div className="search-field"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search live timetable"/></div>{select(department, setDepartment, departmentOptions)}{select(course, setCourse, ['All courses', ...unique('code')])}{select(facultyFilter, setFacultyFilter, ['All faculty', ...unique('faculty')])}{select(group, setGroup, live ? ['All groups', ...unique('group')] : groups)}{select(room, setRoom, ['All rooms', ...unique('room')])}{select(day, setDay, ['All days', ...unique('day')])}<span className="result-count">{filtered.length} of {entries.length} sessions</span></div><div className="table-meta"><div><strong>{live ? 'Persisted sessions' : 'Development schedule'}</strong><span>{live ? `Showing all ${data.entries.length} records from timetable ${data.timetable.id}` : 'Showing development data while the backend is unavailable'}</span></div><div className="view-toggle"><button className="active">Week view</button></div></div><ScheduleGrid entries={filtered} onEntry={onEntry} live={live} semester={semester}/></section></>;
}
function ScheduleGrid({ entries, onEntry, live, semester = 3 }) { if (live) { const actualDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']; const actualTimes = [...new Set(entries.map((entry) => entry.time).filter((time) => time !== 'Unknown time'))].sort(); return <div className="schedule-scroll"><div className="schedule-grid live-schedule-grid"><div className="schedule-corner">LIVE WEEK <span>Semester {semester}</span></div>{actualDays.map((day) => <div className="schedule-day-head" key={day}><strong>{day}</strong><span>Real time slots</span></div>)}{actualTimes.map((time) => <><div className="schedule-time" key={`${time}-time`}><strong>{time}</strong><span>Persisted</span></div>{actualDays.map((day) => { const cellEntries = entries.filter((entry) => entry.day === day && entry.time === time); return <div className="schedule-cell" key={`${day}-${time}`}>{cellEntries.slice(0, 3).map((entry) => <button key={entry.id} className={`schedule-card ${entry.type.toLowerCase()}`} onClick={() => onEntry(entry)}><span className="card-type">{entry.type}</span><strong>{entry.code}</strong><span>{entry.name}</span><small>{entry.room} · {entry.group}</small><em>{entry.faculty}</em></button>)}{cellEntries.length > 3 && <small className="cell-count">+{cellEntries.length - 3} more sessions</small>}</div> })}</>)}</div></div>; } return <div className="schedule-scroll"><div className="schedule-grid"><div className="schedule-corner">WEEK 39 <span>2026</span></div>{days.map((day) => <div className="schedule-day-head" key={day}><strong>{day}</strong><span>Semester {semester}</span></div>)}{periods.map((period) => <><div className="schedule-time" key={`${period}-time`}><strong>{period}</strong><span>{period === '14:00' ? 'Afternoon' : 'Morning'}</span></div>{days.map((day) => { const entry = entries.find((item) => item.day === day && item.time === period); return <div className="schedule-cell" key={`${day}-${period}`}>{entry && <button className={`schedule-card ${entry.type.toLowerCase()}`} onClick={() => onEntry(entry)}><span className="card-type">{entry.type}</span><strong>{entry.code}</strong><span>{entry.name}</span><small>{entry.room} · {entry.group}</small><em>{entry.faculty}</em></button>}</div> })}</>)}</div></div>; }

function Generate({ navigate, notify, onGenerated }) { const [running, setRunning] = useState(false); const [done, setDone] = useState(false); const [result, setResult] = useState(null); const [error, setError] = useState(''); const [semester, setSemester] = useState(3); const run = async () => { setRunning(true); setDone(false); setError(''); try { const response = await api.generateTimetable({ academic_year: '2026-27', semester }); setResult(response); setDone(Boolean(response.success)); if (response.success) { notify('Timetable generated successfully'); onGenerated(response.timetable_id); } else setError(response.error || 'Timetable generation could not be completed.'); } catch { setError('Unable to connect to the scheduling engine.'); } finally { setRunning(false); } }; return <><PageHeader eyebrow="Optimizer / New run" title="Generate optimized timetable" subtitle="Configure academic constraints and let the scheduling engine find a conflict-free schedule." actions={<StatusBadge>Engine ready</StatusBadge>}/><div className="generate-layout"><section className="panel config-panel"><div className="panel-heading"><div><span className="eyebrow">Configuration</span><h3>Schedule parameters</h3></div><SlidersHorizontal size={18}/></div><div className="form-grid"><label>Academic year<select defaultValue="2026-27"><option>2026-27</option></select></label><label>Semester<select value={semester} onChange={(event) => setSemester(Number(event.target.value))}>{Array.from({ length: 8 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Department<select defaultValue="All departments"><option>All departments</option><option>CSE</option><option>ECE</option></select></label><label>Student group<select defaultValue="All groups"><option>All groups</option><option>CSE-Y2-S3-A</option></select></label></div><div className="advanced-row"><div><strong>Advanced constraints</strong><span>Faculty availability, room capacity, and duration rules are always enforced.</span></div><button className="switch" aria-label="Advanced constraints enabled"><i/></button></div><Button primary icon={Play} className="generate-button" onClick={run}>Generate timetable</Button>{error && <div className="error-callout"><CircleAlert size={16}/>{error}</div>}</section><section className="panel workflow-panel"><div className="panel-heading"><div><span className="eyebrow">Optimization workflow</span><h3>{running ? 'Finding the best schedule' : done ? 'Run complete' : 'Ready when you are'}</h3></div><Activity className={running ? 'spin' : ''} size={19}/></div>{['Preparing academic data', 'Loading faculty availability', 'Building scheduling model', 'Applying hard constraints', 'Optimizing timetable', 'Validating schedule', 'Persisting timetable'].map((step, index) => <div className={index < (running ? 4 : done ? 7 : 0) ? 'workflow-step complete' : index === 4 && running ? 'workflow-step current' : 'workflow-step'} key={step}><span className="workflow-icon">{index < (running ? 4 : done ? 7 : 0) ? <Check size={14}/> : index === 4 && running ? <span className="pulse"/> : <span>{String(index + 1).padStart(2, '0')}</span>}</span><span>{step}</span>{index < (running ? 4 : done ? 7 : 0) && <small>Complete</small>}</div>)}</section></div>{done && <section className="result-panel"><div className="result-icon"><Check size={24}/></div><div><span className="eyebrow">Timetable generated</span><h2>Semester {semester} is optimized and ready.</h2><p>Timetable ID: {result.timetable_id}</p></div><div className="result-metrics"><div><span>Score</span><strong>{result.optimization_score}</strong></div><div><span>Conflicts</span><strong>{result.total_conflicts}</strong></div><div><span>Entries</span><strong>{result.entries_created}</strong></div><div><span>Time</span><strong>{(result.generation_time_ms / 1000).toFixed(1)}s</strong></div></div><div className="result-actions"><Button onClick={() => navigate('timetable')}>View timetable</Button><Button onClick={() => navigate('analytics')}>Analytics</Button></div></section>}</>; }

function ChartCard({ title, eyebrow, children }) { return <section className="panel chart-card"><div className="panel-heading"><div><span className="eyebrow">{eyebrow}</span><h3>{title}</h3></div><button className="icon-button"><MoreHorizontal size={18}/></button></div>{children}</section>; }

function Directory({ title, subtitle, icon: Icon, columns, rows, actions }) { const [query, setQuery] = useState(''); const filtered = rows.filter((row) => row.join(' ').toLowerCase().includes(query.toLowerCase())); return <><PageHeader eyebrow="Operations / Directory" title={title} subtitle={subtitle} actions={<>{actions}<Button icon={Download}>Export</Button></>}/><section className="panel directory-panel"><div className="directory-tools"><div className="directory-title"><div className="directory-icon"><Icon size={18}/></div><div><strong>Live records</strong><span>Connected to the SATO data model</span></div></div><div className="search-field"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records"/></div></div><div className="data-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{filtered.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cellIndex === row.length - 1 && ['Available', 'Ready'].includes(cell) ? <StatusBadge>{cell}</StatusBadge> : cellIndex === 3 && typeof cell === 'number' ? <strong>{cell}</strong> : cell}</td>)}</tr>)}</tbody></table></div></section></>; }

function FacultyDirectory({ data, onRefresh, notify }) {
  const [open, setOpen] = useState(false);
  const departments = data.departments || [];
  const departmentName = (departmentId) => departments.find((item) => String(item.id) === String(departmentId))?.code || departments.find((item) => String(item.id) === String(departmentId))?.name || departmentId || '—';
  const rows = (data.faculty || []).map((item) => [item.name, departmentName(item.department_id), item.email, item.max_hours_per_week ? `${item.max_hours_per_week} hrs max` : '—', 'Available']);
  return <><Directory title="Faculty directory" subtitle="Monitor teaching capacity and availability across the institution." icon={Users} columns={['Faculty', 'Department', 'Email', 'Scheduled hours', 'Availability']} rows={rows} actions={<Button primary icon={Plus} onClick={() => setOpen(true)}>Add Faculty</Button>}/>{open && <AddFacultyModal departments={departments} close={() => setOpen(false)} onRefresh={onRefresh} notify={notify}/>}</>;
}

function AddFacultyModal({ departments, close, onRefresh, notify }) {
  const [form, setForm] = useState({ employee_code: '', name: '', email: '', department_id: '', semester: '3', course_id: '', max_hours_per_week: '16' });
  const [courses, setCourses] = useState([]);
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  useEffect(() => {
    setForm((current) => ({ ...current, course_id: '' }));
    setCourses([]);
    if (!form.department_id) return undefined;
    const controller = new AbortController();
    setLoadingCourses(true);
    api.getCourses(Number(form.semester), controller.signal)
      .then((items) => setCourses(items.filter((item) => String(item.department_id) === String(form.department_id))))
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(`Unable to load subjects: ${requestError.message}`);
      })
      .finally(() => setLoadingCourses(false));
    return () => controller.abort();
  }, [form.department_id, form.semester]);
  const submit = async (event) => {
    event.preventDefault();
    if (!form.course_id) {
      setError('Please select a subject.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await api.addFaculty({ ...form, semester: Number(form.semester), max_hours_per_week: Number(form.max_hours_per_week) });
      await onRefresh();
      notify(response.message || 'Faculty added successfully');
      close();
    } catch (requestError) {
      setError(requestError.message || 'Unable to add faculty. Please check the details and try again.');
    } finally {
      setSaving(false);
    }
  };
  return <div className="modal-backdrop" onClick={close}><section className="faculty-modal panel" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">Faculty directory</span><h2>Add Faculty</h2></div><button className="icon-button" onClick={close} aria-label="Close add faculty dialog"><X size={18}/></button></div><form onSubmit={submit}><div className="faculty-form-grid"><label>Employee code<input required value={form.employee_code} onChange={update('employee_code')} placeholder="CSE-FAC-106"/></label><label>Full name<input required value={form.name} onChange={update('name')} placeholder="Dr. A. Kumar"/></label><label>Email<input required type="email" value={form.email} onChange={update('email')} placeholder="faculty@college.edu"/></label><label>Department<select required value={form.department_id} onChange={update('department_id')}><option value="">Select department</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.code || item.short_name || item.name}</option>)}</select></label><label>Semester<select required value={form.semester} onChange={update('semester')}>{[3].map((value) => <option key={value} value={value}>Semester {value}</option>)}</select></label><label>Subject/Course<select required value={form.course_id} disabled={!form.department_id || loadingCourses} onChange={update('course_id')}><option value="">{loadingCourses ? 'Loading subjects...' : 'Select subject'}</option>{courses.map((item) => <option key={item.id} value={item.id}>{item.course_code} — {item.course_name}</option>)}</select></label><label>Maximum hours per week<input required type="number" min="1" max="168" value={form.max_hours_per_week} onChange={update('max_hours_per_week')}/></label></div>{error && <div className="error-callout"><CircleAlert size={16}/>{error}</div>}<div className="modal-actions"><button type="button" className="button" onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving...' : 'Add Faculty'}</button></div></form></section></div>;
}

function Settings() { return <><PageHeader eyebrow="Workspace / Settings" title="Settings" subtitle="Control workspace preferences and API connection behavior."/><div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><span className="eyebrow">Workspace</span><h3>Academic defaults</h3></div></div>{[['Default academic year', '2026-27'], ['Default semester', '3'], ['Timezone', 'Asia/Kolkata']].map(([label, value]) => <label className="setting-field" key={label}>{label}<select defaultValue={value}><option>{value}</option></select></label>)}<div className="setting-toggle"><div><strong>Compact timetable density</strong><span>Fit more sessions into the weekly grid.</span></div><button className="switch"><i/></button></div></section><section className="panel settings-panel"><div className="panel-heading"><div><span className="eyebrow">Integrations</span><h3>System connections</h3></div></div><div className="connection"><div className="connection-icon"><Database size={17}/></div><div><strong>Supabase data service</strong><span>Configured through the backend API</span></div><StatusBadge>Connected</StatusBadge></div><div className="connection"><div className="connection-icon cyan"><Activity size={17}/></div><div><strong>Optimization engine</strong><span>OR-Tools CP-SAT scheduler</span></div><StatusBadge>Online</StatusBadge></div></section></div></>; }

function DetailDrawer({ entry, close }) { const timetable = entry.timetable || {}; return <div className="drawer-backdrop" onClick={close}><aside className="detail-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-header"><div><span className="eyebrow">Session detail</span><h2>{entry.code}</h2></div><button className="icon-button" onClick={close} aria-label="Close detail drawer"><X size={19}/></button></div><div className="drawer-course"><span className={`course-mark ${entry.type.toLowerCase()}`}>{entry.type === 'Lab' ? <FlaskConical size={17}/> : <BookOpen size={17}/>}</span><div><strong>{entry.name}</strong><span>{entry.type} · {entry.department}</span></div></div><div className="drawer-detail-grid"><div><span>Course code</span><strong>{entry.code}</strong></div><div><span>Course type</span><strong>{entry.type}</strong></div><div><span>Department</span><strong>{entry.department}</strong></div><div><span>Semester</span><strong>{timetable.semester ?? '—'}</strong></div><div><span>Faculty</span><strong>{entry.faculty}</strong></div><div><span>Student group</span><strong>{entry.group}</strong></div><div><span>Student count</span><strong>{entry.studentCount ?? '—'}</strong></div><div><span>Room</span><strong>{entry.room}</strong></div><div><span>Building</span><strong>{entry.building ?? '—'}</strong></div><div><span>Capacity</span><strong>{entry.capacity ?? '—'}</strong></div><div><span>Day</span><strong>{entry.day}</strong></div><div><span>Time</span><strong>{entry.time}–{entry.endTime}</strong></div><div><span>Duration</span><strong>{entry.duration} hr</strong></div></div><div className="drawer-valid"><Check size={17}/><div><strong>Valid schedule</strong><span>All faculty, room, group, and availability constraints pass.</span></div></div><div className="drawer-meta"><span>Timetable status</span><strong>{timetable.status ?? '—'}</strong><span>Academic year / semester</span><strong>{timetable.academic_year ?? '—'} / {timetable.semester ?? '—'}</strong><span>Optimization score / conflicts</span><strong>{timetable.optimization_score ?? '—'} / {timetable.total_conflicts ?? '—'}</strong></div><div className="drawer-footer"><Button onClick={close}>Close details</Button></div></aside></div>; }

export default function App() {
  return <AuthGate><ApplicationShell /></AuthGate>;
}

