// Admin "Driver Partners" directory (ride captains + valet drivers). Deliberately a separate
// page/nav item from AdminUsers.js's existing "Drivers" (parking customers) - see
// Applications/driver_service.py's module docstring for the naming-collision background.
// Any lot admin can browse this directory (read-only); only the platform admin (can_manage) can
// approve/reject/suspend - the same is_platform_admin() pattern the Plans page already uses.
import { get } from '../../api.js';
import { dateOnly, money } from '../../format.js';

const TYPE_LABEL = { ride_captain: 'Ride captain', valet_driver: 'Valet driver' };
const KYC_META = { APPROVED: 'ok', PENDING: 'warn', REJECTED: 'bad', EXPIRED: 'bad' };

export default {
  data() {
    return { loading: true, error: '', drivers: [], canManage: false, q: '', driverType: '', kyc: '', status: 'all', t: null };
  },
  computed: {
    shown() {
      const q = this.q.trim().toLowerCase();
      return this.drivers.filter(d =>
        (this.status === 'all' || d.account_status === this.status)
        && (!q || (d.full_name + ' ' + d.email).toLowerCase().includes(q)));
    },
  },
  created() { this.load(); },
  watch: { driverType() { this.load(); }, kyc() { this.load(); } },
  methods: {
    dateOnly, money,
    typeLabel(t) { return TYPE_LABEL[t] || t; },
    kycCls(s) { return KYC_META[s] || ''; },
    approvedVehicle(d) { return (d.vehicles || []).find(v => v.status === 'APPROVED'); },
    async load() {
      try {
        const d = await get('/api/admin/drivers', { driver_type: this.driverType, kyc_status: this.kyc });
        this.drivers = d.drivers; this.canManage = d.can_manage; this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
  },
  template: `
  <div>
    <div class="a-head"><div><h1>Driver partners</h1><p>{{ canManage ? 'Every ride captain and valet driver on the platform.' : 'Read-only directory - only the platform administrator can approve or suspend driver partners.' }}</p></div></div>

    <div class="pill-tabs mb-2"><button v-for="f in [['all','All'],['active','Active'],['suspended','Suspended']]" :key="f[0]" :class="['ptab', { active: status === f[0] }]" @click="status = f[0]">{{ f[1] }}</button></div>
    <div class="toolbar">
      <div class="search"><i class="bi bi-search"></i><input class="input" v-model="q" placeholder="Search by name or e-mail" aria-label="Search driver partners"></div>
      <select class="select" v-model="driverType" aria-label="Filter by driver type"><option value="">All types</option><option value="ride_captain">Ride captains</option><option value="valet_driver">Valet drivers</option></select>
      <select class="select" v-model="kyc" aria-label="Filter by KYC status"><option value="">Any KYC status</option><option value="PENDING">KYC pending</option><option value="APPROVED">KYC approved</option><option value="REJECTED">KYC rejected</option><option value="EXPIRED">KYC expired</option></select>
    </div>

    <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="skeleton" style="height:280px"></div>
    <div class="a-card" v-else>
      <div class="a-table-wrap" v-if="shown.length"><table class="dt">
        <thead><tr><th>Driver partner</th><th>Type</th><th>KYC</th><th>Vehicle</th><th>Status</th><th class="num">Rating</th><th>Joined</th><th></th></tr></thead>
        <tbody><tr v-for="d in shown" :key="d.id" :class="{ 'row-bad': d.account_status !== 'active' }">
          <td><b>{{ d.full_name }}</b><div class="tiny muted">{{ d.email }}</div></td>
          <td>{{ typeLabel(d.driver_type) }}</td>
          <td><span class="pill" :class="kycCls(d.kyc_status)">{{ d.kyc_status }}</span></td>
          <td>
            <template v-if="d.driver_type === 'ride_captain'">
              <span v-if="approvedVehicle(d)" class="mono small">{{ approvedVehicle(d).reg_number }}</span>
              <span v-else class="tiny muted">none approved</span>
            </template>
            <span v-else class="tiny muted">n/a</span>
          </td>
          <td><span :class="['pill', d.account_status === 'active' ? 'ok' : 'bad']">{{ d.account_status === 'active' ? 'Active' : 'Suspended' }}</span></td>
          <td class="num">{{ d.rating_average != null ? d.rating_average.toFixed(1) + ' ★' : '—' }}</td>
          <td class="nowrap">{{ dateOnly(d.created_at) }}</td>
          <td><router-link :to="'/admin/driver-partners/' + d.id" class="btn btn-xs btn-outline">View</router-link></td>
        </tr></tbody></table></div>
      <empty-state v-else icon="bi-person-badge" title="No driver partners found" text="Ride captains and valet drivers appear here once they sign up."></empty-state>
    </div>
  </div>`,
};
