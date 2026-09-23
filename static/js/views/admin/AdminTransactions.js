import { get } from '../../api.js';
import { money, moneyExact, dt } from '../../format.js';

const PURPOSES = [['all', 'All'], ['booking', 'Bookings'], ['extension', 'Extensions'], ['fine', 'Fines'], ['refund', 'Refunds']];

export default {
  data() { return { loading: true, error: '', rows: [], totals: { collected: 0, refunded: 0, net: 0 }, q: '', purpose: 'all', status: 'all', purposes: PURPOSES }; },
  async created() {
    try { const d = await get('/api/admin/transactions'); this.rows = d.transactions; this.totals = d.totals; }
    catch (e) { this.error = e.message; }
    this.loading = false;
  },
  computed: {
    shown() {
      const q = this.q.trim().toLowerCase();
      return this.rows.filter(r => (this.purpose === 'all' || r.purpose === this.purpose) && (this.status === 'all' || r.status === this.status)
        && (!q || [r.ref, r.booking_code, r.lot, r.user && r.user.username, r.user && r.user.email].join(' ').toLowerCase().includes(q)));
    },
    failed() { return this.rows.filter(r => r.status !== 'success').length; },
  },
  methods: {
    money, moneyExact, dt,
    exportCsv() {
      const head = ['Date', 'Reference', 'Booking', 'Lot', 'Driver', 'Purpose', 'Method', 'Status', 'Amount'];
      const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lines = [head.join(',')].concat(this.shown.map(r => [new Date(r.created_at).toLocaleString(), r.ref, r.booking_code, r.lot, r.user && r.user.email, r.purpose, r.method + ' ' + (r.detail || ''), r.status, (r.purpose === 'refund' ? -1 : 1) * r.amount].map(esc).join(',')));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      a.download = 'vparkeasy-transactions.csv'; document.body.appendChild(a); a.click(); a.remove();
    },
  },
  template: `
  <div>
    <div class="a-head"><div><h1>Transactions</h1><p>Money in and out for your lots.</p></div><button class="btn btn-outline btn-sm" @click="exportCsv" :disabled="!shown.length"><i class="bi bi-download"></i> Export CSV</button></div>
    <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <div class="kpi"><div class="lbl"><i class="bi bi-arrow-down-circle"></i>Collected</div><div class="val">{{ money(totals.collected) }}</div></div>
      <div class="kpi blue"><div class="lbl"><i class="bi bi-arrow-counterclockwise"></i>Refunded</div><div class="val">{{ money(totals.refunded) }}</div></div>
      <div class="kpi violet"><div class="lbl"><i class="bi bi-wallet2"></i>Net revenue</div><div class="val">{{ money(totals.net) }}</div></div>
      <div class="kpi amber"><div class="lbl"><i class="bi bi-x-octagon"></i>Failed attempts</div><div class="val">{{ failed }}</div></div>
    </div>
    <div class="toolbar">
      <div class="search"><i class="bi bi-search"></i><input class="input" v-model="q" placeholder="Search reference, booking, driver, lot…" aria-label="Search transactions"></div>
      <div class="pill-tabs"><button v-for="p in purposes" :key="p[0]" :class="['ptab', { active: purpose === p[0] }]" @click="purpose = p[0]">{{ p[1] }}</button></div>
      <select class="select" v-model="status"><option value="all">Any status</option><option value="success">Paid</option><option value="failed">Failed</option></select>
    </div>
    <div v-if="error" class="alert bad">{{ error }}</div>
    <div v-if="loading" class="skeleton" style="height:300px"></div>
    <div class="a-card" v-else>
      <div class="a-table-wrap" v-if="shown.length"><table class="dt">
        <thead><tr><th>Date</th><th>Reference</th><th>Booking</th><th>Driver</th><th>Purpose</th><th>Method</th><th>Status</th><th class="num">Amount</th></tr></thead>
        <tbody><tr v-for="r in shown" :key="r.id">
          <td class="nowrap">{{ dt(r.created_at) }}</td><td class="mono tiny">{{ r.ref }}</td>
          <td><span class="mono">{{ r.booking_code || '—' }}</span><div class="tiny muted">{{ r.lot }}</div></td>
          <td>{{ r.user ? r.user.username : '—' }}</td><td><span class="pill">{{ r.purpose }}</span></td><td class="small">{{ r.method }} <span class="muted">{{ r.detail }}</span></td>
          <td><span :class="['pill', r.status === 'success' ? 'ok' : 'bad']" :title="r.message">{{ r.status === 'success' ? 'Paid' : 'Failed' }}</span></td>
          <td class="num strong" :class="{ 'ok-text': r.purpose === 'refund' }">{{ r.purpose === 'refund' ? '−' : '' }}{{ moneyExact(r.amount) }}</td>
        </tr></tbody></table></div>
      <empty-state v-else icon="bi-receipt" title="No transactions" text="Payments will appear here as drivers book."></empty-state>
    </div>
  </div>`,
};
