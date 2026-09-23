import { session, homeFor } from '../session.js';

export default {
  data() { return { s: session }; },
  computed: { home() { return this.s.token && this.s.user ? homeFor() : '/'; } },
  template: `
  <div class="notfound">
    <div>
      <brand-logo to="/"></brand-logo>
      <div class="big mt-3">404</div>
      <h2>This spot is empty</h2>
      <p class="muted">The page you are looking for does not exist or has moved.</p>
      <router-link :to="home" class="btn btn-lg mt-2"><i class="bi bi-house"></i> Back to {{ s.token ? 'my dashboard' : 'home' }}</router-link>
    </div>
  </div>`,
};
