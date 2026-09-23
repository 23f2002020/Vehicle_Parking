import { get, patch } from '../../api.js';
import { money, dateOnly } from '../../format.js';

export default {
  data() { return { loading: true, error: '', users: [], canManage: false, q: '', filter: 'all', ask: null, reason: '', busy: false, askErr: '' }; },
  created() { this.load(); },
  computed: {
    shown() {
      const q = this.q.trim().toLowerCase();
      return this.users.filter(u => (this.filter === 'all' || (this.filter === 'suspended' ? !u.active : this.filter === 'fines' ? u.fines_due > 0 : u.active))
        && (!q || (u.username + ' ' + u.email).toLowerCase().includes(q)));
    },
  },
  methods: {
    money, dateOnly,
    async load() {
      try { const d = await get('/api/admin/users'); this.users = d.users; this.canManage = d.can_manage; this.error = ''; }
      catch (e) { this.error = e.message; }
      this.loading = false;
    },
    async run() {
      this.busy = true; this.askErr = '';
      try {
        const body = this.ask.u.active ? { active: false, ban_reason: this.reason } : { active: true };
        const r = await patch('/api/admin/users/' + this.ask.u.id, body);
        this.$toast.success(r.message); this.ask = null; this.reason = ''; await this.load();
      } catch (e) { this.askErr = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div class="a-head"><div><h1>Drivers</h1><p>{{ canManage ? 'Every driver on the platform.' : 'Drivers who have booked at your lots.' }}</p></div></div>
    <div class="toolbar">
      <div class="search"><i class="bi bi-search"></i><input class="input" v-model="q" placeholder="Search by name or e-mail" aria-label="Search drivers"></div>
      <div class="pill-tabs"><button v-for="f in [['all','All'],['active','Active'],['fines','Fines due'],['suspended','Suspended']]" :key="f[0]" :class="['ptab', { active: filter === f[0] }]" @click="filter = f[0]">{{ f[1] }}</button></div>
    </div>
    <div v-if="error" class="alert bad">{{ error }}</div>
    <div v-if="loading" class="skeleton" style="height:280px"></div>
    <div class="a-card" v-else>
      <div class="a-table-wrap" v-if="shown.length"><table class="dt">
        <thead><tr><th>Driver</th><th>Phone</th><th>Joined</th><th class="num">Bookings</th><th class="num">Spent</th><th class="num">Fines due</th><th>Status</th><th v-if="canManage"></th></tr></thead>
        <tbody><tr v-for="u in shown" :key="u.id" :class="{ 'row-bad': !u.active }">
          <td><b>{{ u.username }}</b><div class="tiny muted">{{ u.email }}</div></td><td>{{ u.phone || '—' }}</td><td class="nowrap">{{ dateOnly(u.created_at) }}</td>
          <td class="num">{{ u.bookings }}</td><td class="num">{{ money(u.spent) }}</td><td class="num"><span :class="u.fines_due > 0 ? 'bad-text strong' : 'muted'">{{ u.fines_due > 0 ? money(u.fines_due) : '—' }}</span></td>
          <td><span :class="['pill', u.active ? 'ok' : 'bad']">{{ u.active ? 'Active' : 'Suspended' }}</span></td>
          <td v-if="canManage"><div class="dt-actions"><button :class="['btn btn-xs', u.active ? 'btn-danger-outline' : 'btn-soft']" @click="ask = { u }; reason = ''; askErr = ''">{{ u.active ? 'Suspend' : 'Reactivate' }}</button></div></td>
        </tr></tbody></table></div>
      <empty-state v-else icon="bi-people" title="No drivers found" :text="users.length ? 'Nobody matches this filter.' : 'Drivers appear here after their first booking at your lots.'"></empty-state>
    </div>
    <div class="hint mt-2" v-if="!canManage"><i class="bi bi-info-circle"></i> Only the platform administrator can suspend accounts.</div>

    <modal v-if="ask" :title="(ask.u.active ? 'Suspend ' : 'Reactivate ') + ask.u.username + '?'" @close="ask = null">
      <p v-if="ask.u.active">Suspended drivers are signed out and can't sign in or book until reactivated.</p><p v-else>This driver will be able to sign in and book again.</p>
      <div class="field" v-if="ask.u.active"><label>Reason (shown to the driver)</label><input class="input" v-model="reason" placeholder="e.g. Repeated overstays"></div>
      <div v-if="askErr" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ askErr }}</div></div>
      <template slot="footer"><button class="btn btn-outline" @click="ask = null">Back</button><button :class="['btn', ask.u.active ? 'btn-danger' : '']" :disabled="busy" @click="run"><span v-if="busy" class="spin"></span>{{ ask.u.active ? 'Suspend' : 'Reactivate' }}</button></template>
    </modal>
  </div>`,
};
