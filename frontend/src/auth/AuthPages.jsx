import { useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { useAuth } from './AuthContext';

export function goTo(path, replace = false) {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function authError(error, fallback) {
  const message = String(error?.message || '').toLowerCase();
  if (error?.code === 'invalid_credentials' || message.includes('invalid login') || message.includes('invalid credentials')) return 'Invalid email or password.';
  if (error?.code === 'user_already_exists' || message.includes('already registered') || message.includes('already exists')) return 'An account with this email already exists. Please sign in.';
  if (message.includes('password') && (message.includes('weak') || message.includes('6 characters'))) return 'Please choose a stronger password.';
  if (error?.status === 429 || message.includes('rate limit')) return 'Too many authentication attempts. Please wait and try again.';
  if (message.includes('email not confirmed')) return 'Immediate sign-in is unavailable because of the current authentication configuration.';
  if (message.includes('redirect') || message.includes('origin')) return 'Authentication redirect configuration is invalid. Please contact an administrator.';
  if (message.includes('network') || message.includes('fetch')) return 'Unable to connect to authentication service. Please try again.';
  return fallback;
}

function AuthShell({ children }) {
  return <main className="auth-page"><div className="auth-frame"><header className="auth-brand-header"><div className="auth-brand-lockup"><div className="auth-brand-mark">S</div><div><strong>SATO</strong><span>Smart Academic Timetable Optimizer</span></div></div><span className="auth-header-meta">ACADEMIC OPERATIONS</span></header><div className="auth-layout"><section className="auth-branding"><div className="auth-eyebrow">SMART ACADEMIC OPERATIONS</div><h1>Intelligent scheduling for modern academic operations.</h1><p>Generate conflict-free timetables, optimize institutional resources, and manage academic schedules from one intelligent platform.</p><ul><li><Check size={15}/> Conflict-free scheduling</li><li><Check size={15}/> Intelligent resource allocation</li><li><Check size={15}/> Real-time timetable management</li></ul></section><section className="auth-card-wrap">{children}</section></div><footer className="auth-footer"><span>Secure workspace access</span><span>Powered by constraint optimization</span></footer></div></main>;
}

function AuthCard({ title, subtitle, children }) {
  return <section className="auth-card"><div className="auth-card-heading"><span className="auth-card-icon"><LockKeyhole size={18}/></span><h2>{title}</h2><p>{subtitle}</p></div>{children}</section>;
}

function Field({ label, icon: Icon, type = 'text', value, onChange, placeholder, autoComplete, end }) {
  return <label className="auth-field"><span>{label}</span><div className="auth-input-wrap"><Icon size={16}/><input type={type} value={value} onChange={onChange} placeholder={placeholder} autoComplete={autoComplete}/>{end}</div></label>;
}

function PasswordField({ label, value, onChange, autoComplete }) {
  const [visible, setVisible] = useState(false);
  return <Field label={label} icon={LockKeyhole} type={visible ? 'text' : 'password'} value={value} onChange={onChange} placeholder="Enter password" autoComplete={autoComplete} end={<button type="button" className="auth-visibility" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff size={16}/> : <Eye size={16}/>}</button>}/>;
}

function SubmitButton({ children, loading, disabled = false }) {
  return <button className="button primary auth-submit" type="submit" disabled={loading || disabled}>{loading ? 'Please wait...' : children}<ArrowRight size={16}/></button>;
}

export function LoginPage() {
  const { signIn, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Please enter a valid email address.');
    if (!password) return setError('Please enter your password.');
    if (!configured) return setError('Authentication is not configured. Add the frontend Supabase environment variables.');
    setLoading(true);
    const { error: requestError } = await signIn(email.trim(), password);
    setLoading(false);
    if (requestError) setError(authError(requestError, 'Unable to sign in. Please try again.'));
    else goTo('/');
  };

  return <AuthShell><AuthCard title="Welcome back" subtitle="Sign in to continue to SATO"><form onSubmit={submit}><Field label="Email" icon={Mail} value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} placeholder="you@institution.edu" autoComplete="email"/><PasswordField label="Password" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} autoComplete="current-password"/>{error && <div className="auth-error" role="alert">{error}</div>}<div className="auth-forgot"><button type="button" className="auth-link" onClick={() => goTo('/forgot-password')}>Forgot password?</button></div><SubmitButton loading={loading} disabled={!validEmail || !password}>Sign In</SubmitButton></form><p className="auth-switch">Don&apos;t have an account? <button className="auth-link" onClick={() => goTo('/register')}>Create account</button></p></AuthCard></AuthShell>;
}

