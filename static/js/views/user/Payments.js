import { get } from '../../api.js';
import { money, moneyExact, dt } from '../../format.js';

const PURPOSES = [{ k: 'all', l: 'All' }, { k: 'booking', l: 'Bookings' }, { k: 'extension', l: 'Extensions' }, { k: 'fine', l: 'Fines' }, { k: 'subscription', l: 'Plans' }, { k: 'refund', l: 'Refunds' }];
const ICON = { booking: 'bi-p-square', extension: 'bi-plus-circle', fine: 'bi-exclamation-triangle', subscription: 'bi-stars', refund: 'bi-arrow-counterclockwise' };

export default {
  data() { return { loading: true, error: '', rows: [], total: 0, filter: 'all', purposes: PURPOSES }; },
  computed: {
    shown() { return this.filter === 'all' ? this.rows : this.rows.filter(r => r.purpose === this.filter); },
    refunds() { return this.rows.filter(r => r.purpose === 'refund' && r.status === 'success').reduce((a, r) => a + r.amount, 0); },
    failed() { return this.rows.filter(r => r.status !== 'success').length; },
  },
  async created() {
    try { const d = await get('/api/payments'); this.rows = d.payments; this.total = d.total_spent; }
    catch (e) { this.error = e.message; }
    this.loading = false;
  },
  methods: {
    money, moneyExact, dt,
    icon(p) { return ICON[p] || 'bi-receipt'; },
    label(r) { return { booking: 'Parking booking', extension: 'Booking extension', fine: 'Overstay fine', subscription: 'Subscription plan', refund: 'Refund' }[r.purpose] || r.purpose; },
  },
  template: `
  <div>
    <div class="page-head"><div><h1>Payments</h1><p>Every charge and refund on your account.</p></div></div>
    <div class="stat-cards three" v-if="!loading && !error">
      <div class="stat-card"><span class="ic"><i class="bi bi-wallet2"></i></span><div><b>{{ money(total) }}</b><span>Net spend</span></div></div>
      <div class="stat-card"><span class="ic blue"><i class="bi bi-arrow-counterclockwise"></i></span><div><b>{{ money(refunds) }}</b><span>Refunded</span></div></div>
      <div class="stat-card"><span :class="['ic', failed ? 'red' : 'amber']"><i class="bi bi-x-octagon"></i></span><div><b>{{ failed }}</b><span>Failed attempts</span></div></div>
    </div>
    <div class="filter-tabs mb-3"><button v-for="p in purposes" :key="p.k" :class="['chip', { active: filter === p.k }]" @click="filter = p.k">{{ p.l }}</button></div>

    <div v-if="error" class="alert bad">{{ error }}</div>
    <div v-if="loading" class="skeleton" style="height:240px"></div>
    <div class="card" v-else-if="!shown.length"><empty-state icon="bi-receipt" title="No payments yet" text="Your receipts will appear here after your first booking."></empty-state></div>
    <div class="card" v-else>
      <div class="table-wrap hide-sm"><table class="table">
        <thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Reference</th><th>Status</th><th class="num">Amount</th></tr></thead>
        <tbody>
          <tr v-for="r in shown" :key="r.id">
            <td class="nowrap">{{ dt(r.created_at) }}</td>
            <td><i :class="['bi', icon(r.purpose)]" style="margin-right:8px;color:#98a0bf"></i>{{ label(r) }}<div class="tiny muted" v-if="r.booking_code">{{ r.booking_code }}<template v-if="r.lot"> · {{ r.lot }}</template></div></td>
            <td class="small">{{ r.method }} <span class="muted">{{ r.detail }}</span></td>
            <td class="mono small">{{ r.ref }}</td>
            <td><span :class="['pill', r.status === 'success' ? 'ok' : 'bad']">{{ r.status === 'success' ? 'Paid' : 'Failed' }}</span><div class="tiny muted" v-if="r.status !== 'success'">{{ r.message }}</div></td>
            <td class="num strong" :class="{ 'ok-text': r.purpose === 'refund' }">{{ r.purpose === 'refund' ? '−' : '' }}{{ moneyExact(r.amount) }}</td>
          </tr>
        </tbody>
      </table></div>
      <div class="pay-list show-sm">
        <div class="pay-item" v-for="r in shown" :key="'m' + r.id">
          <span class="pi-ic"><i :class="['bi', icon(r.purpose)]"></i></span>
          <div class="pi-t">{{ label(r) }}<div class="tiny muted" v-if="r.booking_code" style="font-weight:600">{{ r.booking_code }}<template v-if="r.lot"> · {{ r.lot }}</template></div></div>
          <div :class="['pi-amt', { 'ok-text': r.purpose === 'refund' }]">{{ r.purpose === 'refund' ? '−' : '' }}{{ moneyExact(r.amount) }}</div>
          <div class="pi-s">
            <span :class="['pill', r.status === 'success' ? 'ok' : 'bad']">{{ r.status === 'success' ? 'Paid' : 'Failed' }}</span>
            <span>{{ dt(r.created_at) }}</span><span>{{ r.method }} {{ r.detail }}</span>
            <span v-if="r.status !== 'success' && r.message" class="bad-text">{{ r.message }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>`,
};
