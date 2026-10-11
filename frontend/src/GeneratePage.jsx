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

function assignmentDescription(assignment) {
  const course = [assignment.course_code, assignment.course_name].filter(Boolean).join(' - ') || assignment.course_id || 'Unknown course';
  const group = assignment.group_name || assignment.group_id || 'Unknown group';
  const faculty = assignment.faculty_name || assignment.faculty_employee_code || assignment.faculty_id || 'Unassigned';
  const room = assignment.room_name || assignment.room_id || 'Unknown room';
  return `${course} · ${group} · ${assignment.day || 'Unknown day'} ${assignment.start_time || '??:??'}-${assignment.end_time || '??:??'} · ${faculty} · ${room}`;
}

function violationDescription(violation) {
  const details = [violation.resource, violation.day].filter(Boolean);
  if (violation.requested_time || violation.conflicting_time) {
    details.push([violation.requested_time, violation.conflicting_time].filter(Boolean).join(' vs '));
  } else if (violation.time) {
    details.push(violation.time);
  }
  if (violation.classes?.length) details.push(violation.classes.join(' / '));
  return [violation.message, ...details].filter(Boolean).join(' · ');
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
  const [notice, setNotice] = useState('');
  const [candidate, setCandidate] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [accepting, setAccepting] = useState(false);

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

  useEffect(() => {
    setCandidate(null);
    setComparison(null);
    setDone(false);
    setResult(null);
  }, [semester, department, group]);

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

  const showCandidateFailure = (requestError) => {
    const payload = requestError?.payload;
    if (payload?.error !== 'NO_VALID_CANDIDATE') return false;
    setCandidate(payload);
    setComparison(null);
    setError(payload.message || 'No acceptable candidate was found. The saved timetable is unchanged.');
    return true;
  };

  const run = async () => {
    setRunning(true);
    setDone(false);
    setResult(null);
    setCandidate(null);
    setComparison(null);
    setError('');
    setNotice('');
    try {
      const response = await requestWithTimeout((signal) => api.generateTimetableCandidate(selectedScope(), signal));
      setCandidate(response);
      if (!response.success) setError(response.message || 'No acceptable candidate was found. The saved timetable is unchanged.');
    } catch (requestError) {
      if (!showCandidateFailure(requestError)) setError(generationError(requestError));
    } finally {
      setRunning(false);
    }
  };

  const compare = async () => {
    if (!candidate?.success) return;
    setComparing(true);
    setError('');
    try {
      const response = await requestWithTimeout((signal) => api.compareTimetableCandidate({
        ...selectedScope(),
        base_latest_timetable_id: candidate.base_latest_timetable_id,
        assignments: candidate.assignments,
      }, signal));
      setComparison(response);
    } catch (requestError) {
      if (!showCandidateFailure(requestError)) setError(requestError.message || generationError(requestError));
    } finally {
      setComparing(false);
    }
  };

  const resolveAndRegenerate = async () => {
    if (!candidate) return;
    setResolving(true);
    setError('');
    setNotice('');
    try {
      const response = await requestWithTimeout((signal) => api.generateTimetableCandidate({
        ...selectedScope(),
        additional_attempts: 3,
        check_base: true,
        expected_base_timetable_id: candidate.base_latest_timetable_id,
        best_candidate: candidate.success ? candidate : undefined,
      }, signal));
      setCandidate(response);
      setComparison(response.success ? response.comparison : null);
      if (!response.success) setError(response.message || 'No acceptable candidate was found. The saved timetable is unchanged.');
    } catch (requestError) {
      if (!showCandidateFailure(requestError)) setError(requestError.message || generationError(requestError));
    } finally {
      setResolving(false);
    }
  };

  const accept = async () => {
    if (!candidate?.success || !candidate.validation?.valid || accepting) return;
    setAccepting(true);
    setError('');
    try {
      const response = await requestWithTimeout((signal) => api.acceptTimetableCandidate({
        ...selectedScope(),
        base_latest_timetable_id: candidate.base_latest_timetable_id,
        assignments: candidate.assignments,
        generation_time_ms: candidate.generation_time_ms || 0,
      }, signal));
      setResult(response);
      setDone(true);
      setCandidate(null);
      setComparison(null);
      notify(response.message || 'Candidate accepted as a new timetable version.');
      onGenerated(response.timetable_id);
    } catch (requestError) {
      setError(requestError.message || generationError(requestError));
    } finally {
      setAccepting(false);
    }
  };

  const discard = () => {
    setCandidate(null);
    setComparison(null);
    setError('');
    setNotice('Candidate discarded. The saved timetable was not changed.');
  };

  const busy = running || resolving || comparing || accepting;
  const workflowProgress = done ? 7 : candidate?.success ? 6 : running || resolving ? 4 : 0;
  const workflowSteps = ['Preparing academic data', 'Loading faculty availability', 'Building scheduling model', 'Applying hard constraints', 'Optimizing schedule', 'Validating candidate', candidate?.success ? 'Awaiting explicit acceptance' : done ? 'Timetable accepted' : 'Ready for candidate review'];
  const previousComparison = comparison?.previous ?? candidate?.comparison?.previous;
  const assignmentChanges = comparison?.assignment_changes;
  const scoreDelta = comparison?.optimization_score_delta ?? candidate?.comparison?.optimization_score_delta;

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
        <Button primary icon={Play} onClick={run}>{running ? 'Generating candidate...' : 'Generate Candidate'}</Button>
        {error && <div className="error-callout" role="alert"><CircleAlert size={16}/>{error}</div>}
        {notice && <div className="healthy-callout" role="status"><Check size={16}/>{notice}</div>}
      </section>
      <section className="panel workflow-panel">
        <div className="panel-heading"><div><span className="eyebrow">Optimization workflow</span><h3>{running || resolving ? 'Finding a valid schedule' : candidate?.success ? 'Candidate ready for review' : done ? 'Timetable accepted' : 'Ready when you are'}</h3></div><Activity className={running || resolving ? 'spin' : ''} size={19}/></div>
        {workflowSteps.map((step, index) => <div className={index < workflowProgress ? 'workflow-step complete' : 'workflow-step'} key={`${step}-${index}`}><span className="workflow-icon">{index < workflowProgress ? <Check size={14}/> : <span>{String(index + 1).padStart(2, '0')}</span>}</span><span>{step}</span></div>)}
      </section>
    </div>

    {candidate && <section className="panel config-panel" aria-live="polite">
      <div className="panel-heading"><div><span className="eyebrow">Candidate review</span><h3>{candidate.success ? 'Validated candidate' : 'No acceptable candidate found'}</h3></div><span className={`status-badge ${candidate.success ? 'success' : 'warning'}`}><i/>{candidate.success ? 'Ready for review' : 'Not acceptable'}</span></div>
      {candidate.candidate_id && <p>Candidate ID: <strong>{candidate.candidate_id}</strong></p>}
      <div className="form-grid">
        <div><strong>Optimization score</strong><p>{candidate.optimization_score ?? '—'}{scoreDelta != null ? ` (${scoreDelta >= 0 ? '+' : ''}${scoreDelta} vs previous)` : ''}</p></div>
        <div><strong>Objective value (lower is better)</strong><p>{candidate.objective_value ?? '—'}</p></div>
        <div><strong>Hard-constraint violations</strong><p>{candidate.validation?.violation_count ?? '—'}</p></div>
        <div><strong>Solver attempts</strong><p>{candidate.attempt_count ?? 1}{candidate.attempts?.length ? ` (${candidate.attempts.map((attempt) => attempt.status).join(', ')})` : ''}</p></div>
      </div>
      {!previousComparison && candidate.success && <p>{candidate.comparison?.message || 'No previous timetable exists for this academic year, semester, and scope.'}</p>}
      {candidate.validation?.violations?.length > 0 && <div className="error-callout"><CircleAlert size={16}/><div><strong>Candidate validation findings</strong><ul>{candidate.validation.violations.map((violation, index) => <li key={`${violation.code}-${index}`}>{violationDescription(violation)}</li>)}</ul></div></div>}
      <div className="result-actions">
        <button className="button" type="button" onClick={compare} disabled={!candidate.success || busy}>{comparing ? 'Comparing...' : 'Compare Timetables'}</button>
        <button className="button" type="button" onClick={resolveAndRegenerate} disabled={busy}>{resolving ? 'Resolving...' : 'Resolve & Regenerate'}</button>
        <button className="button primary" type="button" onClick={accept} disabled={!candidate.success || !candidate.validation?.valid || busy}>{accepting ? 'Accepting...' : 'Accept Candidate'}</button>
        <button className="button" type="button" onClick={discard} disabled={busy}>Discard Candidate</button>
      </div>
      {comparison && <div className="candidate-comparison">
        <div className="panel-heading"><div><span className="eyebrow">Timetable comparison</span><h3>{previousComparison ? `${previousComparison.name || 'Previous timetable'} vs candidate` : 'No previous version'}</h3></div></div>
        <p>Previous ID: {previousComparison?.timetable_id || 'None'} · Candidate ID: {candidate.candidate_id || 'Not available'}</p>
        <p>Optimization scores: previous {previousComparison?.optimization_score ?? '—'} · candidate {comparison.candidate.optimization_score ?? candidate.optimization_score ?? '—'} · delta {comparison.optimization_score_delta == null ? '—' : `${comparison.optimization_score_delta >= 0 ? '+' : ''}${comparison.optimization_score_delta}`}</p>
        <p>Hard violations: previous {previousComparison?.validation.violation_count ?? '—'} · candidate {comparison.candidate.validation.violation_count}</p>
        {assignmentChanges && <>
          <p>Assignment changes: {assignmentChanges.change_count} ({assignmentChanges.added.length} added, {assignmentChanges.removed.length} removed, {assignmentChanges.changed.length} changed). These changes are not necessarily conflicts.</p>
          {[['Added', assignmentChanges.added], ['Removed', assignmentChanges.removed]].map(([label, items]) => items.length > 0 && <div key={label}><strong>{label}</strong><ul>{items.map((item, index) => <li key={`${label}-${index}`}>{assignmentDescription(item)}</li>)}</ul></div>)}
          {assignmentChanges.changed.length > 0 && <div><strong>Changed assignments</strong><ul>{assignmentChanges.changed.map((item, index) => <li key={`changed-${index}`}>{assignmentDescription(item.before)} → {assignmentDescription(item.after)}</li>)}</ul></div>}
        </>}
        <div className="form-grid">
          <div><strong>Previous hard-constraint violations</strong>{previousComparison?.validation.violations?.length ? <ul>{previousComparison.validation.violations.map((item, index) => <li key={`previous-${index}`}>{violationDescription(item)}</li>)}</ul> : <p>{previousComparison ? 'None' : 'No previous timetable in this scope'}</p>}</div>
          <div><strong>Candidate hard-constraint violations</strong>{comparison.candidate.validation.violations.length ? <ul>{comparison.candidate.validation.violations.map((item, index) => <li key={`candidate-${index}`}>{violationDescription(item)}</li>)}</ul> : <p>None</p>}</div>
        </div>
      </div>}
    </section>}

    {done && result && <section className="result-panel"><div className="result-icon"><Check size={24}/></div><div><span className="eyebrow">Timetable accepted</span><h2>Semester {semester} is saved as a new timetable version.</h2><p>Timetable ID: {result.timetable_id}</p></div><div className="result-actions"><button className="button" onClick={() => navigate('timetable')}>View timetable</button><button className="button" onClick={() => navigate('analytics')}>Analytics</button></div></section>}
  </>;
}

function Button({ children, primary = false, icon: Icon, onClick }) {
  return <button className={primary ? 'button primary' : 'button'} onClick={onClick}>{Icon && <Icon size={16}/>}<span>{children}</span></button>;
}
