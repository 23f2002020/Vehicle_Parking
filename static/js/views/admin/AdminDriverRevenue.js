// Platform commission earned from rides + valet jobs - separate from parking-lot revenue
// (AdminOverview.js / AdminReports.js), since this money isn't a lot owner's. Platform-admin only.
import { get } from '../../api.js';
import { money } from '../../format.js';
import { ChartCanvas } from '../../components/charts.js';

export default {
  components: { ChartCanvas },
  data() { return { loading: true, error: '', forbidden: false, d: null, days: 30 }; },
  computed: {
    k() { return this.d ? this.d.kpis : {}; },
    trendSets() {
      if (!this.d) return [];
      return [
        { label: 'Platform commission', data: this.d.trend.commission, borderColor: '#12b886', backgroundColor: 'rgba(18,184,134,.14)', fill: true, tension: .35, pointRadius: 2 },
        { label: 'Driver payouts', data: this.d.trend.payouts, borderColor: '#7a5cf0', backgroundColor: 'rgba(122,92,240,.12)', fill: true, tension: .35, pointRadius: 2 },
      ];
    },
  },
  created() { this.load(); },
  watch: { days() { this.load(); } },
  methods: {
    money,
    async load() {
      try { this.d = await get('/api/admin/driver-revenue', { days: this.days }); this.forbidden = false; this.error = ''; }
      catch (e) { if (e.status === 403) this.forbidden = true; else this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
  <div>
    <div class="a-head"><div><h1>Driver partner revenue</h1><p>Platform commission and driver payouts from rides &amp; valet jobs.</p></div>
      <select class="select" style="width:auto" v-model.number="days"><option :value="7">Last 7 days</option><option :value="30">Last 30 days</option><option :value="90">Last 90 days</option></select></div>

    <div v-if="forbidden" class="alert warn"><i class="bi bi-lock"></i><div>Only the platform administrator can view driver partner revenue.</div></div>
    <template v-else>
      <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
      <div v-if="loading" class="grid grid-3"><div v-for="i in 5" :key="i" class="skeleton" style="height:90px"></div></div>

      <template v-else-if="d">
        <div class="kpis">
          <div class="kpi"><div class="lbl"><i class="bi bi-cash-stack"></i> Platform commission</div><div class="val">{{ money(k.platform_commission) }}</div><div class="sub">last {{ days }} days</div></div>
          <div class="kpi violet"><div class="lbl"><i class="bi bi-wallet2"></i> Driver payouts</div><div class="val">{{ money(k.driver_payouts) }}</div><div class="sub">last {{ days }} days</div></div>
          <div class="kpi blue"><div class="lbl"><i class="bi bi-check2-circle"></i> Completed rides</div><div class="val">{{ k.completed_rides }}</div><div class="sub">all time</div></div>
          <div class="kpi amber"><div class="lbl"><i class="bi bi-key"></i> Completed valet jobs</div><div class="val">{{ k.completed_valet_jobs }}</div><div class="sub">all time</div></div>
          <div class="kpi"><div class="lbl"><i class="bi bi-people"></i> Active driver partners</div><div class="val">{{ k.active_drivers }}</div><div class="sub">right now</div></div>
        </div>

        <div class="a-card">
          <div class="a-card-head"><h3>Commission vs. payouts</h3></div>
          <div class="a-card-body"><div class="chart-box"><chart-canvas type="line" :labels="d.trend.labels" :datasets="trendSets"></chart-canvas></div></div>
        </div>
      </template>
    </template>
  </div>`,
};
