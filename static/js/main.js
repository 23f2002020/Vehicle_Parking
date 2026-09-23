import { api, setUnauthorizedHandler } from './api.js';
import { session, clearSession, updateUser } from './session.js';
import { registerUi, toast } from './components/ui.js';
import router from './router.js';
import App from './App.js';

registerUi();

// A 401 anywhere (expired / revoked token) sends the user to the login page.
setUnauthorizedHandler(() => {
  toast.error('Your session has expired. Please sign in again.');
  const here = router.currentRoute;
  if (!here.meta.guest && here.path !== '/') router.replace({ path: '/login', query: { next: here.fullPath } }).catch(() => {});
});

new Vue({ el: '#app', router, render: h => h(App) });

// Validate a stored token in the background: refreshes the roles, demo flag and server clock.
if (session.token) {
  api('/api/me').then(me => {
    updateUser({ username: me.username, email: me.email, phone: me.phone });
    session.demo = !!me.demo_mode;
  }).catch(() => { /* a 401 is handled by the handler above */ });
}
