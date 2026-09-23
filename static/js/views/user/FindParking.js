import { get } from '../../api.js';
import { money } from '../../format.js';

export function amenityPrice(a) {
  if (a.category === 'bookable') return a.price_unit === 'per_hour' ? `${money(a.price)}/hr` : money(a.price);
  return { free: 'Free', pay_at_counter: 'Pay on-site' }[a.price_unit] || 'On-site';
}

export const LotDetail = {
  props: { lot: { type: Object, required: true } },
  data() { return { tab: 'map', map: null, loading: true, error: '' }; },
  async created() {
    try { this.map = await get(`/api/lots/${this.lot.id}/slot-map`); } catch (e) { this.error = e.message; }
    this.loading = false;
  },
  computed: {
    bookable() { return this.lot.amenities.filter(a => a.category === 'bookable'); },
    onsite() { return this.lot.amenities.filter(a => a.category !== 'bookable'); },
  },
  methods: { money, amenityPrice },
  template: `
  <modal :title="lot.name" size="wide" @close="$emit('close')">
    <div class="small muted mb-2"><i class="bi bi-geo-alt"></i> {{ lot.address }}, {{ lot.city }} {{ lot.pin_code }}
      <span v-if="lot.phone"> · <i class="bi bi-telephone"></i> {{ lot.phone }}</span></div>
    <div class="tabs mb-3">
      <button :class="['tab', { active: tab === 'map' }]" @click="tab = 'map'"><i class="bi bi-grid-3x3-gap"></i> Slot map</button>
      <button :class="['tab', { active: tab === 'am' }]" @click="tab = 'am'"><i class="bi bi-lightning-charge"></i> Amenities <span class="count">{{ lot.amenities.length }}</span></button>
      <button :class="['tab', { active: tab === 'info' }]" @click="tab = 'info'"><i class="bi bi-info-circle"></i> Rules & info</button>
    </div>

    <div v-if="tab === 'map'">
      <div class="alert info small mb-2"><i class="bi bi-clock"></i><div>Showing availability for the <b>next hour</b>. Pick your date and time when you book to see the exact map for your slot.</div></div>
      <div v-if="loading" class="spinner"></div>
      <div v-else-if="error" class="alert bad">{{ error }}</div>
      <slot-map v-else :floors="map.floors" :interactive="false" :buffer="map.buffer_minutes"></slot-map>
    </div>

    <div v-else-if="tab === 'am'">
      <div v-if="bookable.length"><h4>Book in the app</h4>
        <div class="am-list mb-3">
          <div class="am-row" v-for="a in bookable" :key="a.code"><span class="amenity-icon"><i :class="['bi', a.icon]"></i></span>
            <div class="grow"><b>{{ a.name }}</b><small>{{ a.description }}</small><small v-if="a.location"><i class="bi bi-geo-alt"></i> {{ a.location }}</small></div>
            <span class="pill ok">{{ amenityPrice(a) }}</span></div>
        </div></div>
      <div v-if="onsite.length"><h4>On the premises</h4>
        <div class="am-list">
          <div class="am-row" v-for="a in onsite" :key="a.code"><span class="amenity-icon" style="background:var(--line-2);color:var(--ink-2)"><i :class="['bi', a.icon]"></i></span>
            <div class="grow"><b>{{ a.name }}</b><small>{{ a.description }}</small><small v-if="a.location"><i class="bi bi-geo-alt"></i> {{ a.location }}</small></div>
            <span class="pill">{{ amenityPrice(a) }}</span></div>
        </div></div>
      <empty-state v-if="!lot.amenities.length" icon="bi-emoji-neutral" title="No extra amenities listed"></empty-state>
    </div>

    <div v-else>
      <div class="kv"><span>Price</span><span>{{ money(lot.price_per_hour) }} per hour (billed per started 15 min)</span></div>
      <div class="kv"><span>Turnaround gap</span><span>{{ lot.buffer_minutes }} minutes between bookings</span></div>
      <div class="kv"><span>Overstay fine</span><span>{{ money(lot.price_per_hour * 1.5 / 4) }} per started 15 min (1.5× rate)</span></div>
      <div class="kv"><span>Layout</span><span>{{ lot.floors }} level(s) · {{ lot.rows }} rows × {{ lot.columns }} bays</span></div>
      <div class="kv" v-if="lot.supervisor_name"><span>Supervisor</span><span>{{ lot.supervisor_name }}</span></div>
      <p class="muted small mt-2" v-if="lot.description">{{ lot.description }}</p>
    </div>

    <template slot="footer">
      <button class="btn btn-outline" @click="$emit('close')">Close</button>
      <button class="btn" @click="$emit('book', lot)"><i class="bi bi-calendar2-check"></i> Book a slot</button>
    </template>
  </modal>`,
};

