// Ride captains only - register a vehicle and track its approval. Valet drivers don't need one
// (they drive the rider's own vehicle), so PartnerLayout never links here for that driver type;
// this view double-checks anyway in case someone lands on the URL directly.
import { get, post } from '../../api.js';
import { dt } from '../../format.js';
import { partnerStore, refreshDriver, PhotoPicker } from './partnerLib.js';

const VEHICLE_TYPES = [{ v: 'car', l: 'Car' }, { v: 'suv', l: 'SUV' }, { v: 'auto', l: 'Auto-rickshaw' }, { v: 'bike', l: 'Bike' }];
const STATUS_META = {
  APPROVED: { cls: 'ok', icon: 'bi-check-circle-fill', label: 'Approved' },
  PENDING: { cls: 'warn', icon: 'bi-hourglass-split', label: 'Pending review' },
  REJECTED: { cls: 'bad', icon: 'bi-x-octagon-fill', label: 'Rejected' },
};

export default {
  components: { PhotoPicker },
  data() {
    return {
      store: partnerStore, loading: true, error: '', vehicles: [], showForm: false, busy: false, formError: '',
      form: { reg_number: '', manufacturer: '', model: '', vehicle_type: 'car', colour: '', year: '',
        seating_capacity: 4, photo: null, registration_expiry: '', insurance_expiry: '' },
      types: VEHICLE_TYPES,
    };
  },
  computed: {
    driver() { return this.store.driver; },
    isCaptain() { return this.driver && this.driver.driver_type === 'ride_captain'; },
  },
  async created() { await this.load(); },
  methods: {
    dt,
    meta(s) { return STATUS_META[s] || { cls: '', icon: 'bi-circle', label: s }; },
    async load() {
      try {
        await refreshDriver();
        const r = await get('/api/driver/vehicle');
        this.vehicles = r.vehicles;
        this.showForm = !this.vehicles.length;
        this.error = '';
      } catch (e) { this.error = e.message; }
      this.loading = false;
    },
    async submit() {
      this.busy = true; this.formError = '';
      try {
        const r = await post('/api/driver/vehicle', this.form);
        this.vehicles.unshift(r.vehicle);
        this.showForm = false;
        this.$toast.success(r.message);
        this.$root.$emit('partner-changed');
        this.form = { reg_number: '', manufacturer: '', model: '', vehicle_type: 'car', colour: '',
          year: '', seating_capacity: 4, photo: null, registration_expiry: '', insurance_expiry: '' };
      } catch (e) { this.formError = e.message; }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div class="p-page-head">
      <div><h1>My vehicle</h1><p>Only an approved vehicle lets you go online and accept rides.</p></div>
      <button v-if="!showForm" class="btn" @click="showForm = true"><i class="bi bi-plus-lg"></i> Add vehicle</button>
    </div>

    <div v-if="!isCaptain" class="alert warn"><i class="bi bi-info-circle"></i><div>Valet drivers use the rider's own vehicle - there is nothing to register here.</div></div>
    <template v-else>
      <div v-if="error" class="alert bad mb-3"><i class="bi bi-wifi-off"></i><div class="grow">{{ error }}</div><button class="btn btn-sm btn-outline" @click="load">Retry</button></div>
      <div v-if="loading" class="stack"><div class="skeleton" style="height:120px"></div></div>

      <div v-else class="stack">
        <div class="card" v-for="v in vehicles" :key="v.id">
          <div class="card-body flex between items-start wrap gap-2">
            <div>
              <div class="flex items-center gap-2"><span class="mono strong" style="font-size:1.05rem">{{ v.reg_number }}</span><span class="ver-badge" :class="meta(v.status).cls"><i :class="['bi', meta(v.status).icon]"></i>{{ meta(v.status).label }}</span></div>
              <div class="small muted mt-1">{{ v.manufacturer }} {{ v.model }} · {{ v.colour || 'colour n/a' }} · {{ v.year || '—' }} · {{ v.seating_capacity }} seats</div>
              <div class="small bad-text mt-1" v-if="v.status === 'REJECTED' && v.reject_reason"><i class="bi bi-exclamation-triangle"></i> {{ v.reject_reason }}</div>
              <div class="tiny muted mt-1">Added {{ dt(v.created_at) }}<template v-if="v.registration_expiry"> · Registration expires {{ dt(v.registration_expiry) }}</template><template v-if="v.insurance_expiry"> · Insurance expires {{ dt(v.insurance_expiry) }}</template></div>
            </div>
            <img v-if="v.photo" :src="v.photo" alt="" style="width:96px;height:64px;object-fit:cover;border-radius:10px">
          </div>
        </div>
        <div v-if="!vehicles.length && !showForm" class="card"><empty-state icon="bi-car-front" title="No vehicle on file" text="Add your vehicle's details to start driving."></empty-state></div>

        <form class="card" v-if="showForm" @submit.prevent="submit">
          <div class="card-head"><h3>Add a vehicle</h3><button type="button" class="icon-btn" v-if="vehicles.length" @click="showForm = false"><i class="bi bi-x-lg"></i></button></div>
          <div class="card-body">
            <div v-if="formError" class="alert bad mb-2"><i class="bi bi-exclamation-octagon"></i><div>{{ formError }}</div></div>
            <div class="grid grid-2">
              <div class="field"><label>Registration number</label><input class="input mono" v-model="form.reg_number" placeholder="KA01AB1234" required></div>
              <div class="field"><label>Vehicle type</label><select class="select" v-model="form.vehicle_type"><option v-for="t in types" :key="t.v" :value="t.v">{{ t.l }}</option></select></div>
              <div class="field"><label>Manufacturer</label><input class="input" v-model="form.manufacturer" placeholder="Maruti Suzuki"></div>
              <div class="field"><label>Model</label><input class="input" v-model="form.model" placeholder="Swift"></div>
              <div class="field"><label>Colour</label><input class="input" v-model="form.colour" placeholder="White"></div>
              <div class="field"><label>Year</label><input class="input" type="number" v-model="form.year" placeholder="2022"></div>
              <div class="field"><label>Seating capacity</label><input class="input" type="number" min="1" max="60" v-model.number="form.seating_capacity"></div>
              <div class="field"><label>Registration expiry</label><input class="input" type="date" v-model="form.registration_expiry"></div>
              <div class="field"><label>Insurance expiry</label><input class="input" type="date" v-model="form.insurance_expiry"></div>
            </div>
            <photo-picker v-model="form.photo" label="Vehicle photo"></photo-picker>
            <button class="btn" :disabled="busy || !form.reg_number"><span v-if="busy" class="spin"></span>Submit for approval</button>
          </div>
        </form>
      </div>
    </template>
  </div>`,
};
