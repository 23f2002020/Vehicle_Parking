import { get, post, put, del } from '../../api.js';
import { money } from '../../format.js';

const blank = () => ({
  name: '', address: '', city: '', pin_code: '', phone: '', supervisor_name: '', description: '',
  latitude: '', longitude: '', price_per_hour: 40, buffer_minutes: 45, rows: 4, columns: 6, floors: 1, is_active: true,
});

const FIELDS = ['name', 'address', 'city', 'pin_code', 'phone', 'supervisor_name', 'description', 'latitude', 'longitude',
  'price_per_hour', 'buffer_minutes', 'rows', 'columns', 'floors', 'is_active'];

const LotForm = {
  props: { lot: Object, catalog: Array },
  data() {
    const editing = !!this.lot;
    const f = blank();
    if (editing) FIELDS.forEach(k => { if (this.lot[k] !== undefined && this.lot[k] !== null) f[k] = this.lot[k]; });
    // amenity editor rows: one per catalogue item
    const cfg = {};
    if (editing) this.lot.amenity_config.forEach(a => { cfg[a.code] = a; });
    const rows = this.catalog.map(c => ({
      code: c.code, name: c.name, icon: c.icon, category: c.category, unit: c.price_unit,
      enabled: editing ? !!(cfg[c.code] && cfg[c.code].enabled) : false,
      price: editing && cfg[c.code] ? cfg[c.code].price : c.default_price,
      location: editing && cfg[c.code] ? cfg[c.code].location : '',
    }));
    return { f, rows, editing, busy: false, err: '' };
  },
  computed: {
    total() { return (this.f.rows || 0) * (this.f.columns || 0) * (this.f.floors || 0); },
    tooMany() { return this.total > 500; },
    priceLabel() { return u => ({ per_hour: '₹ per hour', per_booking: '₹ per use' }[u] || null); },
  },
  methods: {
    async save() {
      this.err = '';
      const body = {};
      FIELDS.forEach(k => { body[k] = this.f[k]; });
      ['rows', 'columns', 'floors', 'buffer_minutes'].forEach(k => { body[k] = parseInt(body[k], 10); });
      body.price_per_hour = parseFloat(body.price_per_hour);
      ['latitude', 'longitude'].forEach(k => { body[k] = body[k] === '' || body[k] == null ? null : parseFloat(body[k]); });
      body.amenities = this.rows.filter(r => r.enabled).map(r => ({ code: r.code, price: r.price, location: r.location }));
      this.busy = true;
      try {
        const r = this.editing ? await put('/api/admin/lots/' + this.lot.id, body) : await post('/api/admin/lots', body);
        this.$toast.success(r.message);
        this.$emit('saved', r.lot);
      } catch (e) { this.err = e.message; }
      this.busy = false;
    },
  },
  template: `
  <modal :title="editing ? 'Edit ' + lot.name : 'New parking lot'" size="wide" @close="$emit('close')">
    <form @submit.prevent="save" id="lot-form">
      <div v-if="err" class="alert bad mb-3"><i class="bi bi-exclamation-octagon"></i><div>{{ err }}</div></div>
      <h4>Basics</h4>
      <div class="grid grid-2">
        <div class="field"><label>Lot name *</label><input class="input" v-model="f.name" required maxlength="100" placeholder="e.g. Central Mall Parking"></div>
        <div class="field"><label>City</label><input class="input" v-model="f.city" maxlength="60"></div>
        <div class="field"><label>Address *</label><input class="input" v-model="f.address" required></div>
        <div class="field"><label>PIN code *</label><input class="input" v-model="f.pin_code" required maxlength="10"></div>
        <div class="field"><label>Phone</label><input class="input" v-model="f.phone"></div>
        <div class="field"><label>Supervisor</label><input class="input" v-model="f.supervisor_name"></div>
      </div>
      <div class="field"><label>Description</label><textarea class="textarea input" rows="2" v-model="f.description" maxlength="500"></textarea></div>
      <div class="grid grid-2"><div class="field"><label>Latitude <span class="muted">(optional)</span></label><input class="input" v-model="f.latitude" inputmode="decimal"></div>
        <div class="field"><label>Longitude <span class="muted">(optional)</span></label><input class="input" v-model="f.longitude" inputmode="decimal"></div></div>

      <hr class="divider"><h4>Pricing & rules</h4>
      <div class="grid grid-2">
        <div class="field"><label>Price per hour (₹) *</label><input class="input" type="number" min="1" step="0.5" v-model="f.price_per_hour" required><div class="hint">Billed per started 15 minutes. Overstay fine = 1.5× this rate.</div></div>
        <div class="field"><label>Turnaround gap (minutes)</label><input class="input" type="number" min="0" max="240" step="5" v-model="f.buffer_minutes"><div class="hint">Time a slot rests between two bookings (default 45).</div></div>
      </div>

      <hr class="divider"><h4>Layout <span class="muted small">→ {{ total }} slots</span></h4>
      <div class="grid grid-3">
        <div class="field"><label>Rows per level *</label><input class="input" type="number" min="1" max="26" v-model="f.rows" required></div>
        <div class="field"><label>Bays per row *</label><input class="input" type="number" min="1" max="30" v-model="f.columns" required></div>
        <div class="field"><label>Levels (floors)</label><input class="input" type="number" min="1" max="10" v-model="f.floors"></div>
      </div>
      <div v-if="tooMany" class="alert warn small"><i class="bi bi-exclamation-triangle"></i><div>A lot can have at most 500 slots - reduce rows, bays or levels.</div></div>
      <div class="hint" v-else>Slots are generated automatically and named like L1-A1 (level 1, row A, bay 1). Rows are paired with a driving lane between every two rows.</div>
      <label class="check mt-2" v-if="editing"><input type="checkbox" v-model="f.is_active"> Lot is open for booking</label>

      <hr class="divider"><h4>Amenities</h4>
      <div class="hint mb-2">Tick what this lot offers. "Bookable" items can be added at checkout with the price you set; the rest are shown to drivers as on-site information.</div>
      <div class="amenity-edit">
        <div v-for="r in rows" :key="r.code" :class="['ae-row', { on: r.enabled }]">
          <input type="checkbox" v-model="r.enabled" :aria-label="'Offer ' + r.name">
          <div><i :class="['bi', r.icon]"></i> <b>{{ r.name }}</b> <span :class="['pill', r.category === 'bookable' ? 'ok' : '']" style="margin-left:6px">{{ r.category === 'bookable' ? 'bookable' : 'on-site' }}</span></div>
          <input v-if="r.category === 'bookable'" class="input" type="number" min="0" step="1" v-model.number="r.price" :disabled="!r.enabled" :title="priceLabel(r.unit)" :placeholder="priceLabel(r.unit)">
          <span v-else></span>
          <input class="input" v-model="r.location" :disabled="!r.enabled" placeholder="Where? e.g. Level 1, near exit">
        </div>
      </div>
    </form>
    <template slot="footer">
      <button class="btn btn-outline" type="button" @click="$emit('close')">Cancel</button>
      <button class="btn" form="lot-form" :disabled="busy || tooMany"><span v-if="busy" class="spin"></span>{{ editing ? 'Save changes' : 'Create lot' }}</button>
    </template>
  </modal>`,
};

