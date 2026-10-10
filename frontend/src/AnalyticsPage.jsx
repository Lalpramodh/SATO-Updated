import { useMemo } from 'react';
import { Activity, BarChart3, Building2, CircleAlert, Clock3, Users } from 'lucide-react';
import { normalizeSessions } from './timetableLayout';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export default function AnalyticsPage({ data, department = 'All departments' }) {
  const entries = useMemo(() => (data.entries || []).filter((entry) => department === 'All departments' || entry.department === department), [data.entries, department]);
  const sessions = useMemo(() => normalizeSessions(entries, data.timeSlots || []), [entries, data.timeSlots]);
  const rooms = new Set(entries.map((entry) => entry.room).filter(Boolean)).size;
  const faculty = new Set(entries.map((entry) => entry.faculty).filter(Boolean)).size;
  const groups = new Set(entries.map((entry) => entry.group).filter(Boolean)).size;
  const hours = entries.reduce((total, entry) => total + (Number(entry.duration) || 1), 0);
  const dayCounts = DAYS.map((day) => ({ day, count: sessions.filter((session) => session.day === day).length }));
  const peakDay = [...dayCounts].sort((left, right) => right.count - left.count)[0];

  return <div className="analytics-page">
    <div className="page-header"><div><div className="eyebrow">Analytics / Selected timetable</div><h1>Schedule analytics</h1><p>Calculated from {data.timetable?.academic_year} Semester {data.timetable?.semester} {department === 'All departments' ? 'across all departments' : department}.</p></div></div>
    <div className="analytics-kpis">
      <Metric icon={BarChart3} label="Optimization score" value={data.timetable?.optimization_score ?? '—'} />
      <Metric icon={CircleAlert} label="Conflicts" value={data.timetable?.total_conflicts ?? '—'} />
      <Metric icon={Clock3} label="Scheduled hours" value={hours} />
      <Metric icon={Building2} label="Rooms used" value={rooms} />
      <Metric icon={Users} label="Faculty used" value={faculty} />
      <Metric icon={Users} label="Groups scheduled" value={groups} />
    </div>
    <section className="panel analytics-live-panel"><div className="panel-heading"><div><span className="eyebrow">Weekly distribution</span><h3>Visual sessions by day</h3></div><span>{sessions.length} visual sessions</span></div><div className="analytics-day-list">{dayCounts.map((item) => <div className="analytics-day-row" key={item.day}><strong>{item.day}</strong><div className="progress"><i style={{ height: `${peakDay?.count ? (item.count / peakDay.count) * 100 : 0}%` }} /></div><b>{item.count}</b></div>)}</div></section>
  </div>;
}

function Metric({ icon: Icon, label, value }) {
  return <div className="metric-card"><div className="metric-icon cyan"><Icon size={18} /></div><div className="metric-content"><span>{label}</span><strong>{value}</strong><small>Current selected scope</small></div></div>;
}
