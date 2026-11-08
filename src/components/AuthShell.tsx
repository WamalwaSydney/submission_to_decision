import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { ArrowLeft, Scale } from 'lucide-react';

/**
 * Sign-in, sign-up and password reset: no navigation menu, so the page is
 * only about getting into an account. The full menu appears once signed in.
 */
export function AuthShell() {
  return (
    <div className="auth-shell">
      <div className="kenya-flag" role="img" aria-label="Flag of Kenya">
        <img src="/kenya-flag-shield.svg" alt="" aria-hidden="true" />
      </div>
      <header className="auth-shell-header">
        <Link to="/" className="auth-shell-brand" aria-label="Participation Trace home">
          {/* Same mark as the navigation menu's logo */}
          <span className="auth-shell-mark" aria-hidden="true"><Scale size={22} strokeWidth={2.25} /></span>
          <span><strong>Participation Trace</strong><small>Kenya</small></span>
        </Link>
        <Link to="/" className="auth-shell-back"><ArrowLeft size={16} aria-hidden="true" /> Back to home</Link>
      </header>
      <main id="main-content" className="auth-shell-main">
        <Outlet />
      </main>
    </div>
  );
}
