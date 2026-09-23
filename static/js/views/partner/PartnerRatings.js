import { get } from '../../api.js';
import { dt } from '../../format.js';
import { partnerStore, refreshDriver } from './partnerLib.js';

export default {
  data() { return { store: partnerStore, loading: true, error: '', data: null }; },
  computed: { driver() { return this.store.driver; } },
  async created() { await this.load(); },
  methods: {
    dt,
    stars(n) { return '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0)); },
    async load() {
      try {
        await refreshDriver();
        this.data = await get('/api/driver/ratings');
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
  <div>
    <div class="p-page-head"><div><h1>Ratings</h1><p>What riders think of your rides and valet jobs.</p></div></div>

    <div v-if="error" class="alert bad mb-3"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="skeleton" style="height:160px"></div>

    <template v-else-if="data">
      <div class="card card-pad flex items-center gap-3 wrap">
        <div style="font-size:2.6rem;font-weight:800;letter-spacing:-.03em">{{ data.average != null ? data.average.toFixed(1) : '—' }}</div>
        <div><div class="stars" style="font-size:1.3rem">{{ stars(data.average || 0) }}</div><div class="small muted">Based on {{ data.count }} rating{{ data.count === 1 ? '' : 's' }}</div></div>
      </div>

      <div class="card mt-3">
        <div class="card-head"><h3>Recent feedback</h3></div>
        <div v-if="!data.recent.length" class="empty small" style="padding:30px"><i class="bi bi-star"></i>No ratings yet - they'll show up here after your first completed job.</div>
        <div v-else class="stack" style="padding:16px">
          <div class="mini-row" v-for="(r, i) in data.recent" :key="i">
            <div class="mini-ic"><i class="bi bi-star-fill" style="color:#f5a623"></i></div>
            <div class="grow"><div class="stars">{{ stars(r.stars) }}</div><div class="small" v-if="r.review">"{{ r.review }}"</div><div class="tiny muted">{{ dt(r.at) }}</div></div>
          </div>
        </div>
      </div>
    </template>
  </div>`,
};
