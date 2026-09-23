import { get } from '../../api.js';
import { money } from '../../format.js';
import { BookingCard } from '../../components/booking.js';

const TABS = [
  { k: 'all', l: 'All' }, { k: 'upcoming', l: 'Upcoming' }, { k: 'active', l: 'Active' },
  { k: 'past', l: 'Past' }, { k: 'cancelled', l: 'Cancelled' },
];

export default {
  components: { BookingCard },
  data() {
    return {
      loading: true, error: '', items: [], summary: null, tabs: TABS,
      status: this.$route.query.status || 'all', q: '', sort: 'start_desc', t: null,
    };
  },
  created() { this.load(); this.$root.$on('clock-changed', this.load); },
  beforeDestroy() { this.$root.$off('clock-changed', this.load); },
  watch: {
    status() { this.load(); },
    sort() { this.load(); },
    q() { clearTimeout(this.t); this.t = setTimeout(this.load, 250); },
  },
  methods: {
    money,
    async load() {
      try {
        const d = await get('/api/bookings', { status: this.status, q: this.q, sort: this.sort });
        this.items = d.bookings; this.summary = d.summary; this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    count(k) {
      if (!this.summary) return 0;
      return k === 'all' ? this.summary.total : this.summary[k];
    },
  },
  template: `
  <div>
    <div class="page-head">
      <div><h1>My bookings</h1><p>Everything you have reserved, in one place.</p></div>
      <router-link to="/app/find" class="btn"><i class="bi bi-plus-lg"></i> New booking</router-link>
    </div>

    <div class="stat-cards three" v-if="summary">
      <div class="stat-card"><span class="ic"><i class="bi bi-wallet2"></i></span><div><b>{{ money(summary.total_spent) }}</b><span>Total spent (net of refunds)</span></div></div>
      <div class="stat-card"><span class="ic blue"><i class="bi bi-calendar2-check"></i></span><div><b>{{ summary.total }}</b><span>Bookings made</span></div></div>
      <div class="stat-card"><span :class="['ic', summary.fines_due > 0 ? 'red' : '']"><i class="bi bi-cash-coin"></i></span><div><b>{{ money(summary.fines_due) }}</b><span>Fines due</span></div></div>
    </div>

    <div class="tabs mb-3">
      <button v-for="t in tabs" :key="t.k" :class="['tab', { active: status === t.k }]" @click="status = t.k">{{ t.l }}<span class="count">{{ count(t.k) }}</span></button>
    </div>
    <div class="filters">
      <div class="search"><i class="bi bi-search"></i><input class="input" v-model="q" placeholder="Search by code, vehicle, lot or slot" aria-label="Search bookings"></div>
      <select class="select" style="width:auto" v-model="sort" aria-label="Sort bookings">
        <option value="start_desc">Newest first</option><option value="start_asc">Oldest first</option><option value="amount_desc">Highest amount</option>
      </select>
    </div>

    <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="stack"><div v-for="i in 3" :key="i" class="skeleton" style="height:96px"></div></div>
    <div v-else-if="!items.length && !error" class="card"><empty-state icon="bi-calendar-x" title="No bookings here" :text="q ? 'Nothing matches your search.' : 'When you book a slot it will appear in this list.'">
      <router-link to="/app/find" class="btn mt-2">Find parking</router-link></empty-state></div>
    <div v-else class="stack"><booking-card v-for="b in items" :key="b.id" :b="b"></booking-card></div>
  </div>`,
};
