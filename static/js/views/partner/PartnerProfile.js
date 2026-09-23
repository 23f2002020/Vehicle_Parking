// Driver partner profile. Personal/licence details live on the Driver profile (PUT /api/driver/me);
// account email/phone/password reuse the existing PUT /api/profile endpoint - the same one
// static/js/views/user/Profile.js uses - so nothing about account management is duplicated.
import { get, put } from '../../api.js';
import { updateUser } from '../../session.js';
import { partnerStore, refreshDriver, PhotoPicker, DRIVER_TYPE_LABEL } from './partnerLib.js';

export default {
  components: { PhotoPicker },
  data() {
    return {
      store: partnerStore, loading: true, busy: false, err: '',
      form: { full_name: '', dob: '', address: '', profile_photo: null },
      acc: { username: '', email: '', phone: '', address: '' }, accBusy: false, accErr: '',
      pw: { current: '', next: '', again: '' }, pwBusy: false, pwErr: '',
    };
  },
  computed: {
    driver() { return this.store.driver; },
    typeLabel() { return this.driver ? DRIVER_TYPE_LABEL[this.driver.driver_type] : ''; },
    pwOk() { return this.pw.current && this.pw.next.length >= 6 && this.pw.next === this.pw.again; },
  },
  async created() {
    try {
      const d = await refreshDriver();
      this.form = { full_name: d.full_name, dob: d.dob ? d.dob.slice(0, 10) : '', address: d.address || '', profile_photo: d.profile_photo };
      const u = await get('/api/profile');
      this.acc = { username: u.username, email: u.email, phone: u.phone || '', address: u.address || '' };
    } catch (e) { this.err = e.message; }
    this.loading = false;
  },
  methods: {
    async save() {
      this.busy = true; this.err = '';
      try {
        const r = await put('/api/driver/me', this.form);
        this.store.driver = r.driver;
        this.$toast.success('Profile saved');
      } catch (e) { this.err = e.message; }
      this.busy = false;
    },
    async saveAccount() {
      this.accBusy = true; this.accErr = '';
      try {
        const r = await put('/api/profile', this.acc);
        updateUser({ username: r.user.username, email: r.user.email, phone: r.user.phone });
        this.$toast.success('Account details saved');
      } catch (e) { this.accErr = e.message; }
      this.accBusy = false;
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
  <div>
    <div class="p-page-head"><div><h1>My profile</h1><p>{{ typeLabel }} partner details.</p></div></div>
    <div v-if="loading" class="skeleton" style="height:300px"></div>
    <div v-else class="profile-grid">
      <form class="card" @submit.prevent="save">
        <div class="card-head"><h3>Personal details</h3><span class="pill">{{ typeLabel }}</span></div>
        <div class="card-body">
          <div v-if="err" class="alert bad mb-2"><i class="bi bi-exclamation-octagon"></i><div>{{ err }}</div></div>
          <photo-picker v-model="form.profile_photo" label="Profile photo" round></photo-picker>
          <div class="field"><label>Full name</label><input class="input" v-model="form.full_name"></div>
          <div class="field"><label>Date of birth</label><input class="input" type="date" v-model="form.dob"></div>
          <div class="field"><label>Address</label><input class="input" v-model="form.address"></div>
          <button class="btn" :disabled="busy"><span v-if="busy" class="spin"></span>Save changes</button>
        </div>
      </form>

      <div class="stack">
        <form class="card" @submit.prevent="saveAccount">
          <div class="card-head"><h3>Account</h3></div>
          <div class="card-body">
            <div v-if="accErr" class="alert bad mb-2"><i class="bi bi-exclamation-octagon"></i><div>{{ accErr }}</div></div>
            <div class="field"><label>Username</label><input class="input" v-model="acc.username"></div>
            <div class="field"><label>Email</label><input class="input" type="email" v-model="acc.email"></div>
            <div class="field"><label>Phone</label><input class="input" v-model="acc.phone" placeholder="+91 98765 43210"></div>
            <button class="btn btn-dark" :disabled="accBusy"><span v-if="accBusy" class="spin"></span>Save account</button>
          </div>
        </form>

        <form class="card" @submit.prevent="changePw">
          <div class="card-head"><h3>Change password</h3></div>
          <div class="card-body">
            <div v-if="pwErr" class="alert bad mb-2"><i class="bi bi-exclamation-octagon"></i><div>{{ pwErr }}</div></div>
            <div class="field"><label>Current password</label><input class="input" type="password" autocomplete="current-password" v-model="pw.current"></div>
            <div class="field"><label>New password</label><input class="input" type="password" autocomplete="new-password" v-model="pw.next"><div class="hint">At least 6 characters.</div></div>
            <div class="field"><label>Repeat new password</label><input class="input" type="password" autocomplete="new-password" v-model="pw.again">
              <div class="error-text" v-if="pw.again && pw.again !== pw.next">Passwords do not match.</div></div>
            <button class="btn btn-dark" :disabled="pwBusy || !pwOk"><span v-if="pwBusy" class="spin"></span>Update password</button>
          </div>
        </form>
      </div>
    </div>
  </div>`,
};