export default {
  components: { LotForm },
  data() { return { loading: true, error: '', lots: [], limit: null, catalog: [], form: null, deleting: null, busy: false, delErr: '' }; },
  created() { this.load(); },
  methods: {
    money,
    async load() {
      try {
        const d = await get('/api/admin/lots');
        this.lots = d.lots; this.limit = d.limit; this.catalog = d.amenity_catalog; this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    canAdd() { return !this.limit || this.limit.limit === null || this.limit.used < this.limit.limit; },
    openNew() { this.form = { lot: null }; },
    openEdit(l) { this.form = { lot: l }; },
    async saved() { this.form = null; await this.load(); this.$root.$emit('admin-changed'); },
    async toggle(l) {
      try { await put('/api/admin/lots/' + l.id, { is_active: !l.is_active }); this.$toast.success(l.is_active ? 'Lot closed for booking' : 'Lot reopened'); await this.load(); }
      catch (e) { this.$toast.error(e.message); }
    },
    async remove() {
      this.busy = true; this.delErr = '';
      try { const r = await del('/api/admin/lots/' + this.deleting.id); this.$toast.success(r.message); this.deleting = null; await this.load(); this.$root.$emit('admin-changed'); }
      catch (e) { this.delErr = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div class="a-head">
      <div><h1>Parking lots</h1><p>Create lots, set prices and amenities, and open the live slot board.</p></div>
      <div class="flex items-center gap-2 wrap">
        <span v-if="limit" class="pill" :class="canAdd() ? 'ok' : 'warn'">{{ limit.used }} / {{ limit.limit === null ? '∞' : limit.limit }} lots · {{ limit.plan }}</span>
        <button class="btn" :disabled="!canAdd()" @click="openNew"><i class="bi bi-plus-lg"></i> New lot</button>
      </div>
    </div>
    <div v-if="limit && !canAdd()" class="alert warn mb-3"><i class="bi bi-lock"></i><div class="grow">You have reached the lot limit of your <b>{{ limit.plan }}</b>. Upgrade to add more lots.</div><router-link to="/admin/plans" class="btn btn-sm">See plans</router-link></div>

    <div v-if="error" class="alert bad"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
    <div v-if="loading" class="lot-admin"><div v-for="i in 3" :key="i" class="skeleton" style="height:260px"></div></div>
    <div v-else-if="!lots.length && !error" class="a-card"><empty-state icon="bi-buildings" title="No parking lots yet" text="Create your first lot - slots are generated from rows, bays and levels."><button class="btn mt-2" @click="openNew">Create a parking lot</button></empty-state></div>

    <div class="lot-admin" v-else>
      <article v-for="l in lots" :key="l.id" :class="['lot-a', { off: !l.is_active }]">
        <div class="lot-a-top">
          <div><h3 class="mb-1">{{ l.name }}</h3><div class="small muted"><i class="bi bi-geo-alt"></i> {{ l.address }}, {{ l.city }} {{ l.pin_code }}</div></div>
          <div class="right"><b style="font-size:1.25rem">{{ money(l.price_per_hour) }}</b><div class="tiny muted">per hour</div><span :class="['pill mt-1', l.is_active ? 'ok' : 'warn']">{{ l.is_active ? 'Open' : 'Closed' }}</span></div>
        </div>
        <div class="lot-a-body" style="padding:0 18px 4px"><amenity-chips :amenities="l.amenities" :limit="6"></amenity-chips></div>
        <div class="lot-a-stats">
          <div><b>{{ l.number_of_spots }}</b><span>Slots</span></div><div><b>{{ l.floors }}×{{ l.rows }}×{{ l.columns }}</b><span>Lvl×Row×Bay</span></div>
          <div><b>{{ l.parked_now }}</b><span>Parked</span></div><div><b>{{ l.buffer_minutes }}m</b><span>Gap</span></div>
        </div>
        <div class="lot-a-foot">
          <router-link :to="'/admin/lots/' + l.id + '/slots'" class="btn btn-sm btn-soft"><i class="bi bi-grid-3x3-gap"></i> Slot board</router-link>
          <button class="btn btn-sm btn-outline" @click="openEdit(l)"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn btn-sm btn-outline" @click="toggle(l)"><i :class="['bi', l.is_active ? 'bi-pause-circle' : 'bi-play-circle']"></i> {{ l.is_active ? 'Close' : 'Reopen' }}</button>
          <button class="btn btn-sm btn-danger-outline" @click="deleting = l; delErr = ''"><i class="bi bi-trash"></i></button>
        </div>
      </article>
    </div>

    <lot-form v-if="form" :lot="form.lot" :catalog="catalog" @close="form = null" @saved="saved"></lot-form>

    <modal v-if="deleting" title="Delete this lot?" @close="deleting = null">
      <p>Delete <b>{{ deleting.name }}</b> and its {{ deleting.number_of_spots }} slots? Past bookings and payments stay in your records. This cannot be undone.</p>
      <div v-if="delErr" class="alert bad small"><i class="bi bi-exclamation-octagon"></i><div>{{ delErr }}</div></div>
      <template slot="footer"><button class="btn btn-outline" @click="deleting = null">Keep lot</button><button class="btn btn-danger" :disabled="busy" @click="remove"><span v-if="busy" class="spin"></span>Delete lot</button></template>
    </modal>
  </div>`,
};
