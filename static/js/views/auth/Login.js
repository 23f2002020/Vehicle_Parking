import { api, post } from '../../api.js';
import { setSession } from '../../session.js';

export const AUTH_POINTS = {
  user: [
    { i: 'bi-grid-3x3-gap', t: 'Pick your exact bay on a live slot map' },
    { i: 'bi-plus-circle', t: 'Extend your stay from your phone' },
    { i: 'bi-hourglass-split', t: 'A fair 45-minute gap between bookings' },
  ],
  admin: [
    { i: 'bi-buildings', t: 'Create lots - slots are generated for you' },
    { i: 'bi-activity', t: 'Live console for arrivals, parked cars and overstays' },
    { i: 'bi-graph-up-arrow', t: 'Revenue, occupancy and peak-hour analytics' },
  ],
};

export default {
  data() {
    return { as: 'user', email: '', password: '', show: false, busy: false, error: '', demo: false };
  },
  computed: { points() { return AUTH_POINTS[this.as]; } },
  created() {
    const a = this.$route.query.as;
    if (a === 'admin' || a === 'user') this.as = a;
    api('/api/time', { auth: false }).then(t => { this.demo = !!t.demo_mode; }).catch(() => {});
  },
  methods: {
    fill(kind) {
      this.as = kind;
      this.email = kind === 'admin' ? 'user@admin.com' : 'user@user.com';
      this.password = 'password';
      this.error = '';
    },
    async submit() {
      this.error = '';
      if (!this.email.trim() || !this.password) { this.error = 'Enter your email and password.'; return; }
      this.busy = true;
      try {
        const r = await post('/api/login', { email: this.email.trim(), password: this.password, login_as: this.as });
        setSession(r.user);
        const next = this.$route.query.next;
        const area = this.as === 'admin' ? '/admin' : '/app';
        const ok = typeof next === 'string' && next.startsWith(area) && !next.startsWith('//');
        this.$router.push(ok ? next : area).catch(() => {});
        this.$toast.success(`Welcome back, ${r.user.username}!`);
      } catch (e) {
        this.error = e.message;
        // wrong role selected? flip the switch for them
        if (e.code === 'wrong_role') this.as = this.as === 'admin' ? 'user' : 'admin';
      }
      this.busy = false;
    },
  },
  template: `
  <div class="auth">
    <aside class="auth-side">
      <brand-logo to="/" light></brand-logo>
      <div>
        <h2>{{ as === 'admin' ? 'Run your parking business from one console.' : 'Parking, sorted before you leave home.' }}</h2>
        <p>{{ as === 'admin' ? 'Manage lots, watch occupancy live and collect fines - all in one place.' : 'Sign in to book a slot, see the map, pay and extend on the go.' }}</p>
        <ul class="auth-points"><li v-for="p in points" :key="p.t"><i :class="['bi', p.i]"></i><span>{{ p.t }}</span></li></ul>
      </div>
      <div class="tiny" style="color:#98a0c2">© VParkEasy · Demo payment gateway - no real money moves</div>
    </aside>

    <main class="auth-main">
      <div class="auth-top"><span class="muted">New here?&nbsp;</span><router-link :to="{ path: '/register', query: { as } }" class="strong">Create an account</router-link></div>
      <form class="card card-pad auth-card" @submit.prevent="submit" novalidate>
        <h1>Sign in</h1>
        <div class="muted">Welcome back. Choose how you use VParkEasy.</div>

        <div class="role-switch">
          <button type="button" :class="['role-opt', { active: as === 'user' }]" @click="as = 'user'"><i class="bi bi-car-front"></i><div><b>User</b><span>Book & pay for parking</span></div></button>
          <button type="button" :class="['role-opt', { active: as === 'admin' }]" @click="as = 'admin'"><i class="bi bi-buildings"></i><div><b>Lot owner</b><span>Manage lots & revenue</span></div></button>
        </div>

        <div v-if="error" class="alert bad mb-2" role="alert"><i class="bi bi-exclamation-octagon"></i><div>{{ error }}</div></div>

        <div class="field"><label for="li-email">Email</label>
          <input id="li-email" class="input" type="email" autocomplete="username" placeholder="you@example.com" v-model="email" autofocus></div>
        <div class="field"><label for="li-pw">Password</label>
          <div class="pw-wrap">
            <input id="li-pw" class="input" :type="show ? 'text' : 'password'" autocomplete="current-password" placeholder="Your password" v-model="password">
            <button type="button" class="icon-btn" @click="show = !show" :aria-label="show ? 'Hide password' : 'Show password'"><i :class="['bi', show ? 'bi-eye-slash' : 'bi-eye']"></i></button>
          </div></div>
        <button class="btn btn-lg btn-block" :disabled="busy" type="submit"><span v-if="busy" class="spin"></span>{{ busy ? 'Signing in…' : 'Sign in as ' + (as === 'admin' ? 'lot owner' : 'user') }}</button>

        <div v-if="demo" class="demo-box">
          <div class="strong mb-1"><i class="bi bi-lightning-charge-fill ok-text"></i> Demo accounts</div>
          <div class="flex between items-center wrap gap-1"><span><span class="mono">user@user.com</span> / <span class="mono">password</span></span><button type="button" @click="fill('user')">Use user</button></div>
          <div class="flex between items-center wrap gap-1 mt-1"><span><span class="mono">user@admin.com</span> / <span class="mono">password</span></span><button type="button" @click="fill('admin')">Use owner</button></div>
        </div>
        <div class="mt-3 small muted">Driving for us instead? <router-link to="/partner/login">Sign in as a ride captain or valet driver →</router-link></div>
      </form>
      <router-link to="/" class="small muted mt-3"><i class="bi bi-arrow-left"></i> Back to home</router-link>
    </main>
  </div>`,
};
