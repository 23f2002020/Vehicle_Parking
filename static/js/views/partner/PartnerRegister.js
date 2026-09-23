// Dedicated sign-up page for driver partners. Kept separate from views/auth/Register.js on
// purpose - a driver partner needs a much larger field set (DOB, address, licence, driver type,
// photos) than the generic driver/lot-owner sign-up form, and reusing that form's role switch
// would reintroduce the "Driver" naming collision (see driver_service.py's module docstring).
import { post } from '../../api.js';
import { setSession } from '../../session.js';
import { PhotoPicker } from './partnerLib.js';

const TYPES = [
  { v: 'ride_captain', icon: 'bi-car-front-fill', title: 'Ride captain', text: 'Drive your own vehicle for point-to-point rides, Uber/Rapido-style.' },
  { v: 'valet_driver', icon: 'bi-key-fill', title: 'Valet driver', text: 'Drive a rider’s own vehicle between their home/location and a parking lot.' },
];

export default {
  components: { PhotoPicker },
  data() {
    return {
      types: TYPES, driver_type: 'ride_captain', busy: false, error: '', show: false, touched: false,
      form: { full_name: '', username: '', email: '', phone: '', password: '', confirm: '', dob: '', address: '',
        profile_photo: null, licence_number: '', licence_document: null, licence_expiry: '' },
    };
  },
  computed: {
    emailOk() { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(this.form.email.trim()); },
    errors() {
      const e = {};
      if (this.form.full_name.trim().length < 2) e.full_name = 'Enter your full name.';
      if (this.form.username.trim().length < 3) e.username = 'At least 3 characters.';
      if (!this.emailOk) e.email = 'Enter a valid email address.';
      if (this.form.password.length < 6) e.password = 'At least 6 characters.';
      if (this.form.confirm !== this.form.password) e.confirm = 'Passwords do not match.';
      if (this.form.licence_number.trim().length < 4) e.licence_number = 'Enter a valid licence number.';
      return e;
    },
    valid() { return Object.keys(this.errors).length === 0; },
  },
  methods: {
    async submit() {
      this.touched = true; this.error = '';
      if (!this.valid) return;
      this.busy = true;
      try {
        const body = Object.assign({}, this.form, { driver_type: this.driver_type, email: this.form.email.trim().toLowerCase() });
        delete body.confirm;
        const r = await post('/api/driver/register', body);
        setSession(r.user);
        this.$toast.success('Welcome aboard! Submit your KYC to start going online.');
        this.$router.push('/partner').catch(() => {});
      } catch (e) { this.error = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div class="auth">
    <aside class="auth-side" style="background:linear-gradient(160deg,#171233,#2c2360 70%,#4b2f8f)">
      <brand-logo to="/" light></brand-logo>
      <div>
        <h2>Become a VParkEasy driver partner.</h2>
        <p>Pick how you want to drive - we'll walk you through verification next.</p>
        <ul class="auth-points">
          <li><i class="bi bi-lightning-charge"></i><span>Start seeing job requests once your KYC is approved</span></li>
          <li><i class="bi bi-cash-coin"></i><span>Transparent per-job fares - no surprises</span></li>
          <li><i class="bi bi-star"></i><span>Build your rating with every completed job</span></li>
        </ul>
      </div>
      <div class="tiny" style="color:#c9c5e6">© VParkEasy · Dummy KYC & payments - this is a demo</div>
    </aside>

    <main class="auth-main">
      <div class="auth-top"><span class="muted">Already a driver partner?&nbsp;</span><router-link to="/partner/login" class="strong">Sign in</router-link></div>
      <form class="card card-pad auth-card" @submit.prevent="submit" novalidate>
        <h1>Sign up to drive</h1>
        <div class="muted">Takes about two minutes.</div>

        <div class="role-switch">
          <button type="button" v-for="t in types" :key="t.v" :class="['role-opt', { active: driver_type === t.v }]" @click="driver_type = t.v">
            <i :class="['bi', t.icon]"></i><div><b>{{ t.title }}</b><span>{{ t.text }}</span></div></button>
        </div>

        <div v-if="error" class="alert bad mb-2" role="alert"><i class="bi bi-exclamation-octagon"></i><div>{{ error }}</div></div>

        <div class="grid grid-2">
          <div class="field"><label>Full name</label><input class="input" v-model="form.full_name" :class="{ invalid: touched && errors.full_name }">
            <div class="error-text" v-if="touched && errors.full_name">{{ errors.full_name }}</div></div>
          <div class="field"><label>Phone</label><input class="input" v-model="form.phone" placeholder="+91 98765 43210"></div>
          <div class="field"><label>Username</label><input class="input" v-model="form.username" :class="{ invalid: touched && errors.username }">
            <div class="error-text" v-if="touched && errors.username">{{ errors.username }}</div></div>
          <div class="field"><label>Email</label><input class="input" type="email" v-model="form.email" :class="{ invalid: touched && errors.email }">
            <div class="error-text" v-if="touched && errors.email">{{ errors.email }}</div></div>
          <div class="field"><label>Password</label>
            <div class="pw-wrap"><input class="input" :type="show ? 'text' : 'password'" autocomplete="new-password" v-model="form.password" :class="{ invalid: touched && errors.password }">
              <button type="button" class="icon-btn" @click="show = !show"><i :class="['bi', show ? 'bi-eye-slash' : 'bi-eye']"></i></button></div>
            <div class="error-text" v-if="touched && errors.password">{{ errors.password }}</div></div>
          <div class="field"><label>Confirm password</label><input class="input" :type="show ? 'text' : 'password'" v-model="form.confirm" :class="{ invalid: touched && errors.confirm }">
            <div class="error-text" v-if="touched && errors.confirm">{{ errors.confirm }}</div></div>
          <div class="field"><label>Date of birth</label><input class="input" type="date" v-model="form.dob"></div>
          <div class="field"><label>Address</label><input class="input" v-model="form.address"></div>
        </div>

        <div class="divider"></div>
        <div class="strong mb-2"><i class="bi bi-card-checklist ok-text"></i> Driving licence (for KYC)</div>
        <div class="grid grid-2">
          <div class="field"><label>Licence number</label><input class="input mono" v-model="form.licence_number" :class="{ invalid: touched && errors.licence_number }">
            <div class="error-text" v-if="touched && errors.licence_number">{{ errors.licence_number }}</div></div>
          <div class="field"><label>Licence expiry</label><input class="input" type="date" v-model="form.licence_expiry"></div>
        </div>
        <photo-picker v-model="form.profile_photo" label="Profile photo" round></photo-picker>
        <photo-picker v-model="form.licence_document" label="Licence photo / document" hint="Submitting this now gets your KYC review started right away."></photo-picker>

        <button class="btn btn-lg btn-block mt-2" :disabled="busy" type="submit"><span v-if="busy" class="spin"></span>{{ busy ? 'Creating account…' : 'Create driver partner account' }}</button>
        <div class="mt-3 small muted">Looking to book parking or list a lot instead? <router-link to="/register">Create an account here</router-link>.</div>
      </form>
      <router-link to="/" class="small muted mt-3"><i class="bi bi-arrow-left"></i> Back to home</router-link>
    </main>
  </div>`,
};
