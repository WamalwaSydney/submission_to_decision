import type { Location } from 'react-router-dom';

/** Where to send someone after signing in: back to the page that asked them to. */
export function redirectTarget(state: unknown, fallback = '/'): string {
  const from = (state as { from?: Partial<Location> } | null)?.from;
  const path = `${from?.pathname || ''}${from?.search || ''}`;
  // Only same-app paths; never protocol-relative or external URLs. Browsers
  // treat "\" like "/", so "/\evil.com" would also leave the site.
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : fallback;
}
