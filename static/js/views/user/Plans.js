// Subscription plans for drivers (shared with lot-owner "billing" - the API is role aware).
import { get, post } from '../../api.js';
import { money, dateOnly } from '../../format.js';

export function per(p) {
  const d = p.duration_days;
  return d >= 360 ? 'year' : d >= 60 ? `${Math.round(d / 30)} months` : 'month';
}

export default {
  props: { embedded: Boolean },
  data() {
    return { loading: true, error: '', plans: [], sub: null, type: 'user', info: null, chosen: null, pay: { payload: null, valid: false }, busy: false, payError: '' };
  },
  async created() { await this.load(); },
  methods: {
    money, dateOnly, per,
    async load() {
      try {
        const [p, s] = await Promise.all([get('/api/plans'), get('/api/subscription')]);
        this.plans = p.plans; this.type = p.plan_type; this.sub = s.subscription; this.info = s;
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    isCurrent(p) { return this.sub && this.sub.plan.id === p.id && this.sub.is_current; },
    choose(p) { this.chosen = p; this.pay = { payload: null, valid: false }; this.payError = ''; },
    async buy() {
      this.busy = true; this.payError = '';
      try {
        const r = await post('/api/subscription', { plan_id: this.chosen.id, payment: this.pay.payload });
        this.$toast.success(r.message);
        this.chosen = null;
        this.loading = true; await this.load();
        this.$root.$emit('bookings-changed');
      } catch (e) { this.payError = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div class="page-head" v-if="!embedded"><div><h1>{{ type === 'admin' ? 'Lot-owner plans' : 'Subscription plans' }}</h1>
      <p>{{ type === 'admin' ? 'Choose how many parking lots you can run.' : 'Park often? Get free parkings and car washes.' }}</p></div></div>

    <div v-if="error" class="alert bad">{{ error }}</div>
    <div v-if="loading" class="skeleton" style="height:320px"></div>
    <template v-else>
      <div class="card card-pad mb-3" v-if="sub && sub.is_current">
        <div class="flex between wrap gap-2 items-center">
          <div><div class="tiny muted strong">YOUR CURRENT PLAN</div><h3 class="mb-1">{{ sub.plan.name }}</h3>
            <div class="small muted">Valid until {{ dateOnly(sub.end_date) }} · {{ sub.days_left }} day(s) left</div></div>
          <div class="flex gap-3 wrap">
            <div v-if="type === 'user'"><b style="font-size:1.4rem">{{ sub.remaining_parkings }}</b><div class="tiny muted">free parkings left</div></div>
            <div v-if="type === 'user'"><b style="font-size:1.4rem">{{ sub.remaining_washes }}</b><div class="tiny muted">free washes left</div></div>
            <div v-if="type === 'admin' && info.lot_limit"><b style="font-size:1.4rem">{{ info.lot_limit.used }} / {{ info.lot_limit.limit === null ? '∞' : info.lot_limit.limit }}</b><div class="tiny muted">lots used</div></div>
          </div>
        </div>
      </div>
      <div class="alert info mb-3" v-else-if="type === 'user'"><i class="bi bi-gift"></i><div>You have <b>{{ info.welcome_minutes_remaining }} free minutes</b> of welcome allowance left. Plans below give you free parkings (first 4 hours of each) and free car washes.</div></div>
      <div class="alert info mb-3" v-else-if="info.lot_limit"><i class="bi bi-buildings"></i><div>You are on the <b>{{ info.lot_limit.plan }}</b>: {{ info.lot_limit.used }} of {{ info.lot_limit.limit === null ? 'unlimited' : info.lot_limit.limit }} lots used.</div></div>

      <div class="u-plans">
        <div v-for="p in plans" :key="p.id" :class="['plan', { pop: p.badge, 'plan-current': isCurrent(p) }]">
          <span class="badge" v-if="p.badge">{{ p.badge }}</span>
          <h3>{{ p.name }}</h3><div class="muted small">{{ p.description }}</div>
          <div class="pr">{{ money(p.price) }}<small> / {{ per(p) }}</small></div>
          <ul><li v-for="f in p.features" :key="f"><i class="bi bi-check-circle-fill"></i>{{ f }}</li></ul>
          <button class="btn btn-block" v-if="isCurrent(p)" disabled><i class="bi bi-check2"></i> Current plan</button>
          <button :class="['btn btn-block', p.badge ? '' : 'btn-outline']" v-else @click="choose(p)">{{ sub && sub.is_current ? 'Switch to this plan' : 'Choose plan' }}</button>
        </div>
      </div>
    </template>

    <modal v-if="chosen" :title="'Subscribe to ' + chosen.name" @close="chosen = null">
      <div class="stack">
        <div class="pricebox"><div class="price-line"><span>{{ chosen.name }} · {{ per(chosen) }}</span><span>{{ money(chosen.price) }}</span></div><div class="price-line total"><span>Total</span><span>{{ money(chosen.price) }}</span></div></div>
        <payment-form :amount="chosen.price" @change="pay = $event"></payment-form>
        <div v-if="payError" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ payError }}</div></div>
      </div>
      <template slot="footer"><button class="btn btn-outline" @click="chosen = null">Cancel</button>
        <button class="btn" :disabled="busy || !pay.valid" @click="buy"><span v-if="busy" class="spin"></span>Pay {{ money(chosen.price) }}</button></template>
    </modal>
  </div>`,
};