export function RegisterPage() {
  const { signUp, configured } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const passwordMismatch = Boolean(confirmPassword) && password !== confirmPassword;
  const formValid = fullName.trim().length >= 2 && validEmail && password.length >= 8 && Boolean(confirmPassword) && !passwordMismatch;

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    setSuccess('');
    if (!fullName.trim()) return setError('Please enter your full name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Please enter a valid email address.');
    if (password.length < 8) return setError('Please choose a stronger password with at least 8 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    if (!configured) return setError('Authentication is not configured. Add the frontend Supabase environment variables.');
    setLoading(true);
    const { data, error: requestError } = await signUp(email.trim(), password, fullName.trim());
    setLoading(false);
    if (requestError) return setError(authError(requestError, `Unable to create your account: ${requestError.message || 'Unknown authentication error.'}`));
    if (data?.session) goTo('/');
    else setError('Account creation returned no active session. Disable email confirmation in Supabase Auth settings for immediate sign-in.');
  };

  return <AuthShell><AuthCard title="Create your SATO account" subtitle="Get started with intelligent academic timetable management."><form onSubmit={submit}><Field label="Full Name" icon={UserRound} value={fullName} onChange={(event) => { setFullName(event.target.value); setError(''); }} placeholder="Your full name" autoComplete="name"/><Field label="Email" icon={Mail} value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} placeholder="you@institution.edu" autoComplete="email"/><PasswordField label="Password" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} autoComplete="new-password"/><PasswordField label="Confirm Password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(''); }} autoComplete="new-password"/>{passwordMismatch && <div className="auth-error" role="alert">Passwords do not match.</div>}{error && !passwordMismatch && <div className="auth-error" role="alert">{error}</div>}{success && <div className="auth-success" role="status">{success}</div>}<SubmitButton loading={loading} disabled={!formValid}>Create Account</SubmitButton></form><p className="auth-switch">Already have an account? <button className="auth-link" onClick={() => goTo('/login')}>Sign in</button></p></AuthCard></AuthShell>;
}

export function ForgotPasswordPage() {
  const { resetPassword, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    setMessage('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Please enter a valid email address.');
    if (!configured) return setError('Authentication is not configured. Add the frontend Supabase environment variables.');
    setLoading(true);
    const { error: requestError } = await resetPassword(email.trim(), window.location.origin + '/reset-password');
    setLoading(false);
    if (requestError) setError(authError(requestError, 'Unable to send the reset link. Please try again.'));
    else setMessage('If an account exists for this email, a password reset link has been sent.');
  };

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  return <AuthShell><AuthCard title="Reset your password" subtitle="We&apos;ll send a secure link to your email address."><form onSubmit={submit}><Field label="Email" icon={Mail} value={email} onChange={(event) => { setEmail(event.target.value); setError(''); }} placeholder="you@institution.edu" autoComplete="email"/>{error && <div className="auth-error" role="alert">{error}</div>}{message && <div className="auth-success" role="status">{message}</div>}<SubmitButton loading={loading} disabled={!validEmail}>Send reset link</SubmitButton></form><p className="auth-switch"><button className="auth-link" onClick={() => goTo('/login')}>Back to sign in</button></p></AuthCard></AuthShell>;
}

export function ResetPasswordPage() {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const mismatch = Boolean(confirmPassword) && password !== confirmPassword;
  const valid = password.length >= 8 && Boolean(confirmPassword) && !mismatch;

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    setSuccess('');
    if (!valid) return setError(mismatch ? 'Passwords do not match.' : 'Please choose a stronger password with at least 8 characters.');
    setLoading(true);
    const { error: requestError } = await updatePassword(password);
    setLoading(false);
    if (requestError) setError(authError(requestError, 'Unable to update your password. Please request a new reset link.'));
    else {
      await signOut();
      goTo('/login', true);
    }
  };

  return <AuthShell><AuthCard title="Set a new password" subtitle="Choose a new password for your SATO account."><form onSubmit={submit}><PasswordField label="New Password" value={password} onChange={(event) => { setPassword(event.target.value); setError(''); }} autoComplete="new-password"/><PasswordField label="Confirm Password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setError(''); }} autoComplete="new-password"/>{mismatch && <div className="auth-error" role="alert">Passwords do not match.</div>}{error && !mismatch && <div className="auth-error" role="alert">{error}</div>}{success && <div className="auth-success" role="status">{success}</div>}<SubmitButton loading={loading} disabled={!valid}>Update password</SubmitButton></form><p className="auth-switch"><button className="auth-link" onClick={() => goTo('/login')}>Back to sign in</button></p></AuthCard></AuthShell>;
}

export function AuthLoading() {
  return <div className="auth-loading"><div className="brand-mark">S</div><span>Checking SATO session...</span></div>;
}
