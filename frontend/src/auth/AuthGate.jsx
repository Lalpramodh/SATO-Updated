import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { AuthLoading, ForgotPasswordPage, goTo, LoginPage, RegisterPage, ResetPasswordPage } from './AuthPages';

const authPaths = new Set(['/login', '/register', '/forgot-password', '/reset-password']);

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname || '/');
  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname || '/');
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  return pathname;
}

export default function AuthGate({ children }) {
  const { session, loading } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && session && authPaths.has(pathname) && pathname !== '/reset-password') goTo('/', true);
    if (!loading && !session && !authPaths.has(pathname) && pathname !== '/login') goTo('/login', true);
  }, [loading, pathname, session]);

  if (loading) return <AuthLoading />;
  if (!session) {
    if (pathname === '/register') return <RegisterPage />;
    if (pathname === '/forgot-password') return <ForgotPasswordPage />;
    if (pathname === '/reset-password') return <ResetPasswordPage />;
    if (pathname !== '/login') return <AuthLoading />;
    return <LoginPage />;
  }
  if (pathname === '/reset-password') return <ResetPasswordPage />;
  if (authPaths.has(pathname)) return <AuthLoading />;
  return children;
}
