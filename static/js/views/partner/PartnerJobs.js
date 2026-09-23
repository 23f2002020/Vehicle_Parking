// Available job pool + my active job + history - dynamic by driver_type (rides for ride
// captains, valet requests for valet drivers). Accepting from the pool is a race between
// drivers, so it posts straight from the list instead of forcing a trip through the detail page.
import { get, post } from '../../api.js';
import { partnerStore, refreshDriver, isRideActive, isValetActive, JobCard } from './partnerLib.js';

const TABS = [
  { k: 'available', l: 'Available', icon: 'bi-broadcast' },
  { k: 'active', l: 'Active', icon: 'bi-lightning-charge' },
  { k: 'history', l: 'History', icon: 'bi-clock-history' },
];

export default {
  components: { JobCard },
  data() {
    return { store: partnerStore, loading: true, error: '', tabs: TABS,
      tab: (this.$route.query.tab && TABS.some(t => t.k === this.$route.query.tab)) ? this.$route.query.tab : 'available',
      pool: [], mine: [], acceptingId: null };
  },
  computed: {
    driver() { return this.store.driver; },
    isCaptain() { return this.driver && this.driver.driver_type === 'ride_captain'; },
    kind() { return this.isCaptain ? 'ride' : 'valet'; },
    activeList() { return this.mine.filter(j => this.isCaptain ? isRideActive(j.status) : isValetActive(j.status)); },
    historyList() {
      return this.mine.filter(j => !(this.isCaptain ? isRideActive(j.status) : isValetActive(j.status)))
        .sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at));
    },
    shown() { return this.tab === 'available' ? this.pool : (this.tab === 'active' ? this.activeList : this.historyList); },
    emptyTitle() { return this.tab === 'available' ? 'No jobs waiting right now' : this.tab === 'active' ? 'Nothing active' : 'No history yet'; },
    emptyText() {
      if (this.tab === 'available') return 'New requests show up here the moment a rider posts one nearby.';
      if (this.tab === 'active') return 'Accept a job from the pool to see it here.';
      return 'Completed and cancelled jobs will show up here.';
    },
  },
  watch: {
    tab(v) { this.$router.replace({ query: Object.assign({}, this.$route.query, { tab: v }) }).catch(() => {}); },
  },
  async created() { await this.load(); this.$root.$on('partner-changed', this.load); },
  beforeDestroy() { this.$root.$off('partner-changed', this.load); },
  methods: {
    async load() {
      try {
        await refreshDriver();
        const captain = this.isCaptain;
        const base = captain ? '/api/driver/rides' : '/api/driver/valet';
        const [poolRes, mineRes] = await Promise.all([
          this.driver.can_go_online ? get(base, { scope: 'available' }) : Promise.resolve(captain ? { rides: [] } : { valet_requests: [] }),
          get(base),
        ]);
        this.pool = captain ? poolRes.rides : poolRes.valet_requests;
        this.mine = captain ? mineRes.rides : mineRes.valet_requests;
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    open(job) { this.$router.push(`/partner/jobs/${this.kind}/${job.id}`); },
    async accept(job) {
      this.acceptingId = job.id;
      try {
        const path = this.kind === 'ride' ? `/api/driver/rides/${job.id}/accept` : `/api/driver/valet/${job.id}/accept`;
        const r = await post(path);
        this.$toast.success(r.message);
        this.$root.$emit('partner-changed');
        this.tab = 'active';
        await this.load();
      } catch (e) { this.$toast.error(e.message); await this.load(); }
      this.acceptingId = null;
    },
  },
  template: `
  <div>
    <div class="p-page-head">
      <div><h1>{{ isCaptain ? 'Rides' : 'Valet jobs' }}</h1>
        <p>{{ isCaptain ? 'Accept ride requests and manage your trips.' : 'Accept valet requests and manage vehicle moves.' }}</p></div>
    </div>

    <div class="tabs mb-3">
      <button v-for="t in tabs" :key="t.k" :class="['tab', { active: tab === t.k }]" @click="tab = t.k">
        <i :class="['bi', t.icon]"></i> {{ t.l }}<span class="count">{{ t.k === 'available' ? pool.length : (t.k === 'active' ? activeList.length : historyList.length) }}</span>
      </button>
    </div>

    <div v-if="error" class="alert bad mb-3"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="tab === 'available' && driver && !driver.can_go_online" class="alert warn mb-3">
      <i class="bi bi-info-circle"></i><div>Finish verification before you can see the job pool. <router-link to="/partner/kyc">Check status →</router-link></div>
    </div>

    <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height:96px"></div></div>
    <div v-else-if="!shown.length" class="card"><empty-state :icon="tab === 'available' ? 'bi-broadcast' : 'bi-inbox'" :title="emptyTitle" :text="emptyText"></empty-state></div>
    <div v-else class="stack">
      <job-card v-for="j in shown" :key="j.id" :job="j" :kind="kind" :pool="tab === 'available'" :busy="acceptingId === j.id"
        @open="open(j)" @accept="accept(j)"></job-card>
    </div>
  </div>`,
};
