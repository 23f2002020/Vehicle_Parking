// "Book a Ride" / "Request Valet" form - one file handles both kinds (route param), since the two
// requests only differ by a handful of fields. The rider now picks pickup/drop on a REAL
// OpenStreetMap map (see FIXES.md for the exact, agreed scope) - clicking/dragging pins sets
// pickup_lat/pickup_lng/drop_lat/drop_lng, and the backend measures the real distance from those
// pins itself (never trusting a client-sent number). The old manual "approximate distance" slider
// is kept as a fallback for when the map can't be used (e.g. no location permission, or offline -
// the map tiles are the one part of this app that needs the internet at runtime).
// The upfront cost is now shown on THIS screen, before the ride/valet is even requested, instead of
// only appearing after the trip ends - fetched from /api/rides/quote or /api/valet/quote (mobilityLib
// .js's fetchQuote()), debounced so it doesn't hammer the API while pins are still being dragged.
import { post } from '../../api.js';
import { money } from '../../format.js';
import { VALET_REQUEST_TYPE_OPTIONS, RESERVATION_LINKABLE, fetchLinkedBooking, fetchQuote,
        LocationPickerMap } from './mobilityLib.js';

const VEH_RE = /^[A-Z0-9]{4,12}$/;
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

export default {
  components: { LocationPickerMap },
  data() {
    return {
      loading: true, busy: false, error: '', blockingId: null,
      reservation: null, reservationUnusable: false,
      form: {
        pickup_label: '', drop_label: '', distance_km: 5, request_type: 'home_to_lot', vehicle_number: lsGet('vp_vehicle'),
        pickup_lat: null, pickup_lng: null, drop_lat: null, drop_lng: null,
      },
      typeOptions: VALET_REQUEST_TYPE_OPTIONS,
      quote: null, quoteBusy: false, quoteTimer: null,
    };
  },
  computed: {
    kind() { return this.$route.params.kind === 'valet' ? 'valet' : 'ride'; },
    title() { return this.kind === 'ride' ? 'Book a ride' : 'Request valet parking'; },
    backTo() { return '/app/mobility?kind=' + this.kind; },
    vehicleNorm() { return (this.form.vehicle_number || '').toUpperCase().replace(/[\s-]/g, ''); },
    vehicleError() { return this.kind !== 'valet' || VEH_RE.test(this.vehicleNorm) ? '' : 'Enter a valid vehicle number (4-12 letters/digits), e.g. KA01AB1234.'; },
    hasMapPoints() { return this.form.pickup_lat != null && this.form.drop_lat != null; },
    effectiveDistanceKm() { return this.hasMapPoints ? (this.quote ? this.quote.distance_km : null) : this.form.distance_km; },
    valid() {
      return this.form.pickup_label.trim() && this.form.drop_label.trim() && (this.hasMapPoints || this.form.distance_km > 0)
        && (this.kind !== 'valet' || (this.form.request_type && !this.vehicleError));
    },
  },
  async created() {
    const rid = parseInt(this.$route.query.reservation_id, 10);
    if (rid) {
      const b = await fetchLinkedBooking(rid);
      if (b && RESERVATION_LINKABLE.includes(b.status)) {
        this.reservation = b;
        if (this.kind === 'valet' && !this.form.vehicle_number) this.form.vehicle_number = b.vehicle_number;
      } else if (b) {
        this.reservationUnusable = true;
      }
    }
    this.applyLotPrefill();
    this.loading = false;
    this.refreshQuote();
  },
  watch: {
    'form.request_type'() { this.applyLotPrefill(); },
    'form.distance_km'() { this.refreshQuote(); },
    'form.pickup_lat'() { this.refreshQuote(); }, 'form.drop_lat'() { this.refreshQuote(); },
  },
  beforeDestroy() { if (this.quoteTimer) clearTimeout(this.quoteTimer); },
  methods: {
    money,
    // Mirrors driver_service.py's own auto-fill (reservation's lot name into whichever side of the
    // trip touches the lot) so what the rider sees here matches what will actually be saved.
    applyLotPrefill() {
      if (!this.reservation) return;
      if (this.kind === 'ride') {
        this.form.pickup_label = `${this.reservation.lot.name} (${this.reservation.slot.full_label})`;
        return;
      }
      const toLot = ['lot_to_home', 'lot_to_location'].includes(this.form.request_type);
      this.form.pickup_label = toLot ? this.reservation.lot.name : '';
      this.form.drop_label = toLot ? '' : this.reservation.lot.name;
    },
    setPickup(latlng) { this.form.pickup_lat = latlng.lat; this.form.pickup_lng = latlng.lng; },
    setDrop(latlng) { this.form.drop_lat = latlng.lat; this.form.drop_lng = latlng.lng; },
    clearMapPoints() {
      this.form.pickup_lat = this.form.pickup_lng = this.form.drop_lat = this.form.drop_lng = null;
      this.refreshQuote();
    },
    // Debounced so dragging a pin around doesn't fire a request per pixel - 400ms feels instant to
    // a person but easily collapses a whole drag gesture into one call.
    refreshQuote() {
      if (this.quoteTimer) clearTimeout(this.quoteTimer);
      this.quoteTimer = setTimeout(() => this._loadQuote(), 400);
    },
    async _loadQuote() {
      const body = this.hasMapPoints
        ? { pickup_lat: this.form.pickup_lat, pickup_lng: this.form.pickup_lng, drop_lat: this.form.drop_lat, drop_lng: this.form.drop_lng }
        : (this.form.distance_km > 0 ? { distance_km: this.form.distance_km } : null);
      if (!body) { this.quote = null; return; }
      this.quoteBusy = true;
      const q = await fetchQuote(this.kind, body);
      this.quote = q;
      this.quoteBusy = false;
    },
    async submit() {
      if (!this.valid || this.busy) return;
      this.busy = true; this.error = ''; this.blockingId = null;
      const body = {
        pickup_label: this.form.pickup_label.trim(), drop_label: this.form.drop_label.trim(),
      };
      if (this.hasMapPoints) {
        Object.assign(body, { pickup_lat: this.form.pickup_lat, pickup_lng: this.form.pickup_lng,
                              drop_lat: this.form.drop_lat, drop_lng: this.form.drop_lng });
      } else {
        body.distance_km = this.form.distance_km;
      }
      if (this.reservation) body.reservation_id = this.reservation.id;
      if (this.kind === 'valet') { body.request_type = this.form.request_type; body.vehicle_number = this.vehicleNorm; lsSet('vp_vehicle', this.vehicleNorm); }
      try {
        if (this.kind === 'ride') {
          const r = await post('/api/rides', body);
          this.$toast.success(r.message);
          this.$router.push('/app/mobility/ride/' + r.ride.id);
        } else {
          const r = await post('/api/valet', body);
          this.$toast.success(r.message);
          this.$router.push('/app/mobility/valet/' + r.valet_request.id);
        }
      } catch (e) {
        this.error = e.message;
        if (e.data && e.data.ride_id) this.blockingId = { kind: 'ride', id: e.data.ride_id };
        else if (e.data && e.data.valet_id) this.blockingId = { kind: 'valet', id: e.data.valet_id };
      }
      this.busy = false;
    },
  },
  template: `
  <div>
    <div class="mb-2"><router-link :to="backTo" class="small strong"><i class="bi bi-arrow-left"></i> Rides &amp; valet</router-link></div>

    <div class="page-head"><div><h1>{{ title }}</h1><p>Pick your pickup and drop-off on the real map below, or type them in - no sign-up/API key needed.</p></div></div>

    <div v-if="loading" class="skeleton" style="height:320px"></div>
    <div v-else class="card card-pad" style="max-width:640px">
      <div class="alert info mb-3" v-if="reservation">
        <i class="bi bi-link-45deg"></i>
        <div>Linked to your booking <b>{{ reservation.code }}</b> at <b>{{ reservation.lot.name }}</b> (slot {{ reservation.slot.full_label }}).
          <router-link :to="'/app/bookings/' + reservation.id">View booking</router-link></div>
      </div>
      <div class="alert warn mb-3" v-else-if="reservationUnusable">
        <i class="bi bi-exclamation-triangle"></i><div>That booking is no longer active, so this request won't be linked to it.</div>
      </div>

      <template v-if="kind === 'valet'">
        <div class="field">
          <label>What do you need?</label>
          <div class="grid grid-2" style="gap:8px">
            <label v-for="o in typeOptions" :key="o.v" :class="['radio-card', { active: form.request_type === o.v }]" style="display:block;border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;cursor:pointer">
              <input type="radio" name="rt" :value="o.v" v-model="form.request_type" style="margin-right:8px">
              <b>{{ o.l }}</b><div class="tiny muted">{{ o.hint }}</div>
            </label>
          </div>
        </div>
        <div class="field"><label>Vehicle number</label>
          <input class="input mono" v-model="form.vehicle_number" placeholder="KA01AB1234" :class="{ invalid: form.vehicle_number && vehicleError }">
          <div v-if="form.vehicle_number && vehicleError" class="error-text">{{ vehicleError }}</div>
        </div>
      </template>

      <div class="grid grid-2" style="gap:12px">
        <div class="field"><label>Pickup location</label><input class="input" v-model="form.pickup_label" placeholder="e.g. Koramangala 5th Block"></div>
        <div class="field"><label>Drop-off location</label><input class="input" v-model="form.drop_label" placeholder="e.g. Kempegowda Airport"></div>
      </div>

      <div class="field">
        <label>Set your pickup &amp; drop-off on the map</label>
        <location-picker-map :pickup-lat="form.pickup_lat" :pickup-lng="form.pickup_lng"
                             :drop-lat="form.drop_lat" :drop-lng="form.drop_lng"
                             @update:pickup="setPickup" @update:drop="setDrop"></location-picker-map>
        <div class="flex between wrap gap-2 mt-1">
          <div class="tiny muted">
            <template v-if="hasMapPoints">Distance measured from the map: {{ effectiveDistanceKm != null ? effectiveDistanceKm + ' km' : '...' }}</template>
            <template v-else>Haven't set both map pins yet - using the distance slider below for now.</template>
          </div>
          <button v-if="hasMapPoints" type="button" class="btn btn-sm btn-ghost" @click="clearMapPoints"><i class="bi bi-x-circle"></i> Clear pins, use slider instead</button>
        </div>
      </div>

      <div class="field" v-if="!hasMapPoints">
        <label>Approximate distance: {{ form.distance_km }} km</label>
        <input type="range" min="0.5" max="60" step="0.5" v-model.number="form.distance_km" style="width:100%">
        <div class="hint">Used for the {{ kind === 'ride' ? 'fare' : 'fee' }} estimate below - set both pickup/drop pins on the map above for a more accurate one.</div>
      </div>

      <!-- ===== upfront cost estimate - shown BEFORE requesting, not just after the trip ends ===== -->
      <div class="alert info mt-2" v-if="quoteBusy && !quote"><span class="spin"></span> Estimating cost...</div>
      <div class="card card-pad mt-2" style="background:var(--panel-2, #f7f8fc)" v-else-if="quote">
        <div class="flex between items-center wrap gap-2">
          <div>
            <div class="tiny muted">Estimated {{ kind === 'ride' ? 'fare' : 'fee' }} - before you request</div>
            <div style="font-size:1.4rem;font-weight:700">
              <template v-if="kind === 'ride'">{{ money(quote.estimated_low) }} – {{ money(quote.estimated_high) }}</template>
              <template v-else>{{ money(quote.estimated_fee) }}</template>
            </div>
          </div>
          <span v-if="kind === 'ride'" class="pill" :class="quote.is_peak_now ? 'warn' : 'ok'">
            <i class="bi bi-lightning-charge-fill"></i> {{ quote.is_peak_now ? 'Peak-hour surge applies' : 'No surge right now' }}
          </span>
        </div>
        <div class="tiny muted mt-1"><i class="bi bi-info-circle"></i> {{ quote.note }}</div>
      </div>

      <div v-if="error" class="alert bad mt-2"><i class="bi bi-exclamation-octagon"></i><div class="grow">{{ error }}
        <router-link v-if="blockingId" :to="'/app/mobility/' + blockingId.kind + '/' + blockingId.id" class="strong"> Go to that {{ blockingId.kind }} →</router-link>
      </div></div>

      <button class="btn btn-lg btn-block mt-3" :disabled="!valid || busy" @click="submit">
        <span v-if="busy" class="spin"></span>{{ kind === 'ride' ? 'Request ride' : 'Request valet' }}
      </button>
    </div>
  </div>`,
};
