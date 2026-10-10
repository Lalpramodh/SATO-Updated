import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigMissing } from './supabase';

const AuthContext = createContext(null);

function logAuthError(operation, error) {
  if (!import.meta.env.DEV || !error) return;
  console.error(`SATO ${operation} error:`, {
    message: error.message,
    code: error.code,
    status: error.status,
    details: error.details,
    hint: error.hint,
  });
}

async function runAuthOperation(operation, callback) {
  if (!supabase) return { data: null, error: new Error('Supabase frontend configuration is missing.') };
  try {
    const result = await callback();
    logAuthError(operation, result.error);
    return result;
  } catch (error) {
    logAuthError(operation, error);
    return { data: null, error };
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (supabaseConfigMissing || !supabase) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setLoading(false);
      }
    }).catch((error) => {
      logAuthError('session initialization', error);
      if (mounted) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({
    session,
    user: session?.user || null,
    loading,
    configured: !supabaseConfigMissing,
    signIn: (email, password) => runAuthOperation('login', () => supabase.auth.signInWithPassword({ email, password })),
    signUp: (email, password, fullName) => runAuthOperation('register', () => supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/login` },
    })),
    signOut: () => supabase?.auth.signOut(),
    resetPassword: (email, redirectTo) => runAuthOperation('reset-password', () => supabase.auth.resetPasswordForEmail(email, { redirectTo })),
    updatePassword: (password) => runAuthOperation('update-password', () => supabase.auth.updateUser({ password })),
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
