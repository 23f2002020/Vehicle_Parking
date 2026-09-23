import { post } from '../../api.js';
import { setSession } from '../../session.js';
import { AUTH_POINTS } from './Login.js';

export default {
  data() {
    return { as: 'user', username: '', email: '', password: '', confirm: '', show: false, busy: false, error: '', touched: false };
  },
  computed: {
    points() { return AUTH_POINTS[this.as]; },
    emailOk() { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.email.trim()); },
    strength() {
      const p = this.password; if (!p) return 0;
      let s = 0;
      if (p.length >= 6) s++;
      if (p.length >= 10) s++;
      if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
      if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
      return Math.max(1, s);
    },
    errors() {
      const e = {};
      if (this.username.trim().length < 3) e.username = 'At least 3 characters.';
      if (!this.emailOk) e.email = 'Enter a valid email address.';
      if (this.password.length < 6) e.password = 'At least 6 characters.';
      if (this.confirm !== this.password) e.confirm = 'Passwords do not match.';
      return e;
    },
    valid() { return Object.keys(this.errors).length === 0; },
  },
  created() {
    const a = this.$route.query.as;
    if (a === 'admin' || a === 'user') this.as = a;
  },
  methods: {
    async submit() {
      this.touched = true; this.error = '';
      if (!this.valid) return;
      this.busy = true;
      try {
        const email = this.email.trim().toLowerCase();
        await post('/api/register', { username: this.username.trim(), email, password: this.password, role: this.as });
        // sign the new account straight in
        const r = await post('/api/login', { email, password: this.password, login_as: this.as });
        setSession(r.user);
        this.$toast.success(this.as === 'admin' ? 'Owner account created - add your first lot!' : 'Account created - enjoy 60 free minutes!');
        this.$router.push(this.as === 'admin' ? '/admin/lots' : '/app').catch(() => {});
      } catch (e) {
        this.error = e.message;
      }
      this.busy = false;
    },
  },
  template: `
  <div class="auth">
    <aside class="auth-side">
      <brand-logo to="/" light></brand-logo>
      <div>
        <h2>{{ as === 'admin' ? 'List your parking lot in minutes.' : 'Create your account and park easy.' }}</h2>
        <p>{{ as === 'admin' ? 'Define your layout once - VParkEasy generates the slots and runs the bookings.' : 'New drivers get 60 free minutes on their first booking.' }}</p>
        <ul class="auth-points"><li v-for="p in points" :key="p.t"><i :class="['bi', p.i]"></i><span>{{ p.t }}</span></li></ul>
      </div>
      <div class="tiny" style="color:#98a0c2">© VParkEasy · Demo payment gateway - no real money moves</div>
    </aside>

    <main class="auth-main">
      <div class="auth-top"><span class="muted">Already registered?&nbsp;</span><router-link :to="{ path: '/login', query: { as } }" class="strong">Sign in</router-link></div>
      <form class="card card-pad auth-card" @submit.prevent="submit" novalidate>
        <h1>Create account</h1>
        <div class="muted">It takes less than a minute.</div>

        <div class="role-switch">
          <button type="button" :class="['role-opt', { active: as === 'user' }]" @click="as = 'user'"><i class="bi bi-car-front"></i><div><b>I'm a user</b><span>Find & book parking</span></div></button>
          <button type="button" :class="['role-opt', { active: as === 'admin' }]" @click="as = 'admin'"><i class="bi bi-buildings"></i><div><b>I own a lot</b><span>List & manage parking</span></div></button>
        </div>

        <div v-if="error" class="alert bad mb-2" role="alert"><i class="bi bi-exclamation-octagon"></i><div>{{ error }}</div></div>

        <div class="field"><label for="rg-name">Username</label>
          <input id="rg-name" class="input" autocomplete="username" placeholder="e.g. rahul_k" v-model="username" :class="{ invalid: touched && errors.username }">
          <div class="error-text" v-if="touched && errors.username">{{ errors.username }}</div></div>
        <div class="field"><label for="rg-email">Email</label>
          <input id="rg-email" class="input" type="email" autocomplete="email" placeholder="you@example.com" v-model="email" :class="{ invalid: touched && errors.email }">
          <div class="error-text" v-if="touched && errors.email">{{ errors.email }}</div></div>
        <div class="field"><label for="rg-pw">Password</label>
          <div class="pw-wrap">
            <input id="rg-pw" class="input" :type="show ? 'text' : 'password'" autocomplete="new-password" placeholder="At least 6 characters" v-model="password" :class="{ invalid: touched && errors.password }">
            <button type="button" class="icon-btn" @click="show = !show" :aria-label="show ? 'Hide password' : 'Show password'"><i :class="['bi', show ? 'bi-eye-slash' : 'bi-eye']"></i></button>
          </div>
          <div :class="['strength', 's' + strength]" v-if="password"><i></i><i></i><i></i><i></i></div>
          <div class="error-text" v-if="touched && errors.password">{{ errors.password }}</div></div>
        <div class="field"><label for="rg-cf">Confirm password</label>
          <input id="rg-cf" class="input" :type="show ? 'text' : 'password'" autocomplete="new-password" v-model="confirm" :class="{ invalid: touched && errors.confirm }">
          <div class="error-text" v-if="touched && errors.confirm">{{ errors.confirm }}</div></div>

        <button class="btn btn-lg btn-block" :disabled="busy" type="submit"><span v-if="busy" class="spin"></span>{{ busy ? 'Creating account…' : 'Create account' }}</button>
      </form>
      <router-link to="/" class="small muted mt-3"><i class="bi bi-arrow-left"></i> Back to home</router-link>
    </main>
  </div>`,
};
