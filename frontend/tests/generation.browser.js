import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import GeneratePage from '../src/GeneratePage.jsx';
import { api, ApiError } from '../src/api.js';
import App from '../src/App.jsx';
import { AuthProvider } from '../src/auth/AuthContext.jsx';

const departments = [{ id: 'dept-1', code: 'CSE-AIML' }];
const groups = [{ id: 'group-1', name: 'CSE-AIML-Y2-S3-A', department_id: 'dept-1' }];
const conflict = (name = 'Dr. Ravi') => ({
  code: 'faculty_overlap', resource: name, day: 'Monday', requested_time: '09:00-10:00',
  message: 'Faculty is assigned to overlapping classes.',
});
const invalid = (violations = [conflict()]) => ({
  success: false, error: 'SCHEDULING_CONFLICT',
  validation: { valid: false, violation_count: violations.length, violations },
});
const valid = (solver_status = 'OPTIMAL') => ({
  success: true, timetable_id: 'new-timetable', semester: 3, solver_status,
  validation: { valid: true, violation_count: 0, violations: [] },
});
function apiFailure(payload, status = 400) {
  const error = new ApiError(status, payload.message || payload.error);
  error.payload = payload;
  return error;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const text = () => document.getElementById('root').textContent;
const button = (label) => [...document.querySelectorAll('#root button')].find((item) => item.textContent === label);
async function until(condition) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await pause();
  }
  throw new Error(`Timed out waiting for UI. Current text: ${text()}`);
}

let root;
async function mount(outcomes) {
  root?.unmount();
  root = createRoot(document.getElementById('root'));
  const requests = [];
  const notifications = [];
  let savedId = 'previous-timetable';
  api.getStudentGroups = async () => groups;
  api.generateTimetable = async (scope) => {
    requests.push(structuredClone(scope));
    const outcome = outcomes[requests.length - 1];
    if (outcome instanceof Error) throw outcome;
    return typeof outcome === 'function' ? outcome() : outcome;
  };
  root.render(createElement(GeneratePage, {
    departments, notify: (message) => notifications.push(message),
    onGenerated: (id) => { savedId = id; }, navigate: () => {},
  }));
  await until(() => button('Generate Timetable') && !document.querySelectorAll('#root select')[3].disabled);
  return { requests, notifications, savedId: () => savedId };
}
async function generate() {
  button('Generate Timetable').click();
  await pause();
  await until(() => button('Generate Timetable') && !button('Generate Timetable').disabled);
}
async function select(index, value) {
  const element = document.querySelectorAll('#root select')[index];
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await pause();
}

