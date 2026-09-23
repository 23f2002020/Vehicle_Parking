// Driver partner earnings - separate from platform revenue (that lives in the admin console).
import { get } from '../../api.js';
import { money, dt } from '../../format.js';
import { partnerStore, refreshDriver } from './partnerLib.js';

export default {
  data() { return { store: partnerStore, loading: true, error: '', data: null }; },
  computed: {
    driver() { return this.store.driver; },
    isCaptain() { return this.driver && this.driver.driver_type === 'ride_captain'; },
  },
  async created() { await this.load(); },
  methods: {
    money, dt,
    async load() {
      try {
        await refreshDriver();
        this.data = await get('/api/driver/earnings');
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
  <div>
    <div class="p-page-head"><div><h1>Earnings</h1><p>What you have made on VParkEasy, separate from the rider's parking charges.</p></div></div>

    <div v-if="error" class="alert bad mb-3"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="grid grid-4"><div v-for="i in 4" :key="i" class="skeleton" style="height:76px"></div></div>

    <template v-else-if="data">
      <div class="stat-cards">
        <div class="stat-card"><span class="ic"><i class="bi bi-wallet2"></i></span><div><b>{{ money(data.today_earnings) }}</b><span>Earned today</span></div></div>
        <div class="stat-card"><span class="ic blue"><i class="bi bi-cash-stack"></i></span><div><b>{{ money(data.total_earnings) }}</b><span>Total earnings</span></div></div>
        <div class="stat-card"><span class="ic amber"><i class="bi bi-check2-circle"></i></span><div><b>{{ data.completed_rides + data.completed_valet_jobs }}</b><span>Completed jobs</span></div></div>
        <div class="stat-card" v-if="data.cancellation_earnings"><span class="ic red"><i class="bi bi-x-circle"></i></span><div><b>{{ money(data.cancellation_earnings) }}</b><span>From cancellation fees</span></div></div>
        <div class="stat-card" v-else><span class="ic"><i class="bi bi-x-circle"></i></span><div><b>{{ data.cancelled_rides + data.cancelled_valet_jobs }}</b><span>Cancelled jobs</span></div></div>
      </div>

      <div class="grid grid-2 mt-2" v-if="isCaptain || data.valet_earnings">
        <div class="card card-pad"><div class="muted small strong">RIDE EARNINGS</div><div style="font-size:1.6rem;font-weight:800" class="mt-1">{{ money(data.ride_earnings) }}</div><div class="tiny muted">{{ data.completed_rides }} completed rides</div></div>
        <div class="card card-pad"><div class="muted small strong">VALET EARNINGS</div><div style="font-size:1.6rem;font-weight:800" class="mt-1">{{ money(data.valet_earnings) }}</div><div class="tiny muted">{{ data.completed_valet_jobs }} completed jobs</div></div>
      </div>

      <div class="card mt-3">
        <div class="card-head"><h3>Transaction history</h3></div>
        <div v-if="!data.transactions.length" class="empty small" style="padding:30px"><i class="bi bi-receipt"></i>No transactions yet.</div>
        <div v-else class="table-wrap"><table class="table">
          <thead><tr><th>Reference</th><th>Type</th><th>Job</th><th>When</th><th class="right">Amount</th></tr></thead>
          <tbody><tr v-for="t in data.transactions" :key="t.ref">
            <td class="mono small">{{ t.ref.slice(-10) }}</td>
            <td>{{ t.purpose === 'ride_fare' ? 'Ride fare' : (t.purpose === 'valet_fee' ? 'Valet fee' : t.purpose) }}</td>
            <td class="mono small">{{ t.ride_id ? '#R' + t.ride_id : (t.valet_id ? '#V' + t.valet_id : '—') }}</td>
            <td class="small">{{ dt(t.at) }}</td>
            <td class="num strong">{{ money(t.amount) }}</td>
          </tr></tbody>
        </table></div>
      </div>
    </template>
  </div>`,
};
