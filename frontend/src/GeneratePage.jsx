import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [violations, setViolations] = useState([]);
  const [regenerationUsed, setRegenerationUsed] = useState(false);
  const generationCycle = useRef(null);
  const requestInFlight = useRef(false);

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

  const selectedScope = () => ({
    academic_year: '2026-27',
    semester,
    department: department === ALL_DEPARTMENTS ? undefined : department,
    student_group: group === ALL_GROUPS ? undefined : group,
  });

  const requestWithTimeout = async (send) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 300000);
    try {
      return await send(controller.signal);
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const showValidationFailure = (payload) => {
    if (!payload?.validation?.violations?.length) return false;
    setViolations(payload.validation.violations);
    setError('');
    return true;
  };

  const run = async (regenerate = false) => {
    if (requestInFlight.current) return;
    if (regenerate) {
      if (!violations.length || !generationCycle.current || generationCycle.current.regenerated) return;
      generationCycle.current.regenerated = true;
      setRegenerationUsed(true);
    } else {
      generationCycle.current = { scope: selectedScope(), regenerated: false };
      setRegenerationUsed(false);
      setViolations([]);
    }
    requestInFlight.current = true;
    setRunning(true);
    setDone(false);
    setResult(null);
    setError('');
    try {
      const response = await requestWithTimeout((signal) => api.generateTimetable(generationCycle.current.scope, signal));
      if (showValidationFailure(response)) return;
      setViolations([]);
      if (response.success && response.validation?.valid === true) {
        setResult(response);
        setDone(true);
        notify('Timetable generated successfully');
        onGenerated(response.timetable_id);
      } else {
        setError(`Generation failed: ${response.message || response.error || 'The schedule could not be validated.'}`);
      }
    } catch (requestError) {
      if (!showValidationFailure(requestError.payload)) {
        setViolations([]);
        setError(generationError(requestError));
      }
    } finally {
      requestInFlight.current = false;
      setRunning(false);
    }
  };

  const workflowProgress = done ? 7 : running ? 4 : 0;
  const workflowSteps = ['Preparing academic data', 'Loading faculty availability', 'Building scheduling model', 'Applying hard constraints', 'Optimizing timetable', 'Validating schedule', 'Persisting timetable'];

  return <>
    <div className="page-header">
      <div><div className="eyebrow">Optimizer / New run</div><h1>Generate optimized timetable</h1><p>Configure academic constraints and let the scheduling engine find a conflict-free schedule.</p></div>
      <span className="status-badge success"><i/>Engine ready</span>
    </div>
    <div className="generate-layout">
      <section className="panel config-panel">
        <div className="panel-heading"><div><span className="eyebrow">Configuration</span><h3>Schedule parameters</h3></div><SlidersHorizontal size={18}/></div>
        <div className="form-grid">
          <label>Academic year<select defaultValue="2026-27"><option>2026-27</option></select></label>
          <label>Semester<select value={semester} onChange={(event) => setSemester(Number(event.target.value))}>{[3].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Department<select value={department} onChange={(event) => setDepartment(event.target.value)}>{departmentOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Student group<select value={group} disabled={loadingGroups} onChange={(event) => setGroup(event.target.value)}><option value={ALL_GROUPS}>{loadingGroups ? 'Loading groups...' : ALL_GROUPS}</option>{scopedGroups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <Button primary icon={Play} onClick={() => run()} disabled={running}>{running ? 'Generating timetable...' : 'Generate Timetable'}</Button>
        {error && <div className="error-callout" role="alert"><CircleAlert size={16}/>{error}</div>}
        {violations.length > 0 && <>
          <div className="error-callout" role="alert"><CircleAlert size={16}/><div>
            <strong>Scheduling Conflict Detected</strong>
            {violations.map((violation, index) => <div key={`${violation.code}-${index}`}>
              {violation.resource && <div><strong>{violation.code === 'faculty_overlap' ? 'Faculty' : violation.code === 'group_overlap' ? 'Student group' : violation.code === 'room_overlap' ? 'Room' : 'Resource'}:</strong> {violation.resource}</div>}
              {violation.faculty && <div><strong>Faculty:</strong> {violation.faculty}</div>}
              {violation.day && <div><strong>Day:</strong> {violation.day}</div>}
              {(violation.requested_time || violation.time) && <div><strong>Time:</strong> {violation.requested_time || violation.time}</div>}
              {violation.conflicting_time && violation.conflicting_time !== violation.requested_time && <div><strong>Overlapping time:</strong> {violation.conflicting_time}</div>}
              {(violation.class || violation.classes?.length) && <div><strong>Class:</strong> {violation.class || violation.classes.join(' / ')}</div>}
              <div><strong>Reason:</strong> {violation.message}</div>
            </div>)}
          </div></div>
          {(!regenerationUsed || running) && <Button onClick={() => run(true)} disabled={running || regenerationUsed}>{running ? 'Regenerating timetable...' : 'Regenerate Timetable'}</Button>}
        </>}
      </section>
      <section className="panel workflow-panel">
        <div className="panel-heading"><div><span className="eyebrow">Optimization workflow</span><h3>{running ? 'Finding the best schedule' : done ? 'Run complete' : 'Ready when you are'}</h3></div><Activity className={running ? 'spin' : ''} size={19}/></div>
        {workflowSteps.map((step, index) => <div className={index < workflowProgress ? 'workflow-step complete' : 'workflow-step'} key={`${step}-${index}`}><span className="workflow-icon">{index < workflowProgress ? <Check size={14}/> : <span>{String(index + 1).padStart(2, '0')}</span>}</span><span>{step}</span></div>)}
      </section>
    </div>

    {done && result && <section className="result-panel"><div className="result-icon"><Check size={24}/></div><div><span className="eyebrow">Timetable generated</span><h2>Semester {result.semester} is {result.solver_status === 'OPTIMAL' ? 'optimized' : 'generated'} and ready.</h2><p>Timetable ID: {result.timetable_id}</p></div><div className="result-actions"><button className="button" onClick={() => navigate('timetable')}>View timetable</button><button className="button" onClick={() => navigate('analytics')}>Analytics</button></div></section>}
  </>;
}

function Button({ children, primary = false, icon: Icon, onClick, disabled = false }) {
  return <button className={primary ? 'button primary' : 'button'} onClick={onClick} disabled={disabled}>{Icon && <Icon size={16}/>}<span>{children}</span></button>;
}