export default {
  components: { LotDetail },
  data() {
    return { loading: true, error: '', lots: [], catalog: [], q: this.$route.query.q || '', sort: 'availability', picked: [], detail: null, t: null };
  },
  async created() {
    try { const o = await get('/api/public/overview'); this.catalog = o.amenities; } catch (e) { /* filters are optional */ }
    this.load();
  },
  watch: {
    q() { clearTimeout(this.t); this.t = setTimeout(this.load, 250); },
    sort() { this.load(); },
    picked() { this.load(); },
  },
  methods: {
    money,
    async load() {
      try {
        const d = await get('/api/lots', { q: this.q, sort: this.sort, amenity: this.picked.join(',') });
        this.lots = d.lots; this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    toggle(code) { this.picked = this.picked.includes(code) ? this.picked.filter(c => c !== code) : this.picked.concat(code); },
    pct(l) { return l.availability.total ? Math.round(100 * (l.availability.total - l.availability.free_next_hour) / l.availability.total) : 0; },
    book(l) { this.detail = null; this.$router.push('/app/book/' + l.id); },
  },
  template: `
  <div>
    <div class="page-head"><div><h1>Find parking</h1><p>Compare lots, check amenities and open the slot map before you book.</p></div></div>

    <div class="filters">
      <div class="search"><i class="bi bi-search"></i><input class="input" v-model="q" placeholder="Search by name, area, city or PIN code" aria-label="Search parking lots"></div>
      <div class="seg" role="group" aria-label="Sort">
        <button :class="{ active: sort === 'availability' }" @click="sort = 'availability'">Most free</button>
        <button :class="{ active: sort === 'price' }" @click="sort = 'price'">Cheapest</button>
        <button :class="{ active: sort === 'name' }" @click="sort = 'name'">A–Z</button>
      </div>
    </div>
    <div class="filter-tabs mb-3" v-if="catalog.length">
      <button v-for="a in catalog" :key="a.code" :class="['chip', { active: picked.includes(a.code) }]" @click="toggle(a.code)"><i :class="['bi', a.icon]"></i>{{ a.name }}</button>
    </div>

    <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="lot-grid"><div v-for="i in 3" :key="i" class="skeleton" style="height:260px"></div></div>
    <div v-else-if="!lots.length && !error" class="card"><empty-state icon="bi-search" title="No lots match" text="Try removing a filter or searching for another area."></empty-state></div>

    <div class="lot-grid" v-else>
      <article class="lot-tile" v-for="l in lots" :key="l.id">
        <div class="lot-tile-head">
          <div><h4>{{ l.name }}</h4><div class="small muted"><i class="bi bi-geo-alt"></i> {{ l.address }}, {{ l.city }}</div></div>
          <div class="lot-price"><b>{{ money(l.price_per_hour) }}</b><span>per hour</span></div>
        </div>
        <div class="lot-tile-body">
          <div class="avail"><span><b :class="l.free_now ? 'ok-text' : 'bad-text'">{{ l.free_now }}</b> of {{ l.availability.total }} free next hour</span>
            <div :class="['progress', pct(l) > 85 ? 'bad' : pct(l) > 60 ? 'warn' : '']"><i :style="{ width: pct(l) + '%' }"></i></div></div>
          <div class="flex wrap gap-1"><span class="pill"><i class="bi bi-layers"></i>{{ l.floors }} level{{ l.floors > 1 ? 's' : '' }}</span><span class="pill"><i class="bi bi-hourglass-split"></i>{{ l.buffer_minutes }} min gap</span></div>
          <amenity-chips :amenities="l.amenities" :limit="6"></amenity-chips>
        </div>
        <div class="lot-tile-foot">
          <button class="btn btn-outline btn-sm grow" @click="detail = l"><i class="bi bi-grid-3x3-gap"></i> Map & amenities</button>
          <button class="btn btn-sm grow" @click="book(l)"><i class="bi bi-calendar2-check"></i> Book</button>
        </div>
      </article>
    </div>

    <lot-detail v-if="detail" :lot="detail" @close="detail = null" @book="book"></lot-detail>
  </div>`,
};
