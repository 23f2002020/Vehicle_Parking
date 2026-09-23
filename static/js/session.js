// Session store: who is logged in. Persisted in localStorage (wrapped - it can throw in private windows).
const KEY_T = 'vp_token', KEY_U = 'vp_user';

function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function write(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

function loadUser() { try { return JSON.parse(read(KEY_U) || 'null'); } catch (e) { return null; } }

export const session = Vue.observable({
  token: read(KEY_T),
  user: loadUser(),
  demo: false,
  ready: false,           // true once /api/me was checked on boot
});

export function setSession(user) {
  session.token = user.auth_token;
  session.user = { id: user.id, username: user.username, email: user.email, roles: user.roles, phone: user.phone };
  session.demo = !!user.demo_mode;
  write(KEY_T, session.token);
  write(KEY_U, JSON.stringify(session.user));
}

export function updateUser(patch) {
  session.user = Object.assign({}, session.user, patch);
  write(KEY_U, JSON.stringify(session.user));
}

export function clearSession() {
  session.token = null; session.user = null;
  write(KEY_T, null); write(KEY_U, null);
}

export const isAdmin = () => !!(session.user && session.user.roles.includes('admin'));
export const isDriver = () => !!(session.user && session.user.roles.includes('user'));
// "driver partner" (ride captain / valet driver) - backend role is literally "driver" (see
// Applications/driver_service.py's module docstring for why); named isPartner() here, not
// isDriver(), because that name is already taken by the parking-customer role above.
export const isPartner = () => !!(session.user && session.user.roles.includes('driver'));
export const homeFor = () => (isAdmin() ? '/admin' : isPartner() ? '/partner' : '/app');
