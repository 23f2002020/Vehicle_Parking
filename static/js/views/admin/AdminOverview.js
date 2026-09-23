import { get } from '../../api.js';
import { money, dt, timeOnly, relTime } from '../../format.js';
import { clock } from '../../clock.js';
import { ChartCanvas } from '../../components/charts.js';

export default {
  components: { ChartCanvas },
  data() { return { loading: true, error: '', d: null, days: 14, clock, timer: null }; },
  created() { this.load(); this.timer = setInterval(this.load, 60000); this.$root.$on('clock-changed', this.load); },
  beforeDestroy() { clearInterval(this.timer); this.$root.$off('clock-changed', this.load); },
  watch: { days() { this.load(); } },
  computed: {
    k() { return this.d ? this.d.kpis : {}; },
    hasLots() { return this.d && this.d.lots > 0; },
    revenueSets() {
      return [{ label: 'Revenue (₹)', data: this.d.revenue.data, borderColor: '#12b886', backgroundColor: 'rgba(18,184,134,.14)', fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: '#12b886' }];
    },
    bookingSets() { return [{ label: 'Bookings', data: this.d.bookings.data, backgroundColor: '#3a6df0', borderRadius: 5 }]; },
    peakSets() {
      const max = Math.max(...this.d.peak_hours.data, 1);
      return [{ label: 'Bookings starting', data: this.d.peak_hours.data, borderRadius: 4,
        backgroundColor: this.d.peak_hours.data.map(v => (v === max ? '#7a5cf0' : '#c9bdfa')) }];
    },
    topSets() {
      // The backend already caps this to at most 6 slices (top 5 lots + one "Other lots"
      // aggregate), but colours are still assigned with a safe modulo cycle here so they
      // can never collide or come out `undefined` even if that cap ever changes.
      const colors = ['#12b886', '#3a6df0', '#f5a623', '#7a5cf0', '#e03e45', '#22d3a4'];
      const otherColor = '#9aa2c4';
      const backgroundColor = this.d.top_lots.map((t, i) => (t.lot.startsWith('Other lots') ? otherColor : colors[i % colors.length]));
      return [{ data: this.d.top_lots.map(t => t.revenue), backgroundColor, borderWidth: 0 }];
    },
    hasRevenue() { return this.d && this.d.top_lots.some(t => t.revenue > 0); },
  },
  methods: {
    money, dt, timeOnly, relTime,
    async load() {
      try { this.d = await get('/api/admin/overview', { days: this.days }); this.error = ''; } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    ops(code) { this.$router.push({ path: '/admin/operations', query: { q: code } }); },
  },
  template: `
  <div>
    <div class="a-head">
      <div><h1>Overview</h1><p>How your parking lots are doing right now and over time.</p></div>
      <div class="pill-tabs"><button v-for="n in [7, 14, 30]" :key="n" :class="['ptab', { active: days === n }]" @click="days = n">{{ n }} days</button></div>
    </div>

    <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="kpis"><div v-for="i in 6" :key="i" class="skeleton" style="height:96px"></div></div>

    <div v-else-if="d && !hasLots" class="a-card"><empty-state icon="bi-buildings" title="Add your first parking lot" text="Create a lot with its rows, columns and floors - VParkEasy generates every slot for you."><router-link to="/admin/lots" class="btn mt-2">Create a parking lot</router-link></empty-state></div>

    <template v-else-if="d">
      <div class="kpis">
        <div class="kpi"><div class="lbl"><i class="bi bi-currency-rupee"></i>Revenue today</div><div class="val">{{ money(k.revenue_today) }}</div><div class="sub">7 days: {{ money(k.revenue_7d) }}</div></div>
        <div class="kpi blue"><div class="lbl"><i class="bi bi-calendar-check"></i>Bookings today</div><div class="val">{{ k.bookings_today }}</div><div class="sub">{{ d.arrivals.length }} arriving in next 3 h</div></div>
        <div class="kpi violet"><div class="lbl"><i class="bi bi-p-square"></i>Parked now</div><div class="val">{{ k.parked_now }}<span class="muted" style="font-size:1rem;font-weight:700"> / {{ k.slots_total }}</span></div><div class="sub">{{ k.occupancy_pct }}% occupancy</div></div>
        <div :class="['kpi', k.overstay_now ? 'red alert-tile' : 'amber']"><div class="lbl"><i class="bi bi-exclamation-triangle"></i>Overstaying</div><div class="val">{{ k.overstay_now }}</div><div class="sub">vehicles past their time</div></div>
        <div class="kpi amber"><div class="lbl"><i class="bi bi-cash-coin"></i>Fines due</div><div class="val">{{ money(k.fines_due) }}</div><div class="sub">unpaid overstay fines</div></div>
        <div class="kpi"><div class="lbl"><i class="bi bi-graph-up"></i>Last {{ days }} days</div><div class="val">{{ money(k.revenue_period) }}</div><div class="sub">net revenue</div></div>
      </div>

      <div class="charts-grid">
        <div class="a-card"><div class="a-card-head"><h3>Revenue</h3><span class="tiny muted strong">₹ per day</span></div>
          <div class="a-card-body"><div class="chart-box tall"><chart-canvas type="line" :labels="d.revenue.labels" :datasets="revenueSets"></chart-canvas></div></div></div>
        <div class="a-card"><div class="a-card-head"><h3>Revenue by lot</h3></div>
          <div class="a-card-body"><div class="chart-box tall" v-if="hasRevenue"><chart-canvas type="doughnut" :labels="d.top_lots.map(t => t.lot)" :datasets="topSets" :options="{ cutout: '62%' }"></chart-canvas></div>
            <empty-state v-else icon="bi-pie-chart" title="No revenue yet"></empty-state></div></div>
      </div>

      <div class="charts-grid even">
        <div class="a-card"><div class="a-card-head"><h3>Bookings per day</h3></div><div class="a-card-body"><div class="chart-box"><chart-canvas type="bar" :labels="d.bookings.labels" :datasets="bookingSets"></chart-canvas></div></div></div>
        <div class="a-card"><div class="a-card-head"><h3>Peak arrival hours</h3><span class="tiny muted strong">local time</span></div><div class="a-card-body"><div class="chart-box"><chart-canvas type="bar" :labels="d.peak_hours.labels" :datasets="peakSets" :options="{ plugins: { legend: { display: false } } }"></chart-canvas></div></div></div>
      </div>

      <div class="charts-grid even">
        <div class="a-card"><div class="a-card-head"><h3>Live occupancy</h3><router-link to="/admin/lots" class="small strong">Manage lots →</router-link></div>
          <div class="a-card-body">
            <div class="occ-row" v-for="o in d.occupancy" :key="o.lot_id"><router-link :to="'/admin/lots/' + o.lot_id + '/slots'" class="strong" style="color:var(--ink)">{{ o.lot }}</router-link>
              <div :class="['progress', o.pct > 85 ? 'bad' : o.pct > 60 ? 'warn' : '']"><i :style="{ width: o.pct + '%' }"></i></div><span class="right">{{ o.parked }}/{{ o.total }}</span></div>
          </div></div>

        <div class="a-card"><div class="a-card-head"><h3>Upcoming arrivals <span class="muted small">(next 3 h)</span></h3><router-link to="/admin/operations" class="small strong">Operations →</router-link></div>
          <div class="a-table-wrap" v-if="d.arrivals.length"><table class="dt"><thead><tr><th>When</th><th>Vehicle</th><th>Slot</th><th>Driver</th></tr></thead>
            <tbody><tr v-for="b in d.arrivals" :key="b.id"><td class="nowrap">{{ timeOnly(b.start_time) }} <span class="muted tiny">{{ relTime(b.start_time, clock.now) }}</span></td><td class="mono">{{ b.vehicle_number }}</td><td><b>{{ b.slot.full_label }}</b> <span class="muted tiny">{{ b.lot.name }}</span></td><td>{{ b.user.username }}</td></tr></tbody></table></div>
          <empty-state v-else icon="bi-clock" title="No arrivals expected"></empty-state></div>
      </div>

      <div class="a-card" v-if="d.overstays.length" style="border-color:#f3c6c8">
        <div class="a-card-head" style="background:#fff6f6"><h3 class="bad-text"><i class="bi bi-exclamation-triangle-fill"></i> Vehicles overstaying right now</h3></div>
        <div class="a-table-wrap"><table class="dt"><thead><tr><th>Booking</th><th>Vehicle</th><th>Slot</th><th>Driver</th><th>Ended</th><th class="num">Over</th><th class="num">Fine so far</th><th></th></tr></thead>
          <tbody><tr v-for="b in d.overstays" :key="b.id" class="row-bad"><td class="mono">{{ b.code }}</td><td class="mono">{{ b.vehicle_number }}</td><td><b>{{ b.slot.full_label }}</b> <span class="muted tiny">{{ b.lot.name }}</span></td><td>{{ b.user.username }}</td><td>{{ timeOnly(b.end_time) }}</td><td class="num">{{ b.overstay_minutes_now }} min</td><td class="num strong bad-text">{{ money(b.amounts.fine) }}</td>
            <td><div class="dt-actions"><button class="btn btn-xs btn-danger" @click="ops(b.code)">Handle</button></div></td></tr></tbody></table></div>
      </div>
    </template>
  </div>`,
};
