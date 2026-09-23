// Driver partner dashboard home: profile + verification status, current job (if any), quick
// earnings/rating stats, and a shortcut into the jobs pool.
import { get } from '../../api.js';
import { money } from '../../format.js';
import { partnerStore, refreshDriver, offlineReason, isRideActive, isValetActive, DRIVER_TYPE_LABEL, JobCard } from './partnerLib.js';

export default {
  components: { JobCard },
  data() { return { store: partnerStore, loading: true, error: '', current: null, earnings: null, rating: null }; },
  computed: {
    driver() { return this.store.driver; },
    isCaptain() { return this.driver && this.driver.driver_type === 'ride_captain'; },
    typeLabel() { return this.driver ? DRIVER_TYPE_LABEL[this.driver.driver_type] : ''; },
    kycMeta() {
      const s = this.driver && this.driver.kyc_status;
      if (s === 'APPROVED') return { cls: 'ok', icon: 'bi-patch-check-fill', label: 'KYC approved' };
      if (s === 'REJECTED') return { cls: 'bad', icon: 'bi-x-octagon-fill', label: 'KYC rejected' };
      if (s === 'EXPIRED') return { cls: 'bad', icon: 'bi-hourglass-bottom', label: 'KYC expired' };
      return { cls: 'warn', icon: 'bi-hourglass-split', label: 'KYC pending' };
    },
    vehicleMeta() {
      if (!this.isCaptain) return null;
      const v = this.driver && (this.driver.vehicles || []).find(x => x.status === 'APPROVED');
      if (v) return { cls: 'ok', icon: 'bi-check-circle-fill', label: `${v.reg_number} approved` };
      const pending = this.driver && (this.driver.vehicles || []).find(x => x.status === 'PENDING');
      if (pending) return { cls: 'warn', icon: 'bi-hourglass-split', label: `${pending.reg_number} pending review` };
      return { cls: 'bad', icon: 'bi-exclamation-triangle-fill', label: 'No vehicle on file' };
    },
    reason() { return offlineReason(this.driver); },
    currentKind() { return this.isCaptain ? 'ride' : 'valet'; },
  },
  async created() { await this.load(); this.$root.$on('partner-changed', this.load); },
  beforeDestroy() { this.$root.$off('partner-changed', this.load); },
  methods: {
    money,
    async load() {
      try {
        await refreshDriver();
        const captain = this.isCaptain;
        const [mine, earn, rate] = await Promise.all([
          get(captain ? '/api/driver/rides' : '/api/driver/valet'),
          get('/api/driver/earnings'), get('/api/driver/ratings'),
        ]);
        const list = captain ? mine.rides : mine.valet_requests;
        this.current = list.find(j => captain ? isRideActive(j.status) && j.status !== 'REQUESTED' : isValetActive(j.status)) || null;
        this.earnings = earn; this.rating = rate;
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    open(job) { this.$router.push(`/partner/jobs/${this.currentKind}/${job.id}`); },
  },
  template: `
  <div>
    <section class="p-hero">
      <h1>{{ driver ? ('Hey, ' + driver.full_name.split(' ')[0]) : 'Welcome' }} 👋</h1>
      <p v-if="driver">{{ typeLabel }} partner · {{ driver.can_go_online ? 'You are all set to go online.' : 'A few things need your attention before you can go online.' }}</p>
      <div class="p-hero-toggle" v-if="driver && !driver.can_go_online">
        <div class="flex items-center gap-2"><i class="bi bi-exclamation-triangle-fill" style="color:#ffd166"></i><span>{{ reason }}</span></div>
      </div>
    </section>

    <div v-if="error" class="alert bad mt-3"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>

    <div class="grid grid-2 mt-3" v-if="driver">
      <div class="card card-pad"><div class="flex between items-center"><span class="muted small strong">VERIFICATION</span><router-link to="/partner/kyc" class="small strong">Manage →</router-link></div>
        <div class="ver-badge mt-2" :class="kycMeta.cls"><i :class="['bi', kycMeta.icon]"></i>{{ kycMeta.label }}</div></div>
      <div class="card card-pad" v-if="vehicleMeta"><div class="flex between items-center"><span class="muted small strong">VEHICLE</span><router-link to="/partner/vehicle" class="small strong">Manage →</router-link></div>
        <div class="ver-badge mt-2" :class="vehicleMeta.cls"><i :class="['bi', vehicleMeta.icon]"></i>{{ vehicleMeta.label }}</div></div>
      <div class="card card-pad" v-else><div class="flex between items-center"><span class="muted small strong">ACCOUNT STATUS</span></div>
        <div class="ver-badge mt-2" :class="driver.account_status === 'active' ? 'ok' : 'bad'"><i class="bi bi-shield-check"></i>{{ driver.account_status === 'active' ? 'Active' : 'Suspended' }}</div></div>
    </div>

    <div v-if="loading" class="grid grid-4 mt-3"><div v-for="i in 4" :key="i" class="skeleton" style="height:76px"></div></div>
    <div class="stat-cards" v-else-if="earnings">
      <div class="stat-card"><span class="ic"><i class="bi bi-wallet2"></i></span><div><b>{{ money(earnings.today_earnings) }}</b><span>Earned today</span></div></div>
      <div class="stat-card"><span class="ic blue"><i class="bi bi-cash-stack"></i></span><div><b>{{ money(earnings.total_earnings) }}</b><span>Total earnings</span></div></div>
      <div class="stat-card"><span class="ic amber"><i class="bi bi-check2-circle"></i></span><div><b>{{ earnings.completed_rides + earnings.completed_valet_jobs }}</b><span>Completed jobs</span></div></div>
      <div class="stat-card"><span class="ic"><i class="bi bi-star-fill"></i></span><div><b>{{ rating && rating.average != null ? rating.average.toFixed(1) : '—' }}</b><span>Rating ({{ rating ? rating.count : 0 }})</span></div></div>
    </div>

    <div class="section-title mt-3"><h3>Current job</h3><router-link to="/partner/jobs" class="small strong">All jobs →</router-link></div>
    <job-card v-if="current" :job="current" :kind="currentKind" @open="open(current)"></job-card>
    <div v-else-if="!loading" class="card">
      <empty-state icon="bi-broadcast" title="No active job right now"
        :text="driver && driver.can_go_online ? 'Go online from the sidebar and accept a job from the pool when it comes in.' : 'Finish verification to start receiving jobs.'">
        <router-link to="/partner/jobs" class="btn mt-2">View job pool</router-link>
      </empty-state>
    </div>
  </div>`,
};
