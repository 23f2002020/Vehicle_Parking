// Platform-wide monitor for rides + valet jobs. Read access here is platform-admin only (see
// AdminRidesResource/AdminValetJobsResource in resources/admin.py) - a lot owner sees a friendly
// note instead of a 403, same spirit as the "Only the platform administrator..." hints elsewhere.
import { get } from '../../api.js';
import { dt, money, relTime } from '../../format.js';
import { clock } from '../../clock.js';

const RIDE_ACTIVE = ['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'];
const VALET_ACTIVE = ['REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'VEHICLE_PICKED_UP', 'VEHICLE_IN_TRANSIT', 'VEHICLE_DROPPED'];

export default {
  data() {
    return { clock, loading: true, error: '', forbidden: false, kind: 'ride', rides: [], valet: [], rideActive: 0, valetActive: 0, filter: 'all', q: '', timer: null };
  },
  computed: {
    list() { return this.kind === 'ride' ? this.rides : this.valet; },
    activeSet() { return this.kind === 'ride' ? RIDE_ACTIVE : VALET_ACTIVE; },
    shown() {
      const q = this.q.trim().toLowerCase();
      return this.list.filter(j => {
        const cat = this.filter === 'all' ? true
          : this.filter === 'active' ? this.activeSet.includes(j.status)
          : this.filter === 'cancelled' ? j.status === 'CANCELLED'
          : !this.activeSet.includes(j.status) && j.status !== 'CANCELLED';
        if (!cat) return false;
        if (!q) return true;
        const hay = [j.code, j.pickup_label, j.drop_label, j.rider && j.rider.username, j.driver && j.driver.full_name].join(' ').toLowerCase();
        return hay.includes(q);
      });
    },
  },
  created() {
    this.load();
    this.timer = setInterval(this.load, 20000);
  },
  beforeDestroy() { clearInterval(this.timer); },
  watch: { kind() { this.filter = 'all'; } },
  methods: {
    dt, money, relTime,
    amount(j) { return this.kind === 'ride' ? (j.fare ? j.fare.total : null) : (j.fee || null); },
    async load() {
      try {
        const [r, v] = await Promise.all([get('/api/admin/rides'), get('/api/admin/valet')]);
        this.rides = r.rides; this.rideActive = r.active_count;
        this.valet = v.valet_requests; this.valetActive = v.active_count;
        this.forbidden = false; this.error = '';
      } catch (e) {
        if (e.status === 403) this.forbidden = true; else this.error = e.message;
      }
      this.loading = false;
    },
  },
  template: `
  <div>
    <div class="a-head"><div><h1>Rides &amp; valet jobs</h1><p>Every ride and valet request across the platform. Refreshes every 20 seconds.</p></div>
      <button class="btn btn-outline btn-sm" @click="load"><i class="bi bi-arrow-repeat"></i> Refresh</button></div>

    <div v-if="forbidden" class="alert warn"><i class="bi bi-lock"></i><div>Only the platform administrator can view ride &amp; valet monitoring.</div></div>
    <template v-else>
      <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>

      <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))" v-if="!loading">
        <div class="kpi blue"><div class="lbl"><i class="bi bi-broadcast"></i> Active rides</div><div class="val">{{ rideActive }}</div><div class="sub">of {{ rides.length }} total</div></div>
        <div class="kpi violet"><div class="lbl"><i class="bi bi-key"></i> Active valet jobs</div><div class="val">{{ valetActive }}</div><div class="sub">of {{ valet.length }} total</div></div>
      </div>

      <div class="seg mb-2"><button :class="{ active: kind === 'ride' }" @click="kind = 'ride'">Rides</button><button :class="{ active: kind === 'valet' }" @click="kind = 'valet'">Valet jobs</button></div>
      <div class="pill-tabs mb-2"><button v-for="f in [['all','All'],['active','Active'],['completed','Completed'],['cancelled','Cancelled']]" :key="f[0]" :class="['ptab', { active: filter === f[0] }]" @click="filter = f[0]">{{ f[1] }}</button></div>
      <div class="toolbar"><div class="search"><i class="bi bi-search"></i><input class="input" v-model="q" placeholder="Search code, route, rider or driver partner"></div></div>

      <div v-if="loading" class="skeleton" style="height:280px"></div>
      <div class="a-card" v-else>
        <div class="a-table-wrap" v-if="shown.length"><table class="dt">
          <thead><tr><th>Code</th><th>Route</th><th>Rider</th><th>Driver partner</th><th>Status</th><th class="num">{{ kind === 'ride' ? 'Fare' : 'Fee' }}</th><th>Requested</th></tr></thead>
          <tbody><tr v-for="j in shown" :key="j.id" :class="{ 'row-bad': j.status === 'CANCELLED' }">
            <td class="mono small">{{ j.code }}</td>
            <td class="small">{{ j.pickup_label }} → {{ j.drop_label }}<div class="tiny muted" v-if="kind === 'valet'">{{ (j.request_type || '').replace(/_/g, ' ') }} · {{ j.vehicle_number }}</div></td>
            <td class="nw">{{ j.rider ? j.rider.username : '—' }}</td>
            <td class="nw">{{ j.driver ? j.driver.full_name : '—' }}</td>
            <td><span class="pill">{{ j.status }}</span></td>
            <td class="num">{{ amount(j) ? money(amount(j)) : '—' }}</td>
            <td class="small nowrap">{{ relTime(j.requested_at, clock.now) }}</td>
          </tr></tbody></table></div>
        <empty-state v-else icon="bi-inbox" title="No jobs match" text="Try another filter or search term."></empty-state>
      </div>
    </template>
  </div>`,
};
