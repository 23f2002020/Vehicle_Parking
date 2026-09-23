// One place for every HTTP call: auth header, JSON handling, friendly errors, 401 handling.
import { session, clearSession } from './session.js';
import { syncClock } from './clock.js';

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; this.code = (data && data.code) || null; }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function withQuery(path, params) {
  if (!params) return path;
  const qs = new URLSearchParams();
  Object.keys(params).forEach(k => {
    const v = params[k];
    if (v !== undefined && v !== null && v !== '') qs.append(k, v);
  });
  const s = qs.toString();
  return s ? path + (path.includes('?') ? '&' : '?') + s : path;
}

export async function api(path, opts = {}) {
  const { method = 'GET', body, params, auth = true } = opts;
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && session.token) headers['Authentication-Token'] = session.token;

  let res;
  try {
    res = await fetch(withQuery(path, params), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new ApiError("Can't reach the server. Check your connection and that the app is running.", 0, null);
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

  if (data && data.server_time) syncClock(data.server_time);
  if (!res.ok) {
    if (res.status === 401 && auth && session.token) { clearSession(); onUnauthorized(); }
    const msg = (data && data.message) || (res.status >= 500 ? 'Something went wrong on the server. Please try again.' : `Request failed (${res.status})`);
    throw new ApiError(msg, res.status, data);
  }
  return data;
}

export const get = (p, params) => api(p, { params });
export const post = (p, body) => api(p, { method: 'POST', body: body || {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body || {} });
export const patch = (p, body) => api(p, { method: 'PATCH', body: body || {} });
export const del = (p) => api(p, { method: 'DELETE' });
