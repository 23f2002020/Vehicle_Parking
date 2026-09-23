import { get, post } from '../../api.js';
import { relTime } from '../../format.js';
import { partnerStore, refreshDriver } from './partnerLib.js';

const ICONS = {
  kyc_approved: 'bi-patch-check-fill', kyc_rejected: 'bi-x-octagon-fill', kyc_expired: 'bi-hourglass-bottom',
  vehicle_approved: 'bi-check-circle-fill', vehicle_rejected: 'bi-x-octagon-fill',
  ride_cancelled: 'bi-x-circle', valet_cancelled: 'bi-x-circle', new_rating: 'bi-star-fill',
};

export default {
  data() { return { store: partnerStore, loading: true, error: '', items: [], busy: false }; },
  async created() { await this.load(); },
  methods: {
    relTime,
    icon(n) { return ICONS[n.kind] || 'bi-bell'; },
    linkFor(n) {
      if (n.ride_id) return `/partner/jobs/ride/${n.ride_id}`;
      if (n.valet_id) return `/partner/jobs/valet/${n.valet_id}`;
      return null;
    },
    async load() {
      try {
        await refreshDriver();
        const r = await get('/api/driver/notifications');
        this.items = r.notifications;
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    async markAll() {
      this.busy = true;
      try {
        await post('/api/driver/notifications', {});
        this.items = this.items.map(n => Object.assign({}, n, { read: true }));
        this.$root.$emit('partner-changed');
      } catch (e) { this.$toast.error(e.message); }
      this.busy = false;
    },
    async open(n) {
      if (!n.read) {
        try { await post('/api/driver/notifications', { id: n.id }); n.read = true; this.$root.$emit('partner-changed'); } catch (e) { /* non-critical */ }
      }
      const link = this.linkFor(n);
      if (link) this.$router.push(link);
    },
  },
  template: `
  <div>
    <div class="p-page-head">
      <div><h1>Notifications</h1><p>Updates about your verification, jobs and ratings.</p></div>
      <button class="btn btn-outline" :disabled="busy || !items.some(n => !n.read)" @click="markAll">Mark all read</button>
    </div>

    <div v-if="error" class="alert bad mb-3"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height:60px"></div></div>
    <div v-else-if="!items.length" class="card"><empty-state icon="bi-bell" title="No notifications yet" text="You'll hear about KYC decisions, job cancellations and new ratings here."></empty-state></div>
    <div v-else class="card">
      <div v-for="n in items" :key="n.id" class="mini-row" style="padding:14px 16px;cursor:pointer" :style="!n.read ? 'background:var(--brand-50)' : ''" @click="open(n)">
        <div class="mini-ic"><i :class="['bi', icon(n)]"></i></div>
        <div class="grow"><div class="strong">{{ n.title }}</div><div class="small muted">{{ n.message }}</div><div class="tiny muted">{{ relTime(n.at, Date.now()) }}</div></div>
        <span v-if="!n.read" class="pill info">New</span>
      </div>
    </div>
  </div>`,
};
