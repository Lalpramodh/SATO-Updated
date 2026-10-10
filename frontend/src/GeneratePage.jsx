import { useEffect, useMemo, useState } from 'react';
import { Activity, CircleAlert, Play, SlidersHorizontal, Check } from 'lucide-react';
import { api, ApiError } from './api';

const ALL_DEPARTMENTS = 'All departments';
const ALL_GROUPS = 'All groups';

function departmentCode(group, departments) {
  const department = departments.find((item) => String(item.id) === String(group.department_id));
  return department?.code || department?.short_name || group.department_code || group.department;
}

function generationError(error) {
  if (error instanceof ApiError) {
    if (error.status === 400) return `Validation error: ${error.message}`;
    if (error.status >= 500) return `Generation failed: ${error.message}`;
    return `Server error (${error.status}): ${error.message}`;
  }
  if (error?.name === 'AbortError') return 'Generation timed out or was cancelled.';
  if (error instanceof TypeError) return 'Backend unreachable. Check that the Flask server is running.';
  return `Generation failed: ${error?.message || 'Unknown scheduling engine error.'}`;
}

export default function GeneratePage({ navigate, notify, onGenerated, onSemesterChange, departments = [], initialSemester = 3 }) {
  const [semester, setSemester] = useState(initialSemester);
  const [department, setDepartment] = useState(ALL_DEPARTMENTS);
  const [groups, setGroups] = useState([]);
  const [loadedDepartments, setLoadedDepartments] = useState(departments);
  const [group, setGroup] = useState(ALL_GROUPS);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => setSemester(initialSemester), [initialSemester]);
  useEffect(() => onSemesterChange?.(semester), [semester, onSemesterChange]);

  useEffect(() => {
    if (departments.length) {
      setLoadedDepartments(departments);
      return undefined;
    }
    const controller = new AbortController();
    api.getDepartments(controller.signal).then(setLoadedDepartments).catch((requestError) => {
      if (requestError.name !== 'AbortError') setError(`Unable to load departments: ${requestError.message}`);
    });
    return () => controller.abort();
  }, [departments]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingGroups(true);
    setGroup(ALL_GROUPS);
    api.getStudentGroups(semester, controller.signal)
      .then(setGroups)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(`Unable to load student groups: ${requestError.message}`);
      })
      .finally(() => setLoadingGroups(false));
    return () => controller.abort();
  }, [semester]);

  const departmentOptions = useMemo(() => [ALL_DEPARTMENTS, ...loadedDepartments.map((item) => item.code || item.short_name || item.name).filter(Boolean)], [loadedDepartments]);
  const scopedGroups = useMemo(() => groups.filter((item) => department === ALL_DEPARTMENTS || departmentCode(item, loadedDepartments) === department), [groups, department, loadedDepartments]);

  useEffect(() => {
    if (group !== ALL_GROUPS && !scopedGroups.some((item) => String(item.id) === String(group))) setGroup(ALL_GROUPS);
  }, [group, scopedGroups]);

  const run = async () => {
    setRunning(true);
    setDone(false);
    setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 300000);
    try {
      const response = await api.generateTimetable({
        academic_year: '2026-27',
        semester,
        department: department === ALL_DEPARTMENTS ? undefined : department,
        student_group: group === ALL_GROUPS ? undefined : group,
      }, controller.signal);
      setResult(response);
      setDone(Boolean(response.success));
      if (response.success) {
        notify('Timetable generated successfully');
        onGenerated(response.timetable_id);
      } else {
        setError(`Generation failed: ${response.error || 'The optimizer returned an unsuccessful result.'}`);
      }
    } catch (requestError) {
      setError(generationError(requestError));
    } finally {
      window.clearTimeout(timeout);
      setRunning(false);
    }
  };

  return <><div className="page-header"><div><div className="eyebrow">Optimizer / New run</div><h1>Generate optimized timetable</h1><p>Configure academic constraints and let the scheduling engine find a conflict-free schedule.</p></div><span className="status-badge success"><i/>Engine ready</span></div><div className="generate-layout"><section className="panel config-panel"><div className="panel-heading"><div><span className="eyebrow">Configuration</span><h3>Schedule parameters</h3></div><SlidersHorizontal size={18}/></div><div className="form-grid"><label>Academic year<select defaultValue="2026-27"><option>2026-27</option></select></label><label>Semester<select value={semester} onChange={(event) => setSemester(Number(event.target.value))}>{[3].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Department<select value={department} onChange={(event) => setDepartment(event.target.value)}>{departmentOptions.map((value) => <option key={value}>{value}</option>)}</select></label><label>Student group<select value={group} disabled={loadingGroups} onChange={(event) => setGroup(event.target.value)}><option value={ALL_GROUPS}>{loadingGroups ? 'Loading groups...' : ALL_GROUPS}</option>{scopedGroups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><Button primary icon={Play} onClick={run}>Generate timetable</Button>{error && <div className="error-callout"><CircleAlert size={16}/>{error}</div>}</section><section className="panel workflow-panel"><div className="panel-heading"><div><span className="eyebrow">Optimization workflow</span><h3>{running ? 'Finding the best schedule' : done ? 'Run complete' : 'Ready when you are'}</h3></div><Activity className={running ? 'spin' : ''} size={19}/></div>{['Preparing academic data', 'Loading faculty availability', 'Building scheduling model', 'Applying hard constraints', 'Optimizing timetable', 'Validating schedule', 'Persisting timetable'].map((step, index) => <div className={index < (running ? 4 : done ? 7 : 0) ? 'workflow-step complete' : 'workflow-step'} key={step}><span className="workflow-icon">{index < (running ? 4 : done ? 7 : 0) ? <Check size={14}/> : <span>{String(index + 1).padStart(2, '0')}</span>}</span><span>{step}</span></div>)}</section></div>{done && result && <section className="result-panel"><div className="result-icon"><Check size={24}/></div><div><span className="eyebrow">Timetable generated</span><h2>Semester {semester} is optimized and ready.</h2><p>Timetable ID: {result.timetable_id}</p></div><div className="result-actions"><button className="button" onClick={() => navigate('timetable')}>View timetable</button><button className="button" onClick={() => navigate('analytics')}>Analytics</button></div></section>}</>;
}

function Button({ children, primary = false, icon: Icon, onClick }) {
  return <button className={primary ? 'button primary' : 'button'} onClick={onClick}>{Icon && <Icon size={16}/>}<span>{children}</span></button>;
}
