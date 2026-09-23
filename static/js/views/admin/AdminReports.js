import { get } from '../../api.js';
import { money } from '../../format.js';
import { ChartCanvas } from '../../components/charts.js';

const LEVEL_ALERT = { critical: 'bad', warning: 'warn', tip: 'info' };
const STATUS_PILL = { top: 'ok', steady: 'info', underperforming: 'bad' };
const STATUS_LABEL = { top: 'Top performer', steady: 'Steady', underperforming: 'Underperforming' };

export default {
  components: { ChartCanvas },
  data() {
    return { loading: true, error: '', d: null, days: 30, lotId: '', };
  },
  created() { this.load(); this.$root.$on('clock-changed', this.load); },
  beforeDestroy() { this.$root.$off('clock-changed', this.load); },
  watch: { days() { this.load(); }, lotId() { this.load(); } },
  computed: {
    hasLots() { return this.d && this.d.lots > 0; },
    lotRows() { return (this.d && this.d.lot_performance) || []; },
    occSets() {
      return [{ label: 'Occupancy (%)', data: this.d.occupancy_trend.data, borderColor: '#7a5cf0',
               backgroundColor: 'rgba(122,92,240,.14)', fill: true, tension: .35, pointRadius: 2, pointBackgroundColor: '#7a5cf0' }];
    },
    topSlots() { return (this.d && this.d.slot_performance.top) || []; },
    bottomSlots() { return (this.d && this.d.slot_performance.bottom) || []; },
  },
  methods: {
    money,
    alertClass(level) { return LEVEL_ALERT[level] || 'info'; },
    statusPill(status) { return STATUS_PILL[status] || 'info'; },
    statusLabel(status) { return STATUS_LABEL[status] || status; },
    barClass(pct) { return pct > 66 ? '' : pct > 33 ? 'warn' : 'bad'; },
    async load() {
      try {
        const params = { days: this.days };
        if (this.lotId) params.lot_id = this.lotId;
        this.d = await get('/api/admin/reports', params);
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
  <div>
    <div class="a-head">
      <div><h1>Reports</h1><p>Which lots earn the most, where you're lagging, and where time and capacity are going unused.</p></div>
      <div class="pill-tabs"><button v-for="n in [14, 30, 60, 90]" :key="n" :class="['ptab', { active: days === n }]" @click="days = n">{{ n }} days</button></div>
    </div>

    <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="kpis"><div v-for="i in 5" :key="i" class="skeleton" style="height:96px"></div></div>

    <div v-else-if="d && !hasLots" class="a-card"><empty-state icon="bi-buildings" title="Add a parking lot first" text="Reports need at least one lot with some booking history."><router-link to="/admin/lots" class="btn mt-2">Create a parking lot</router-link></empty-state></div>

    <template v-else-if="d">
      <div class="kpis" style="grid-template-columns:repeat(5, minmax(0,1fr))">
        <div class="kpi"><div class="lbl"><i class="bi bi-currency-rupee"></i>Revenue ({{ d.days }}d)</div><div class="val">{{ money(d.kpis.revenue_total) }}</div><div class="sub">across {{ d.lots }} lots</div></div>
        <div class="kpi blue"><div class="lbl"><i class="bi bi-calendar-check"></i>Bookings</div><div class="val">{{ d.kpis.bookings_total }}</div><div class="sub">in the period</div></div>
        <div class="kpi violet"><div class="lbl"><i class="bi bi-p-square"></i>Avg occupancy</div><div class="val">{{ d.kpis.avg_occupancy_pct }}%</div><div class="sub">across all slots</div></div>
        <div class="kpi amber"><div class="lbl"><i class="bi bi-x-octagon"></i>Cancelled</div><div class="val">{{ d.kpis.cancellation_pct }}%</div><div class="sub">{{ d.kpis.cancelled_total }} bookings</div></div>
        <div class="kpi red"><div class="lbl"><i class="bi bi-person-x"></i>No-shows</div><div class="val">{{ d.kpis.no_show_pct }}%</div><div class="sub">{{ d.kpis.no_show_total }} bookings</div></div>
      </div>

      <div class="a-card mb-14" style="margin-bottom:14px">
        <div class="a-card-head"><h3><i class="bi bi-stars"></i> Suggestions to improve performance</h3><span class="tiny muted strong">rule-based, from your own numbers</span></div>
        <div class="a-card-body" style="display:grid;gap:10px">
          <div v-for="(s, i) in d.suggestions" :key="i" :class="['alert', alertClass(s.level)]">
            <i :class="['bi', s.icon]"></i>
            <div class="grow"><b>{{ s.title }}</b><div class="tiny" style="margin-top:3px;line-height:1.5">{{ s.text }}</div></div>
          </div>
        </div>
      </div>

      <div class="charts-grid even">
        <div class="a-card"><div class="a-card-head"><h3>Overall occupancy</h3><span class="tiny muted strong">% of slot-hours booked, per day</span></div>
          <div class="a-card-body"><div class="chart-box"><chart-canvas type="line" :labels="d.occupancy_trend.labels" :datasets="occSets" :options="{ scales: { y: { max: 100 } } }"></chart-canvas></div></div></div>

        <div class="a-card"><div class="a-card-head"><h3>Lot profitability</h3></div>
          <div class="a-table-wrap" style="max-height:320px;overflow-y:auto">
            <table class="dt"><thead><tr><th>Lot</th><th class="num">Revenue</th><th class="num">Occupancy</th><th>Status</th></tr></thead>
              <tbody><tr v-for="l in lotRows" :key="l.lot_id">
                <td><router-link :to="'/admin/lots/' + l.lot_id + '/slots'" class="strong" style="color:var(--ink)">{{ l.lot }}</router-link></td>
                <td class="num">{{ money(l.revenue) }}</td>
                <td class="num">{{ l.occupancy_pct }}%</td>
                <td><span :class="['pill', statusPill(l.status)]">{{ statusLabel(l.status) }}</span></td>
              </tr></tbody></table>
          </div></div>
      </div>

      <div class="a-card" style="margin-bottom:14px">
        <div class="a-card-head"><h3>Lot performance detail</h3></div>
        <div class="a-table-wrap"><table class="dt"><thead><tr><th>Lot</th><th class="num">Slots</th><th class="num">Bookings</th><th class="num">Revenue</th><th class="num">₹ / slot</th><th class="num">Occupancy</th><th class="num">Cancelled</th><th class="num">No-shows</th><th>Status</th></tr></thead>
          <tbody><tr v-for="l in lotRows" :key="l.lot_id" :class="{ 'row-bad': l.status === 'underperforming' }">
            <td class="strong">{{ l.lot }}</td>
            <td class="num">{{ l.slots }}</td>
            <td class="num">{{ l.bookings }}</td>
            <td class="num">{{ money(l.revenue) }}</td>
            <td class="num">{{ money(l.revenue_per_slot) }}</td>
            <td class="num"><div style="display:flex;align-items:center;gap:8px;justify-content:flex-end"><div class="progress" :class="barClass(l.occupancy_pct)" style="width:70px"><i :style="{ width: Math.min(l.occupancy_pct, 100) + '%' }"></i></div>{{ l.occupancy_pct }}%</div></td>
            <td class="num">{{ l.cancellation_pct }}%</td>
            <td class="num">{{ l.no_shows }}</td>
            <td><span :class="['pill', statusPill(l.status)]">{{ statusLabel(l.status) }}</span></td>
          </tr></tbody></table></div>
      </div>

      <div class="a-card">
        <div class="a-card-head">
          <h3>Individual slot performance</h3>
          <select class="select" v-model="lotId"><option value="">All lots</option><option v-for="l in lotRows" :key="l.lot_id" :value="l.lot_id">{{ l.lot }}</option></select>
        </div>
        <div class="a-card-body">
          <p class="tiny muted" style="margin:0 0 12px">{{ d.slot_performance.total_slots }} active slots considered. Utilization = hours actually parked ÷ hours in the period.</p>
          <div style="margin-bottom:22px">
            <h4 class="tiny strong" style="text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px"><i class="bi bi-arrow-up-circle"></i> Best used</h4>
            <div class="a-table-wrap"><table class="dt"><thead><tr><th>Slot</th><th v-if="!lotId">Lot</th><th class="num">Bookings</th><th class="num">Hrs used</th><th class="num">Utilization</th><th class="num">Revenue</th></tr></thead>
              <tbody>
                <tr v-for="s in topSlots" :key="s.slot_id"><td class="strong">{{ s.label }}</td><td v-if="!lotId" class="nowrap">{{ s.lot }}</td><td class="num">{{ s.bookings }}</td><td class="num">{{ s.hours_used }}</td><td class="num">{{ s.utilization_pct }}%</td><td class="num">{{ money(s.revenue) }}</td></tr>
                <tr v-if="!topSlots.length"><td :colspan="lotId ? 5 : 6" class="tiny muted">No usage yet.</td></tr>
              </tbody></table></div>
          </div>
          <div>
            <h4 class="tiny strong" style="text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px"><i class="bi bi-arrow-down-circle"></i> Least used</h4>
            <div class="a-table-wrap"><table class="dt"><thead><tr><th>Slot</th><th v-if="!lotId">Lot</th><th class="num">Bookings</th><th class="num">Hrs used</th><th class="num">Utilization</th><th class="num">Revenue</th></tr></thead>
              <tbody>
                <tr v-for="s in bottomSlots" :key="s.slot_id"><td class="strong">{{ s.label }}</td><td v-if="!lotId" class="nowrap">{{ s.lot }}</td><td class="num">{{ s.bookings }}</td><td class="num">{{ s.hours_used }}</td><td class="num">{{ s.utilization_pct }}%</td><td class="num">{{ money(s.revenue) }}</td></tr>
                <tr v-if="!bottomSlots.length"><td :colspan="lotId ? 5 : 6" class="tiny muted">Not enough slots to show a separate "least used" list.</td></tr>
              </tbody></table></div>
          </div>
        </div>
      </div>
    </template>
  </div>`,
};
