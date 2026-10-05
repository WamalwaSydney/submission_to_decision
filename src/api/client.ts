const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

if (!API_URL) {
  console.warn('VITE_API_URL is not configured; API-backed features will be unavailable.');
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

export function getApiUrl(): string {
  if (!API_URL) throw new Error('VITE_API_URL is missing. Configure it in Netlify and rebuild.');
  return API_URL;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem('access_token');
  if (!(init.body instanceof FormData) && init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${getApiUrl()}${path}`, { ...init, headers });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export async function apiHealth<T = { status: string }>(apiRoot = getApiUrl().replace(/\/api\/v1$/, '')): Promise<T> {
  const response = await fetch(`${apiRoot}/health`);
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.json() as Promise<T>;
}

export function clearSession() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('current_user');
}
