// "My Rides" + "My Valet Requests" - the minimal User Dashboard additions for the driver-partner
// domain (Book a Ride / Request Valet live here as the CTA buttons). A single page with a kind
// switch, same spirit as PartnerJobs.js on the other side of this feature.
import { get } from '../../api.js';
import { RideValetCard, isRideActive, isValetActive } from './mobilityLib.js';

export default {
  components: { RideValetCard },
  data() {
    return { loading: true, error: '', rides: [], valet: [], kind: this.$route.query.kind === 'valet' ? 'valet' : 'ride', filter: 'all' };
  },
  computed: {
    list() { return this.kind === 'ride' ? this.rides : this.valet; },
    isActive() { return this.kind === 'ride' ? isRideActive : isValetActive; },
    shown() {
      return this.list.filter(j => this.filter === 'all' ? true
        : this.filter === 'active' ? this.isActive(j.status)
        : this.filter === 'cancelled' ? j.status === 'CANCELLED'
        : !this.isActive(j.status) && j.status !== 'CANCELLED');
    },
    newTo() { return '/app/mobility/' + this.kind + '/new'; },
  },
  created() { this.load(); },
  watch: { kind() { this.filter = 'all'; } },
  methods: {
    async load() {
      try {
        const [r, v] = await Promise.all([get('/api/rides'), get('/api/valet')]);
        this.rides = r.rides; this.valet = v.valet_requests; this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
  <div>
    <div class="page-head">
      <div><h1>Rides &amp; valet</h1><p>Request a ride or have your car valet-parked, and track it here.</p></div>
      <router-link :to="newTo" class="btn"><i class="bi bi-plus-lg"></i> {{ kind === 'ride' ? 'Book a ride' : 'Request valet' }}</router-link>
    </div>

    <div class="seg mb-2">
      <button :class="{ active: kind === 'ride' }" @click="kind = 'ride'"><i class="bi bi-car-front"></i> Rides</button>
      <button :class="{ active: kind === 'valet' }" @click="kind = 'valet'"><i class="bi bi-key"></i> Valet</button>
    </div>
    <div class="pill-tabs mb-3">
      <button v-for="f in [['all','All'],['active','Active'],['past','Past'],['cancelled','Cancelled']]" :key="f[0]" :class="['ptab', { active: filter === f[0] }]" @click="filter = f[0]">{{ f[1] }}</button>
    </div>

    <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height:96px"></div></div>
    <div v-else-if="!shown.length && !error" class="card">
      <empty-state :icon="kind === 'ride' ? 'bi-car-front' : 'bi-key'" title="Nothing here yet"
                   :text="kind === 'ride' ? 'Request a ride and it will show up here.' : 'Request valet parking and it will show up here.'">
        <router-link :to="newTo" class="btn mt-2">{{ kind === 'ride' ? 'Book a ride' : 'Request valet' }}</router-link>
      </empty-state>
    </div>
    <div v-else class="stack"><ride-valet-card v-for="j in shown" :key="j.id" :job="j" :kind="kind"></ride-valet-card></div>
  </div>`,
};