const cases = [
  ['original generation shows the normal validated success UI without candidate controls', async () => {
    const fixture = await mount([valid()]);
    await generate();
    assert(fixture.requests.length === 1, 'Expected one original generation request');
    assert(fixture.savedId() === 'new-timetable', 'Valid result must become the active timetable');
    assert(fixture.notifications.length === 1, 'Expected the original success notification');
    assert(text().includes('Timetable generated') && text().includes('optimized and ready'), 'Expected the original success panel');
    assert(!text().includes('Scheduling Conflict Detected') && !button('Regenerate Timetable'), 'Zero violations must not display conflicts or retry');
    assert(!/candidate|comparison|compare timetables|resolve & regenerate|objective value|solver attempts|vs previous/i.test(text()), 'Unwanted workflow remains visible');
  }],
  ['real failure preserves the saved result and allows one disabled manual retry per cycle', async () => {
    let finishRetry;
    const pending = new Promise((resolve) => { finishRetry = resolve; });
    const fixture = await mount([apiFailure(invalid()), () => pending, apiFailure(invalid())]);
    await select(2, 'CSE-AIML');
    await select(3, 'group-1');
    await generate();
    assert(text().includes('Dr. Ravi') && text().includes('Monday') && text().includes('09:00-10:00'), 'Must display the actual violation details');
    assert(fixture.savedId() === 'previous-timetable' && fixture.notifications.length === 0, 'Invalid result replaced the saved timetable');
    await pause();
    assert(fixture.requests.length === 1, 'Generation retried automatically');
    const retry = button('Regenerate Timetable');
    assert(retry, 'Expected one retry button immediately below the conflict');
    retry.click();
    retry.click();
    await until(() => button('Regenerating timetable...'));
    assert(button('Regenerating timetable...').disabled, 'Retry must be disabled while running');
    assert(button('Generate Timetable') === undefined, 'Main button should show the running state');
    assert(fixture.requests.length === 2, 'Double click triggered extra requests');
    assert(JSON.stringify(fixture.requests[0]) === JSON.stringify(fixture.requests[1]), 'Regeneration changed the captured filters');
    finishRetry(invalid([conflict('Dr. Mehta')]));
    await until(() => button('Generate Timetable') && !button('Generate Timetable').disabled);
    assert(text().includes('Dr. Mehta') && !text().includes('Dr. Ravi'), 'Expected the remaining actual error');
    assert(!button('Regenerate Timetable'), 'A second regeneration was offered');
    await pause();
    assert(fixture.requests.length === 2 && fixture.savedId() === 'previous-timetable', 'Invalid retry changed the saved timetable or retried again');
    await generate();
    assert(fixture.requests.length === 3 && button('Regenerate Timetable'), 'A new manual generation must start a fresh cycle');
  }],
  ['a valid regeneration shows success and reports feasible results accurately', async () => {
    const fixture = await mount([apiFailure(invalid()), valid('FEASIBLE')]);
    await generate();
    button('Regenerate Timetable').click();
    await until(() => text().includes('Timetable generated'));
    assert(fixture.requests.length === 2 && fixture.savedId() === 'new-timetable', 'Expected one successful manual retry');
    assert(text().includes('generated and ready') && !text().includes('is optimized'), 'FEASIBLE result must not claim optimality');
    assert(!button('Regenerate Timetable') && !text().includes('Scheduling Conflict Detected'), 'Success must clear the conflict notification');
  }],
  ['regeneration reuses the original scope even if selections change after failure', async () => {
    const fixture = await mount([apiFailure(invalid()), valid()]);
    await select(2, 'CSE-AIML');
    await select(3, 'group-1');
    await generate();
    await select(3, 'All groups');
    button('Regenerate Timetable').click();
    await until(() => text().includes('Timetable generated'));
    assert(fixture.requests[1].student_group === 'group-1', 'Retry must use the original group');
    assert(fixture.requests[1].academic_year === '2026-27' && fixture.requests[1].semester === 3 && fixture.requests[1].department === 'CSE-AIML', 'Academic scope changed');
  }],
  ['non-conflict errors never fabricate a conflict or offer regeneration', async () => {
    for (const failure of [apiFailure({ error: 'No feasible timetable found.' }), new TypeError('offline'), Object.assign(new Error('cancelled'), { name: 'AbortError' })]) {
      const fixture = await mount([failure]);
      await generate();
      assert(document.querySelector('[role="alert"]'), 'Expected the real generation error');
      assert(!button('Regenerate Timetable') && !text().includes('Scheduling Conflict Detected'), 'Non-conflict failure must not be labelled a scheduling conflict');
      assert(fixture.requests.length === 1 && fixture.savedId() === 'previous-timetable', 'Failure changed the saved timetable or retried');
    }
  }],
  ['a failed manual retry consumes the retry allowance even when the network fails', async () => {
    const fixture = await mount([apiFailure(invalid()), new TypeError('offline')]);
    await generate();
    button('Regenerate Timetable').click();
    await until(() => text().includes('Backend unreachable'));
    assert(fixture.requests.length === 2 && !button('Regenerate Timetable'), 'Retry allowance was not consumed');
    assert(fixture.savedId() === 'previous-timetable', 'Network failure replaced the saved timetable');
  }],
  ['availability, compatibility and other real hard-constraint findings show their actual reasons', async () => {
    const violations = [
      { code: 'faculty_unavailable', faculty: 'Dr. Ravi', day: 'Monday', requested_time: '09:00-10:00', message: 'Faculty availability is blocked for an occupied session block.' },
      { code: 'room_type_mismatch', class: 'CSE101', message: 'Room type is not compatible with the course.' },
      { code: 'session_count', message: 'CSE102 requires 2 sessions, but the schedule has 1.' },
    ];
    await mount([apiFailure(invalid(violations))]);
    await generate();
    for (const violation of violations) assert(text().includes(violation.message), `Missing actual reason: ${violation.code}`);
    assert([...document.querySelectorAll('button')].filter((item) => item.textContent === 'Regenerate Timetable').length === 1, 'Expected exactly one retry action');
  }],
  ['success is withheld when independent validation is missing or reports violations', async () => {
    for (const response of [{ success: true, timetable_id: 'unvalidated' }, { ...valid(), validation: invalid().validation }]) {
      const fixture = await mount([response]);
      await generate();
      assert(fixture.savedId() === 'previous-timetable' && fixture.notifications.length === 0, 'Unvalidated success must not become active');
      assert(!text().includes('Timetable generated'), 'Unvalidated result must not show success');
    }
  }],
  ['existing pages, timetable filters, CSV export, Assign Faculty and its conflict popup still work', async () => {
    const faculty = [{ id: 'faculty-1', name: 'Dr. Ravi' }, { id: 'faculty-2', name: 'Dr. Mehta' }];
    const course = { id: 'course-1', course_code: 'CSE101', course_name: 'Theory', course_type: 'theory', department_id: 'dept-1', semester: 3 };
    const room = { id: 'room-1', name: 'CR-01', room_type: 'classroom', capacity: 60 };
    const slot = { id: 'mon-09', day_of_week: 1, day_name: 'Monday', start_time: '09:00:00', end_time: '10:00:00' };
    const timetable = { id: 'previous-timetable', name: '2026-27-sem3', academic_year: '2026-27', semester: 3, status: 'generated', optimization_score: 90, total_conflicts: 0 };
    const entry = { id: 'entry-1', timetable_id: timetable.id, course_id: course.id, faculty_id: faculty[0].id, group_id: groups[0].id, room_id: room.id, time_slot_id: slot.id, duration_hours: 1, course, faculty: faculty[0], group: groups[0], room, time_slot: slot };
    api.getTimetables = async () => [timetable];
    api.getTimetable = async () => ({ timetable, entries: [entry] });
    api.getCourses = async () => [course];
    api.getDepartments = async () => departments;
    api.getFaculty = async () => faculty;
    api.getStudentGroups = async () => groups;
    api.getRooms = async () => [room];
    api.getTimeSlots = async () => [slot];
    api.getSummary = async () => ({ summary: { courses: 1, faculty: 2, rooms: 1, student_groups: 1 } });
    const assignments = [];
    api.assignFacultyToEntry = async (...args) => {
      assignments.push(args);
      if (assignments.length === 1) {
        const error = apiFailure({ error: 'FACULTY_SCHEDULING_CONFLICT', details: { faculty: 'Dr. Mehta', day: 'Monday', requested_time: '09:00-10:00', conflicting_class: 'Another class', conflicting_time: '09:00-10:00' } }, 409);
        error.errorCode = 'FACULTY_SCHEDULING_CONFLICT';
        throw error;
      }
      entry.faculty_id = faculty[1].id;
      entry.faculty = faculty[1];
      return { assigned: true };
    };
    root.unmount();
    root = createRoot(document.getElementById('root'));
    root.render(createElement(AuthProvider, null, createElement(App)));
    await until(() => document.querySelectorAll('.nav-item').length === 9 && text().includes('2026-27-sem3'));
    async function navigate(label) {
      [...document.querySelectorAll('.nav-item')].find((item) => item.textContent === label).click();
      await until(() => document.querySelector('.nav-item.active')?.textContent === label && document.querySelector('h1'));
    }
    for (const label of ['Analytics', 'Rooms', 'Student Groups', 'Courses', 'Settings', 'Generate', 'Overview']) {
      await navigate(label);
      assert(document.querySelector('h1').textContent.length > 0, `Page failed to render: ${label}`);
      if (label === 'Analytics') assert(text().includes('Schedule analytics'), 'Analytics is missing');
      if (label === 'Generate') assert(button('Generate Timetable'), 'Restored Generate button is missing in the app');
    }
    await navigate('Timetable');
    assert(text().includes('CSE101') && text().includes('Friday'), 'Existing timetable and weekday grid are missing');
    assert(document.querySelectorAll('.page-container select').length > 0, 'Timetable filters are missing');
    const exportButton = [...document.querySelectorAll('button')].find((item) => /export/i.test(item.textContent));
    assert(exportButton, 'CSV export is missing');
    const originalObjectURL = URL.createObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    let exported;
    try {
      URL.createObjectURL = (blob) => { exported = blob; return 'blob:sato-test-export'; };
      HTMLAnchorElement.prototype.click = function () {};
      exportButton.click();
      assert((await exported.text()).includes('CSE101'), 'CSV export lost the persisted session');
    } finally {
      URL.createObjectURL = originalObjectURL;
      HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
    await navigate('Faculty');
    button('Assign Faculty').click();
    await until(() => document.querySelector('.faculty-assignment-modal'));
    const selects = document.querySelectorAll('.faculty-assignment-modal select');
    for (const [element, value] of [[selects[0], 'faculty-2'], [selects[1], 'entry-1']]) {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      await pause();
    }
    document.querySelector('.faculty-assignment-modal button[type="submit"]').click();
    await until(() => document.querySelector('[role="alertdialog"]'));
    const dialog = document.querySelector('[role="alertdialog"]');
    assert(dialog.textContent.includes('Faculty Scheduling Conflict') && dialog.textContent.includes('Dr. Mehta') && dialog.textContent.includes('09:00-10:00'), 'Existing conflict popup lost its details');
    dialog.querySelector('button').click();
    await until(() => !document.querySelector('[role="alertdialog"]'));
    document.querySelector('.faculty-assignment-modal button[type="submit"]').click();
    await until(() => !document.querySelector('.faculty-assignment-modal'));
    assert(assignments.length === 2 && assignments[1].join('/') === 'previous-timetable/entry-1/faculty-2', 'Existing row-scoped faculty assignment changed');
  }],
  ['existing authentication gate, sign-out and sign-in still work with an isolated session', async () => {
    document.querySelector('[aria-label="Sign out"]').click();
    await until(() => text().includes('Welcome back'));
    assert(!document.querySelector('.nav-item'), 'Signed-out users can still access the application');
    const inputs = document.querySelectorAll('form input');
    for (const [element, value] of [[inputs[0], 'admin@example.test'], [inputs[1], 'fixture-password']]) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await pause();
    }
    document.querySelector('form button[type="submit"]').click();
    await until(() => document.querySelectorAll('.nav-item').length === 9);
    assert(!text().includes('Welcome back'), 'Sign-in failed to restore the application');
  }],
];

async function run() {
  const results = [];
  for (const [name, execute] of cases) {
    try { await execute(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.stack }); }
  }
  root?.unmount();
  return results;
}
run().then(window.finishSatoTests, (error) => window.finishSatoTests([{ name: 'browser test setup', passed: false, error: error.stack }]));
