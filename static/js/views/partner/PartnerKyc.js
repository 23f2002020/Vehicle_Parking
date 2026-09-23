// Dummy KYC (see FIXES.md - no real verification provider): submit/resubmit licence details for
// an admin to approve, reject (with a reason) or mark expired.
import { get, post } from '../../api.js';
import { dt } from '../../format.js';
import { partnerStore, refreshDriver, PhotoPicker } from './partnerLib.js';

const META = {
  APPROVED: { cls: 'ok', icon: 'bi-patch-check-fill', label: 'Approved', text: "You're verified and can go online." },
  PENDING: { cls: 'warn', icon: 'bi-hourglass-split', label: 'Pending review', text: 'An admin will review your submission shortly.' },
  REJECTED: { cls: 'bad', icon: 'bi-x-octagon-fill', label: 'Rejected', text: 'Please fix the issue below and resubmit.' },
  EXPIRED: { cls: 'bad', icon: 'bi-hourglass-bottom', label: 'Expired', text: 'Your KYC has expired - please resubmit.' },
};

export default {
  components: { PhotoPicker },
  data() {
    return { store: partnerStore, loading: true, error: '', history: [], busy: false, formError: '',
      form: { licence_number: '', licence_document: null, licence_expiry: '' } };
  },
  computed: {
    driver() { return this.store.driver; },
    status() { return this.driver ? this.driver.kyc_status : 'PENDING'; },
    meta() { return META[this.status] || META.PENDING; },
    latestReason() { const h = this.history[0]; return h && h.reject_reason; },
    canResubmit() { return this.status !== 'APPROVED'; },
  },
  async created() { await this.load(); },
  methods: {
    dt,
    async load() {
      try {
        const d = await refreshDriver();
        const r = await get('/api/driver/kyc');
        this.history = r.history;
        this.form.licence_number = d.licence_number || '';
        this.form.licence_expiry = d.licence_expiry ? d.licence_expiry.slice(0, 10) : '';
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    async submit() {
      this.busy = true; this.formError = '';
      try {
        const r = await post('/api/driver/kyc', this.form);
        this.$toast.success(r.message);
        this.$root.$emit('partner-changed');
        this.form.licence_document = null;
        await this.load();
      } catch (e) { this.formError = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div class="p-page-head"><div><h1>Verification (KYC)</h1><p>Your driving licence is checked before you can go online and accept jobs.</p></div></div>

    <div v-if="error" class="alert bad mb-3"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="skeleton" style="height:200px"></div>

    <div v-else class="two-col">
      <div class="stack">
        <div class="card card-pad">
          <div class="ver-badge" :class="meta.cls" style="font-size:1rem"><i :class="['bi', meta.icon]"></i>{{ meta.label }}</div>
          <p class="mt-2 mb-0">{{ meta.text }}</p>
          <div class="alert bad mt-2 small" v-if="latestReason && status !== 'APPROVED'"><i class="bi bi-exclamation-triangle"></i><div>{{ latestReason }}</div></div>
        </div>

        <form class="card" v-if="canResubmit" @submit.prevent="submit">
          <div class="card-head"><h3>{{ status === 'PENDING' ? 'Resubmit details' : 'Submit for verification' }}</h3></div>
          <div class="card-body">
            <div v-if="formError" class="alert bad mb-2"><i class="bi bi-exclamation-octagon"></i><div>{{ formError }}</div></div>
            <div class="field"><label>Driving licence number</label><input class="input mono" v-model="form.licence_number" placeholder="KA0120230012345" required></div>
            <div class="field"><label>Licence expiry</label><input class="input" type="date" v-model="form.licence_expiry"></div>
            <photo-picker v-model="form.licence_document" label="Licence photo / document" hint="A clear photo of your driving licence."></photo-picker>
            <button class="btn" :disabled="busy || !form.licence_number"><span v-if="busy" class="spin"></span>Submit</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-head"><h3>History</h3></div>
        <div class="card-body">
          <div v-if="!history.length" class="empty small" style="padding:20px"><i class="bi bi-inbox"></i>No submissions yet.</div>
          <div class="timeline" v-else>
            <div v-for="(h, i) in history" :key="i" :class="['tl-item', h.status === 'REJECTED' || h.status === 'EXPIRED' ? 'bad' : '']">
              <div><b>{{ h.status }}</b><span v-if="h.reject_reason"> - {{ h.reject_reason }}</span></div>
              <div class="when">Submitted {{ dt(h.submitted_at) }}<template v-if="h.reviewed_at"> · Reviewed {{ dt(h.reviewed_at) }}</template></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
