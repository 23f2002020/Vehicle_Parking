// Profile + password. Shared by the driver and lot-owner dashboards.
import { get, put } from '../../api.js';
import { session, updateUser, isAdmin } from '../../session.js';

export default {
  data() {
    return { s: session, loading: true, busy: false, err: '', pwBusy: false, pwErr: '',
      form: { username: '', email: '', phone: '', address: '' }, pw: { current: '', next: '', again: '' }, user: null };
  },
  computed: {
    admin() { return isAdmin(); },
    pwOk() { return this.pw.current && this.pw.next.length >= 6 && this.pw.next === this.pw.again; },
  },
  async created() {
    try { this.fill(await get('/api/profile')); } catch (e) { this.err = e.message; }
    this.loading = false;
  },
  methods: {
    fill(u) { this.user = u; this.form = { username: u.username, email: u.email, phone: u.phone || '', address: u.address || '' }; },
    async save() {
      this.busy = true; this.err = '';
      try {
        const r = await put('/api/profile', this.form);
        this.fill(r.user); updateUser({ username: r.user.username, email: r.user.email, phone: r.user.phone });
        this.$toast.success('Profile saved');
      } catch (e) { this.err = e.message; }
      this.busy = false;
    },
    async changePw() {
      this.pwBusy = true; this.pwErr = '';
      try {
        await put('/api/profile', { current_password: this.pw.current, new_password: this.pw.next });
        this.pw = { current: '', next: '', again: '' };
        this.$toast.success('Password changed');
      } catch (e) { this.pwErr = e.message; }
      this.pwBusy = false;
    },
  },
  template: `
  <div :class="admin ? 'a-page' : ''">
    <div class="page-head"><div><h1>My profile</h1><p>Your account details{{ admin ? ' as a lot owner' : '' }}.</p></div></div>
    <div v-if="loading" class="skeleton" style="height:300px"></div>
    <div v-else class="profile-grid">
      <form class="card" @submit.prevent="save">
        <div class="card-head"><h3>Personal details</h3><span class="pill">{{ admin ? 'Lot owner' : 'Driver' }}</span></div>
        <div class="card-body">
          <div v-if="err" class="alert bad mb-2"><i class="bi bi-exclamation-octagon"></i><div>{{ err }}</div></div>
          <div class="field"><label for="p-name">Username</label><input id="p-name" class="input" v-model="form.username"></div>
          <div class="field"><label for="p-email">Email</label><input id="p-email" class="input" type="email" v-model="form.email"></div>
          <div class="field"><label for="p-phone">Phone</label><input id="p-phone" class="input" v-model="form.phone" placeholder="+91 98765 43210"></div>
          <div class="field"><label for="p-addr">Address</label><input id="p-addr" class="input" v-model="form.address"></div>
          <button class="btn" :disabled="busy"><span v-if="busy" class="spin"></span>Save changes</button>
        </div>
      </form>
      <div class="stack">
        <form class="card" @submit.prevent="changePw">
          <div class="card-head"><h3>Change password</h3></div>
          <div class="card-body">
            <div v-if="pwErr" class="alert bad mb-2"><i class="bi bi-exclamation-octagon"></i><div>{{ pwErr }}</div></div>
            <div class="field"><label for="pw-c">Current password</label><input id="pw-c" class="input" type="password" autocomplete="current-password" v-model="pw.current"></div>
            <div class="field"><label for="pw-n">New password</label><input id="pw-n" class="input" type="password" autocomplete="new-password" v-model="pw.next"><div class="hint">At least 6 characters.</div></div>
            <div class="field"><label for="pw-a">Repeat new password</label><input id="pw-a" class="input" type="password" autocomplete="new-password" v-model="pw.again">
              <div class="error-text" v-if="pw.again && pw.again !== pw.next">Passwords do not match.</div></div>
            <button class="btn btn-dark" :disabled="pwBusy || !pwOk"><span v-if="pwBusy" class="spin"></span>Update password</button>
          </div>
        </form>
        <div class="card card-pad" v-if="!admin && user"><div class="kv"><span>Member since</span><span>{{ new Date(user.created_at).toLocaleDateString() }}</span></div>
          <div class="kv"><span>Free allowance left</span><span>{{ user.free_minutes_remaining }} min</span></div></div>
      </div>
    </div>
  </div>`,
};
