import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, CircleAlert, Database, ExternalLink, Gauge, History, Layers3, LoaderCircle, RefreshCw, Users, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from './api';
import { normalizeSessions } from './timetableLayout';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const CHART_COLORS = ['#0891b2', '#10b981', '#8b5cf6', '#f59e0b', '#3b82f6', '#ef4444'];

function formatDuration(milliseconds) {
  return Number.isFinite(Number(milliseconds)) ? `${(Number(milliseconds) / 1000).toFixed(1)}s` : '—';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function hydrateEntries(response) {
  return (response.entries || []).map((entry) => ({
    id: entry.id,
    courseId: entry.course_id,
    code: entry.course?.course_code || 'Unknown course',
    name: entry.course?.course_name || 'Unknown course',
    type: entry.course?.course_type === 'lab' ? 'Lab' : entry.course?.course_type === 'theory' ? 'Theory' : entry.course?.course_type || 'Session',
    department: entry.course?.department_code || entry.course?.department_name || entry.course?.department_id || 'Unknown department',
    faculty: entry.faculty?.name || 'Unknown faculty',
    facultyId: entry.faculty_id,
    group: entry.group?.name || 'Unknown group',
    groupId: entry.group_id,
    studentCount: entry.group?.student_count,
    room: entry.room?.name || 'Unknown room',
    roomId: entry.room_id,
    roomType: entry.room?.room_type,
    day: entry.time_slot?.day_name,
    time: String(entry.time_slot?.start_time || '').slice(0, 5),
    endTime: String(entry.time_slot?.end_time || '').slice(0, 5),
    duration: entry.duration_hours,
  }));
}

function Card({ icon: Icon, label, value, tone = 'cyan', detail }) {
  return <div className="dashboard-stat"><span className={`dashboard-stat-icon ${tone}`}><Icon size={18}/></span><div><small>{label}</small><strong>{value}</strong>{detail && <em>{detail}</em>}</div></div>;
}

function SectionHeader({ eyebrow, title, action }) {
  return <div className="dashboard-section-header"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>{action}</div>;
}

export default function Dashboard({ data, live, backendStatus = 'ready', navigate, onEntry, onSelectTimetable, notify }) {
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);
  const [latestEntries, setLatestEntries] = useState([]);
  const [status, setStatus] = useState('loading');

  const loadDashboard = async (signal) => {
    try {
      const records = await api.getTimetables(undefined, undefined, signal);
      const sorted = [...records].sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0));
      setHistory(sorted);
      if (sorted.length) {
        const detail = await api.getTimetable(sorted[0].id, signal);
        setLatest(detail.timetable || sorted[0]);
        setLatestEntries(hydrateEntries(detail));
      } else {
        setLatest(null);
        setLatestEntries([]);
      }
      setStatus('ready');
    } catch (error) {
      if (error.name === 'AbortError') return;
      setStatus('error');
      notify(error.message || 'Unable to load timetable history.');
    } finally {
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (live) loadDashboard(controller.signal); else setStatus('loading');
    return () => controller.abort();
  }, [live, backendStatus]);

  const activeTimetable = latest || data.timetable;
  const activeEntries = latest ? latestEntries : data.entries;
  const visualSessions = useMemo(() => normalizeSessions(activeEntries, data.timeSlots || []), [activeEntries, data.timeSlots]);
  const dayData = useMemo(() => DAYS.map((day) => ({ day: day.slice(0, 3), sessions: visualSessions.filter((session) => session.day === day).length })), [visualSessions]);
  const typeData = useMemo(() => Object.entries(visualSessions.reduce((result, session) => { result[session.type] = (result[session.type] || 0) + 1; return result; }, {})).map(([name, value]) => ({ name, value })), [visualSessions]);
  const roomData = useMemo(() => Object.entries(activeEntries.reduce((result, entry) => { const name = entry.room || 'Unknown room'; result[name] = (result[name] || 0) + 1; return result; }, {})).map(([room, sessions]) => ({ room, sessions })).sort((left, right) => right.sessions - left.sessions).slice(0, 8), [activeEntries]);
  const roomsUsed = new Set(activeEntries.map((entry) => entry.room).filter(Boolean)).size;
  const facultyUsed = new Set(activeEntries.map((entry) => entry.faculty).filter(Boolean)).size;
  const groupsScheduled = new Set(activeEntries.map((entry) => entry.group).filter(Boolean)).size;

  if (status === 'loading') return <section className="dashboard-loading panel"><LoaderCircle className="spin" size={25}/><h1>Loading dashboard...</h1><p>Fetching real timetable history and analytics.</p></section>;
  if (status === 'error') return <section className="dashboard-empty panel"><CircleAlert size={28}/><h1>Unable to load dashboard</h1><p>The timetable history request failed. No demo statistics are being shown.</p><button className="button" onClick={loadDashboard}><RefreshCw size={15}/> Retry</button></section>;

  return <div className="dashboard-page">
    <div className="dashboard-hero"><div><span className="eyebrow">ACADEMIC OPERATIONS / DASHBOARD</span><h1>Smart Academic Timetable Optimizer</h1><p>Generate, analyze and manage optimized academic schedules.</p></div><div className="dashboard-actions"><span className="live-chip"><i/> Real backend data</span><button className="button primary" onClick={() => navigate('generate')}><Zap size={15}/> Generate New Timetable</button></div></div>
    <div className="dashboard-stats"><Card icon={History} label="Total timetables" value={history.length}/><Card icon={Gauge} label="Latest optimization score" value={activeTimetable?.optimization_score ?? '—'} tone="green"/><Card icon={CircleAlert} label="Latest conflicts" value={activeTimetable?.total_conflicts ?? '—'} tone="blue"/><Card icon={CalendarDays} label="Latest sessions" value={activeEntries.length || '—'} tone="purple"/></div>
    <section className="latest-timetable panel"><SectionHeader eyebrow="Latest timetable" title={activeTimetable ? activeTimetable.name : 'No timetable generated yet'} action={activeTimetable && <button className="text-button" onClick={() => onSelectTimetable(activeTimetable.id)}>View Timetable <ArrowUpRight size={15}/></button>}/>{activeTimetable ? <div className="latest-layout"><div className="latest-status"><div className="latest-status-icon"><Check size={22}/></div><div><strong>{activeTimetable.status}</strong><span>Validated schedule</span></div></div><div className="latest-details"><Detail label="Academic year" value={activeTimetable.academic_year}/><Detail label="Semester" value={activeTimetable.semester}/><Detail label="Optimization score" value={activeTimetable.optimization_score}/><Detail label="Conflicts" value={activeTimetable.total_conflicts}/><Detail label="Sessions" value={activeEntries.length}/><Detail label="Generation time" value={formatDuration(activeTimetable.generation_time_ms)}/><Detail label="Created" value={formatDate(activeTimetable.created_at)}/></div></div> : <p className="dashboard-muted">No timetable generated yet.</p>}</section>
    <section className="analytics-section"><SectionHeader eyebrow="Optimization analytics" title="Schedule intelligence" action={<span className="analytics-source"><Database size={14}/> Calculated from persisted entries</span>}/><div className="analytics-stats"><Card icon={Gauge} label="Optimization score" value={activeTimetable?.optimization_score ?? '—'}/><Card icon={CircleAlert} label="Total conflicts" value={activeTimetable?.total_conflicts ?? '—'} tone="green"/><Card icon={CalendarDays} label="Total sessions" value={activeEntries.length}/><Card icon={Layers3} label="Rooms used" value={roomsUsed} tone="purple"/><Card icon={Users} label="Faculty used" value={facultyUsed} tone="amber"/><Card icon={Users} label="Groups scheduled" value={groupsScheduled} tone="blue"/></div><div className="dashboard-charts"><ChartPanel title="Sessions by day" subtitle="Visual sessions by real time slot"><ResponsiveContainer width="100%" height={230}><BarChart data={dayData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}><CartesianGrid vertical={false} stroke="#e2e8f0"/><XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false}/><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="sessions" fill="#0891b2" radius={[5, 5, 0, 0]}/></BarChart></ResponsiveContainer></ChartPanel><ChartPanel title="Sessions by course type" subtitle="Actual persisted session distribution"><ResponsiveContainer width="100%" height={230}><PieChart><Pie data={typeData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={3}>{typeData.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]}/>)}</Pie><Tooltip/><Legend wrapperStyle={{ fontSize: 10 }}/></PieChart></ResponsiveContainer></ChartPanel><ChartPanel title="Room utilization" subtitle="Session load by actual room"><ResponsiveContainer width="100%" height={250}><BarChart data={roomData} layout="vertical" margin={{ top: 5, right: 15, left: 8, bottom: 0 }}><CartesianGrid horizontal={false} stroke="#e2e8f0"/><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="room" width={55} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="sessions" fill="#10b981" radius={[0, 5, 5, 0]}/></BarChart></ResponsiveContainer></ChartPanel></div></section>
    <section className="history-section panel"><SectionHeader eyebrow="Timetable history" title="Generated schedules" action={<span className="history-count">{history.length} records</span>}/>{history.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Name</th><th>Academic year</th><th>Semester</th><th>Status</th><th>Score</th><th>Conflicts</th><th>Generation</th><th>Created</th><th/></tr></thead><tbody>{history.map((record) => <tr key={record.id}><td><strong>{record.name}</strong></td><td>{record.academic_year}</td><td>{record.semester}</td><td><span className="history-status"><i/>{record.status}</span></td><td>{record.optimization_score}</td><td>{record.total_conflicts}</td><td>{formatDuration(record.generation_time_ms)}</td><td>{formatDate(record.created_at)}</td><td><button className="icon-button" onClick={() => onSelectTimetable(record.id)} aria-label={`View ${record.name}`}><ExternalLink size={15}/></button></td></tr>)}</tbody></table></div> : <div className="dashboard-muted">No timetable generated yet.</div>}</section>
  </div>;
}

function Detail({ label, value }) { return <div className="latest-detail"><span>{label}</span><strong>{value ?? '—'}</strong></div>; }
function ChartPanel({ title, subtitle, children }) { return <div className="dashboard-chart panel"><div><h3>{title}</h3><span>{subtitle}</span></div>{children}</div>; }

