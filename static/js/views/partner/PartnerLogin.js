// Dedicated sign-in page for driver partners (ride captains / valet drivers) - deliberately NOT
// the existing views/auth/Login.js. That page's two-way role switch (driver/lot-owner) and the
// existing app's "Driver" = parking-customer terminology would collide with this role, so a
// driver partner gets its own /partner/login instead. Same POST /api/login endpoint underneath,
// just with login_as: 'driver'.
import { api, post } from '../../api.js';
import { setSession } from '../../session.js';

export default {
  data() { return { email: '', password: '', show: false, busy: false, error: '', demo: false }; },
  created() { api('/api/time', { auth: false }).then(t => { this.demo = !!t.demo_mode; }).catch(() => {}); },
  methods: {
    fill(kind) { this.email = kind === 'captain' ? 'captain@driver.com' : 'valet@driver.com'; this.password = 'password'; this.error = ''; },
    async submit() {
      this.error = '';
      if (!this.email.trim() || !this.password) { this.error = 'Enter your email and password.'; return; }
      this.busy = true;
      try {
        const r = await post('/api/login', { email: this.email.trim(), password: this.password, login_as: 'driver' });
        setSession(r.user);
        const next = this.$route.query.next;
        const ok = typeof next === 'string' && next.startsWith('/partner') && !next.startsWith('//');
        this.$router.push(ok ? next : '/partner').catch(() => {});
        this.$toast.success(`Welcome back, ${r.user.username}!`);
      } catch (e) { this.error = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div class="auth">
    <aside class="auth-side" style="background:linear-gradient(160deg,#171233,#2c2360 70%,#4b2f8f)">
      <brand-logo to="/" light></brand-logo>
      <div>
        <h2>Drive, earn, repeat.</h2>
        <p>Sign in to accept rides or valet jobs, track your earnings and manage your verification.</p>
        <ul class="auth-points">
          <li><i class="bi bi-broadcast"></i><span>See nearby ride & valet requests the moment they come in</span></li>
          <li><i class="bi bi-shield-check"></i><span>Simple KYC & vehicle verification</span></li>
          <li><i class="bi bi-wallet2"></i><span>Track earnings, ratings and payouts in one place</span></li>
        </ul>
      </div>
      <div class="tiny" style="color:#c9c5e6">© VParkEasy · Driver partner program - demo payment gateway, no real money moves</div>
    </aside>

    <main class="auth-main">
      <div class="auth-top"><span class="muted">New driver partner?&nbsp;</span><router-link to="/partner/register" class="strong">Sign up to drive</router-link></div>
      <form class="card card-pad auth-card" @submit.prevent="submit" novalidate>
        <h1>Partner sign in</h1>
        <div class="muted">For ride captains and valet drivers.</div>

        <div v-if="error" class="alert bad mb-2" role="alert"><i class="bi bi-exclamation-octagon"></i><div>{{ error }}</div></div>

        <div class="field"><label for="pl-email">Email</label>
          <input id="pl-email" class="input" type="email" autocomplete="username" placeholder="you@example.com" v-model="email" autofocus></div>
        <div class="field"><label for="pl-pw">Password</label>
          <div class="pw-wrap">
            <input id="pl-pw" class="input" :type="show ? 'text' : 'password'" autocomplete="current-password" placeholder="Your password" v-model="password">
            <button type="button" class="icon-btn" @click="show = !show" :aria-label="show ? 'Hide password' : 'Show password'"><i :class="['bi', show ? 'bi-eye-slash' : 'bi-eye']"></i></button>
          </div></div>
        <button class="btn btn-lg btn-block" :disabled="busy" type="submit"><span v-if="busy" class="spin"></span>{{ busy ? 'Signing in…' : 'Sign in' }}</button>

        <div v-if="demo" class="demo-box">
          <div class="strong mb-1"><i class="bi bi-lightning-charge-fill ok-text"></i> Demo driver partner accounts</div>
          <div class="flex between items-center wrap gap-1"><span><span class="mono">captain@driver.com</span> / <span class="mono">password</span></span><button type="button" @click="fill('captain')">Use ride captain</button></div>
          <div class="flex between items-center wrap gap-1 mt-1"><span><span class="mono">valet@driver.com</span> / <span class="mono">password</span></span><button type="button" @click="fill('valet')">Use valet driver</button></div>
        </div>

        <div class="mt-3 small muted">Looking to book parking or manage a lot instead? <router-link to="/login">Sign in here</router-link>.</div>
      </form>
      <router-link to="/" class="small muted mt-3"><i class="bi bi-arrow-left"></i> Back to home</router-link>
    </main>
  </div>`,
};
