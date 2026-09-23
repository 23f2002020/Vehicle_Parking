// "Plans & billing": the owner's own subscription (lot limit) + the driver plan catalogue.
// Only the platform administrator can create / edit / retire driver plans.
import { get, post, put, del } from '../../api.js';
import { money } from '../../format.js';
import Plans from '../user/Plans.js';

const blank = () => ({ name: '', description: '', price: 999, duration_days: 30, free_parkings: 2, free_washes: 0, badge: '', features: '', is_active: true });

export default {
  components: { MyPlans: Plans },
  data() { return { tab: 'mine', loading: true, error: '', plans: [], canManage: false, form: null, editing: null, busy: false, err: '' }; },
  created() { this.load(); },
  computed: {
    driverPlans() { return this.plans.filter(p => p.plan_type === 'user'); },
    ownerPlans() { return this.plans.filter(p => p.plan_type === 'admin'); },
  },
  methods: {
    money,
    async load() {
      try { const d = await get('/api/admin/plans'); this.plans = d.plans; this.canManage = d.can_manage; this.error = ''; }
      catch (e) { this.error = e.message; }
      this.loading = false;
    },
    openNew() { this.editing = null; this.form = blank(); this.err = ''; },
    openEdit(p) { this.editing = p; this.form = Object.assign(blank(), p, { features: (p.features || []).join('\n'), badge: p.badge || '' }); this.err = ''; },
    async save() {
      this.busy = true; this.err = '';
      const f = this.form;
      const body = { name: f.name, description: f.description, price: parseFloat(f.price), duration_days: parseInt(f.duration_days, 10),
        free_parkings: parseInt(f.free_parkings, 10) || 0, free_washes: parseInt(f.free_washes, 10) || 0, badge: f.badge,
        features: f.features.split('\n').map(s => s.trim()).filter(Boolean), is_active: !!f.is_active };
      try {
        const r = this.editing ? await put('/api/admin/plans/' + this.editing.id, body) : await post('/api/admin/plans', body);
        this.$toast.success(r.message); this.form = null; await this.load();
      } catch (e) { this.err = e.message; }
      this.busy = false;
    },
    async retire(p) {
      try { const r = await del('/api/admin/plans/' + p.id); this.$toast.success(r.message); await this.load(); } catch (e) { this.$toast.error(e.message); }
    },
  },
  template: `
  <div>
    <div class="a-head"><div><h1>Plans & billing</h1><p>Your subscription decides how many lots you can run.</p></div>
      <div class="pill-tabs"><button :class="['ptab', { active: tab === 'mine' }]" @click="tab = 'mine'">My subscription</button><button :class="['ptab', { active: tab === 'drivers' }]" @click="tab = 'drivers'">Driver plans</button></div></div>

    <my-plans v-if="tab === 'mine'" :embedded="true"></my-plans>

    <div v-else>
      <div v-if="error" class="alert bad">{{ error }}</div>
      <div v-if="loading" class="skeleton" style="height:240px"></div>
      <template v-else>
        <div class="flex between items-center wrap gap-2 mb-2"><div class="small muted">{{ canManage ? 'You are the platform administrator - you can edit driver plans.' : 'Subscription plans drivers can buy. Only the platform administrator can change them.' }}</div>
          <button v-if="canManage" class="btn btn-sm" @click="openNew"><i class="bi bi-plus-lg"></i> New driver plan</button></div>
        <div class="a-card"><div class="a-table-wrap"><table class="dt">
          <thead><tr><th>Plan</th><th class="num">Price</th><th class="num">Validity</th><th class="num">Free parkings</th><th class="num">Free washes</th><th>Status</th><th v-if="canManage"></th></tr></thead>
          <tbody><tr v-for="p in driverPlans" :key="p.id"><td><b>{{ p.name }}</b> <span class="pill ok" v-if="p.badge">{{ p.badge }}</span><div class="tiny muted">{{ p.description }}</div></td>
            <td class="num">{{ money(p.price) }}</td><td class="num">{{ p.duration_days }} d</td><td class="num">{{ p.free_parkings }}</td><td class="num">{{ p.free_washes }}</td>
            <td><span :class="['pill', p.is_active ? 'ok' : '']">{{ p.is_active ? 'On sale' : 'Retired' }}</span></td>
            <td v-if="canManage"><div class="dt-actions"><button class="btn btn-xs btn-outline" @click="openEdit(p)">Edit</button><button v-if="p.is_active" class="btn btn-xs btn-danger-outline" @click="retire(p)">Retire</button></div></td></tr></tbody></table></div></div>
        <h3 class="mt-4">Lot-owner plans</h3>
        <div class="a-card"><div class="a-table-wrap"><table class="dt"><thead><tr><th>Plan</th><th class="num">Price</th><th class="num">Validity</th><th class="num">Lots included</th></tr></thead>
          <tbody><tr v-for="p in ownerPlans" :key="p.id"><td><b>{{ p.name }}</b><div class="tiny muted">{{ p.description }}</div></td><td class="num">{{ money(p.price) }}</td><td class="num">{{ p.duration_days }} d</td><td class="num">{{ p.max_lots === null ? 'Unlimited' : p.max_lots }}</td></tr></tbody></table></div></div>
      </template>
    </div>

    <modal v-if="form" :title="editing ? 'Edit ' + editing.name : 'New driver plan'" @close="form = null">
      <form id="plan-form" @submit.prevent="save">
        <div v-if="err" class="alert bad mb-2"><i class="bi bi-exclamation-octagon"></i><div>{{ err }}</div></div>
        <div class="field"><label>Name *</label><input class="input" v-model="form.name" required maxlength="64"></div>
        <div class="field"><label>Description</label><input class="input" v-model="form.description" maxlength="500"></div>
        <div class="grid grid-2"><div class="field"><label>Price (₹) *</label><input class="input" type="number" min="0" step="1" v-model="form.price" required></div>
          <div class="field"><label>Validity (days) *</label><input class="input" type="number" min="1" v-model="form.duration_days" required></div>
          <div class="field"><label>Free parkings</label><input class="input" type="number" min="0" v-model="form.free_parkings"></div>
          <div class="field"><label>Free car washes</label><input class="input" type="number" min="0" v-model="form.free_washes"></div></div>
        <div class="field"><label>Badge (optional)</label><input class="input" v-model="form.badge" maxlength="30" placeholder="Popular"></div>
        <div class="field"><label>Feature bullets (one per line)</label><textarea class="input textarea" rows="3" v-model="form.features"></textarea></div>
        <label class="check"><input type="checkbox" v-model="form.is_active"> On sale</label>
      </form>
      <template slot="footer"><button class="btn btn-outline" @click="form = null">Cancel</button><button class="btn" form="plan-form" :disabled="busy"><span v-if="busy" class="spin"></span>Save plan</button></template>
    </modal>
  </div>`,
};
