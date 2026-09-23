// Shared bits for the DRIVER PARTNER (ride captain / valet driver) dashboard - kept local to this
// folder rather than added to components/ui.js, so nothing about the existing Admin/User UI changes.
// Naming: the backend role is literally "driver" (see driver_service.py's docstring for why), but
// every label here says "driver partner" / "ride captain" / "valet driver" - the existing app
// already calls the parking customer "Driver" in its nav, so this avoids on-screen confusion.
import { get } from '../../api.js';
import { money, relTime, dt } from '../../format.js';

// One shared reactive "who is this driver partner" store (same Vue.observable pattern session.js
// uses) so the sidebar's online toggle, badges and every page agree without every page re-fetching
// /api/driver/me on its own. Call refreshDriver() after any action that can change availability,
// KYC, or vehicle status; other views just read partnerStore.driver.
export const partnerStore = Vue.observable({ driver: null, ready: false });

export async function refreshDriver() {
  const d = await get('/api/driver/me');
  partnerStore.driver = d;
  partnerStore.ready = true;
  return d;
}

export function offlineReason(driver) {
  if (!driver) return '';
  if (driver.account_status !== 'active') return 'Your account is suspended' + (driver.suspend_reason ? ` - ${driver.suspend_reason}` : '') + '.';
  if (driver.kyc_status !== 'APPROVED') return 'Complete your KYC verification to go online.';
  if (driver.driver_type === 'ride_captain' && !(driver.vehicles || []).some(v => v.status === 'APPROVED'))
    return 'Add a vehicle and get it approved to go online.';
  return '';
}

export const RIDE_STEPS = ['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED', 'RIDE_COMPLETED'];
export const VALET_STEPS = ['REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'VEHICLE_PICKED_UP',
  'VEHICLE_IN_TRANSIT', 'VEHICLE_DROPPED', 'COMPLETED'];

const RIDE_META = {
  REQUESTED: { label: 'Requested', icon: 'bi-broadcast', cls: 'info' },
  ACCEPTED: { label: 'Accepted', icon: 'bi-check2-circle', cls: 'info' },
  DRIVER_ARRIVING: { label: 'Heading to pickup', icon: 'bi-signpost-2', cls: 'info' },
  DRIVER_ARRIVED: { label: 'Arrived at pickup', icon: 'bi-geo-alt-fill', cls: 'warn' },
  RIDE_STARTED: { label: 'On trip', icon: 'bi-car-front-fill', cls: 'ok' },
  RIDE_COMPLETED: { label: 'Completed', icon: 'bi-flag-fill', cls: '' },
  CANCELLED: { label: 'Cancelled', icon: 'bi-x-circle', cls: 'bad' },
};
const VALET_META = {
  REQUESTED: { label: 'Requested', icon: 'bi-broadcast', cls: 'info' },
  DRIVER_ASSIGNED: { label: 'Assigned to you', icon: 'bi-check2-circle', cls: 'info' },
  DRIVER_GOING_TO_PICKUP: { label: 'Heading to pickup', icon: 'bi-signpost-2', cls: 'info' },
  VEHICLE_PICKED_UP: { label: 'Vehicle picked up', icon: 'bi-key-fill', cls: 'warn' },
  VEHICLE_IN_TRANSIT: { label: 'In transit', icon: 'bi-car-front-fill', cls: 'ok' },
  VEHICLE_DROPPED: { label: 'Dropped off', icon: 'bi-geo-alt-fill', cls: 'warn' },
  COMPLETED: { label: 'Completed', icon: 'bi-flag-fill', cls: '' },
  CANCELLED: { label: 'Cancelled', icon: 'bi-x-circle', cls: 'bad' },
};

export function rideMeta(status) { return RIDE_META[status] || { label: status, icon: 'bi-circle', cls: '' }; }
export function valetMeta(status) { return VALET_META[status] || { label: status, icon: 'bi-circle', cls: '' }; }

export function ridePct(status) {
  if (status === 'CANCELLED') return 100;
  const i = RIDE_STEPS.indexOf(status);
  return i < 0 ? 0 : Math.round((i / (RIDE_STEPS.length - 1)) * 100);
}
export function valetPct(status) {
  if (status === 'CANCELLED') return 100;
  const i = VALET_STEPS.indexOf(status);
  return i < 0 ? 0 : Math.round((i / (VALET_STEPS.length - 1)) * 100);
}

export const REQUEST_TYPE_LABEL = {
  home_to_lot: 'Home → Lot', lot_to_home: 'Lot → Home',
  location_to_lot: 'Location → Lot', lot_to_location: 'Lot → Location',
};

export const DRIVER_TYPE_LABEL = { ride_captain: 'Ride captain', valet_driver: 'Valet driver' };

export function isRideActive(status) { return ['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'RIDE_STARTED'].includes(status); }
export function isValetActive(status) {
  return ['REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_GOING_TO_PICKUP', 'VEHICLE_PICKED_UP', 'VEHICLE_IN_TRANSIT', 'VEHICLE_DROPPED'].includes(status);
}

// -------------------------------------------------------------- dummy "file upload" (data: URI)
// No real file storage/CDN in this app (see FIXES.md) - the picked file is base64-encoded in the
// browser and sent as an ordinary JSON string. Capped client-side too, to fail fast with a clear
// message instead of a giant request the backend will reject anyway (DRIVER_MAX_PHOTO_CHARS).
const MAX_PHOTO_BYTES = 650 * 1024;

export function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > MAX_PHOTO_BYTES) return reject(new Error(`"${file.name}" is too large - please pick a photo under 650 KB.`));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

// Small reusable "take/choose photo" control - shows a preview, a change/remove button, and
// reports back a data: URI (or null). Registered locally by each partner view that needs it.
export const PhotoPicker = {
  props: { value: { type: String, default: null }, label: String, hint: String, round: Boolean },
  data() { return { busy: false, error: '' }; },
  methods: {
    async onPick(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      this.busy = true; this.error = '';
      try {
        const uri = await fileToDataUri(file);
        this.$emit('input', uri);
      } catch (err) { this.error = err.message; }
      this.busy = false;
    },
    clear() { this.$emit('input', null); },
  },
  template: `
  <div class="field">
    <label v-if="label">{{ label }}</label>
    <div class="photo-pick" :class="{ round }">
      <div class="photo-pick-preview" :class="{ round }">
        <img v-if="value" :src="value" alt="">
        <i v-else class="bi bi-camera"></i>
      </div>
      <div class="grow">
        <label class="btn btn-sm btn-outline">
          <span v-if="busy" class="spin"></span>{{ value ? 'Change photo' : 'Upload photo' }}
          <input type="file" accept="image/*" style="display:none" @change="onPick">
        </label>
        <button type="button" class="btn btn-sm btn-ghost" v-if="value" @click="clear">Remove</button>
        <div class="hint mb-0" v-if="hint">{{ hint }}</div>
        <div class="error-text" v-if="error">{{ error }}</div>
      </div>
    </div>
  </div>`,
};

// -------------------------------------------------------------- job (ride / valet) card
// Used by both the "available pool" and "my jobs" lists, and by the home-page "current job"
// banner. In pool mode it shows an inline Accept button (emits 'accept') instead of linking
// straight through, since speed matters when a captain is racing other drivers for the same job.
export const JobCard = {
  props: { job: { type: Object, required: true }, kind: { type: String, required: true }, pool: Boolean, busy: Boolean },
  computed: {
    meta() { return this.kind === 'ride' ? rideMeta(this.job.status) : valetMeta(this.job.status); },
    amount() { return this.kind === 'ride' ? (this.job.fare ? this.job.fare.total : null) : (this.job.fee || null); },
    amountPaid() { return this.kind === 'ride' ? !!(this.job.fare && this.job.fare.paid) : !!this.job.paid; },
    when() {
      const j = this.job;
      return j.completed_at || j.cancelled_at || j.started_at || j.dropped_at || j.in_transit_at
        || j.picked_up_at || j.assigned_at || j.accepted_at || j.requested_at;
    },
    riderName() { return this.job.rider ? this.job.rider.username : ''; },
  },
  methods: { money, relTime, dt },
  template: `
  <article :class="['job-card', 's-' + meta.cls, { 'pool-card': pool }]" @click="!pool && $emit('open')">
    <div class="stripe"></div>
    <div class="job-body">
      <div class="job-title">
        <span class="pill" :class="meta.cls"><i :class="['bi', meta.icon]"></i>{{ meta.label }}</span>
        <span class="mono tiny muted">{{ job.code }}</span>
        <span v-if="kind === 'valet'" class="pill">{{ job.request_type ? job.request_type.replace(/_/g, ' ') : '' }}</span>
      </div>
      <div class="job-route"><i class="bi bi-geo-alt-fill ok-text"></i>{{ job.pickup_label }}<i class="bi bi-arrow-right via"></i>{{ job.drop_label }}</div>
      <div class="job-meta">
        <span v-if="riderName"><i class="bi bi-person"></i>{{ riderName }}</span>
        <span v-if="job.vehicle_number"><i class="bi bi-car-front"></i>{{ job.vehicle_number }}</span>
        <span><i class="bi bi-signpost-split"></i>{{ job.distance_km }} km</span>
        <span><i class="bi bi-clock"></i>{{ relTime(when, Date.now()) }}</span>
      </div>
    </div>
    <div class="job-side">
      <div class="right">
        <div class="bk-amt" v-if="amount">{{ money(amount) }}<span v-if="amountPaid" class="pill ok tiny ml-1">Paid</span></div>
        <div class="tiny muted" v-else>Fare on completion</div>
      </div>
      <button v-if="pool" class="btn btn-sm" :disabled="busy" @click.stop="$emit('accept')"><span v-if="busy" class="spin"></span>Accept</button>
      <button v-else class="btn btn-sm btn-outline" @click.stop="$emit('open')">Details</button>
    </div>
  </article>`,
};

// -------------------------------------------------------------- illustrative route map
// The user asked for the captain/driver and rider screens to show a map so the driver partner can
// "navigate through the map to reach the location and forth to destination". This project has a firm
// no-real-external-API rule (see FIXES.md) - no Google Maps/GPS key, nothing phoning out - so this
// draws a simple, honestly-labelled pickup -> drop route with a progress overlay and a moving marker
// instead of a live map. It is presentational only and shares one definition for both sides, imported
// here and re-exported through mobilityLib.js, so the rider and driver partner never see different UI.
const ROUTE_P0 = { x: 34, y: 92 };    // pickup pin, in the SVG's own 320x106 coordinate space
const ROUTE_P1 = { x: 160, y: 14 };   // control point - bows the route upward so it doesn't look like a straight line
const ROUTE_P2 = { x: 286, y: 60 };   // drop pin

function _bezierPoint(t) {
  const u = 1 - t;
  return {
    x: u * u * ROUTE_P0.x + 2 * u * t * ROUTE_P1.x + t * t * ROUTE_P2.x,
    y: u * u * ROUTE_P0.y + 2 * u * t * ROUTE_P1.y + t * t * ROUTE_P2.y,
  };
}

// "Physical position" along the route: 0 = still at pickup, 50 = en route, 100 = arrived at drop.
// Deliberately separate from ridePct/valetPct above, which track job-*lifecycle* progress (how many
// of the status steps are done) rather than where the vehicle would be on a route.
export function ridePos(status) {
  if (status === 'RIDE_STARTED') return 50;
  if (status === 'RIDE_COMPLETED') return 100;
  return 0; // REQUESTED, ACCEPTED, DRIVER_ARRIVING, DRIVER_ARRIVED, CANCELLED - not moving between pickup/drop yet
}
export function valetPos(status) {
  if (status === 'VEHICLE_IN_TRANSIT') return 50;
  if (status === 'VEHICLE_DROPPED' || status === 'COMPLETED') return 100;
  return 0;
}

export const RouteMap = {
  props: {
    pickupLabel: { type: String, default: '' },
    dropLabel: { type: String, default: '' },
    distanceKm: { type: [Number, String], default: null },
    pct: { type: Number, default: 0 },       // 0-100, from ridePos()/valetPos()
    cancelled: { type: Boolean, default: false },
  },
  computed: {
    clampedPct() { return Math.max(0, Math.min(100, this.pct || 0)); },
    marker() { return _bezierPoint(this.clampedPct / 100); },
    markerStyle() { return { left: (this.marker.x / 320 * 100) + '%', top: (this.marker.y / 106 * 100) + '%' }; },
    pathD() { return `M${ROUTE_P0.x},${ROUTE_P0.y} Q${ROUTE_P1.x},${ROUTE_P1.y} ${ROUTE_P2.x},${ROUTE_P2.y}`; },
    dashoffset() { return 100 - this.clampedPct; },
    phaseLabel() {
      if (this.cancelled) return 'Cancelled';
      if (this.clampedPct <= 0) return 'Waiting at pickup';
      if (this.clampedPct >= 100) return 'Arrived';
      return 'On the way';
    },
  },
  template: `
  <div class="route-map" style="position:relative;max-width:480px;margin:0 auto">
    <svg viewBox="0 0 320 106" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;aspect-ratio:320/106;background:#f7f8fc;border-radius:10px">
      <path :d="pathD" fill="none" stroke="#d5dbf2" stroke-width="4" stroke-linecap="round" stroke-dasharray="1.5 6" pathLength="100"></path>
      <path v-if="!cancelled" :d="pathD" fill="none" stroke="#22d3a4" stroke-width="4" stroke-linecap="round"
            pathLength="100" stroke-dasharray="100" :stroke-dashoffset="dashoffset" style="transition:stroke-dashoffset .6s ease"></path>
      <g transform="translate(34,92)"><circle r="6.5" fill="#22d3a4"></circle><circle r="2.5" fill="#fff"></circle></g>
      <g transform="translate(286,60)"><circle r="6.5" fill="#6c7bff"></circle><circle r="2.5" fill="#fff"></circle></g>
    </svg>
    <div v-if="!cancelled" class="route-map-marker" :style="markerStyle" style="position:absolute;transform:translate(-50%,-50%);transition:left .6s ease, top .6s ease">
      <i class="bi bi-car-front-fill" style="display:block;font-size:1rem;color:#12203f;background:#fff;border-radius:50%;padding:4px;box-shadow:0 1px 5px rgba(18,32,63,.35)"></i>
    </div>
    <div class="flex between wrap gap-2 small mt-1">
      <div><i class="bi bi-geo-alt-fill ok-text"></i> {{ pickupLabel }}</div>
      <span class="pill" :class="cancelled ? 'bad' : (clampedPct >= 100 ? 'ok' : 'info')">{{ phaseLabel }}</span>
      <div><i class="bi bi-flag-fill"></i> {{ dropLabel }}</div>
    </div>
    <div class="tiny muted mt-1"><i class="bi bi-info-circle"></i> Illustrative route{{ distanceKm != null ? ' · ' + distanceKm + ' km' : '' }} - no live GPS in this demo.</div>
  </div>`,
};

// -------------------------------------------------------------- real OpenStreetMap (Leaflet) map
// The user explicitly asked for a REAL map: the rider picks real pickup/drop pins on it, and the
// driver partner uses the SAME real map to navigate. Confirmed, explicit scope (see FIXES.md): real
// OpenStreetMap tiles (free, no sign-up/API key) with a straight-line path overlay - never full
// turn-by-turn routing, which would need a separate directions/routing service this app still does
// not use. This is the one deliberate exception to the project's "no real external API" rule -
// payments, KYC and the fare *formula* are still 100% dummy/local. Leaflet itself is vendored under
// /static/vendor/leaflet exactly like Vue/Chart.js are (loaded as a plain <script>, global `L`) -
// only the map TILE images need the network at runtime.
const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const OSM_DEFAULT_CENTER = [12.9716, 77.5946];   // a sane starting view before any pin or geolocation

let _leafletIconPathSet = false;
function _ensureLeafletIconPath() {
  if (_leafletIconPathSet || typeof L === 'undefined') return;
  L.Icon.Default.prototype.options.imagePath = '/static/vendor/leaflet/images/';
  _leafletIconPathSet = true;
}

// Small coloured pin / car markers built from the same Bootstrap Icons glyphs the rest of the app
// (and the illustrative RouteMap above) already use, instead of Leaflet's plain default pin, so a
// real map and the illustrative fallback still look like one consistent design.
function _pinIcon(color) {
  return L.divIcon({
    className: 'vp-map-pin', iconSize: [26, 26], iconAnchor: [13, 24], popupAnchor: [0, -22],
    html: `<span style="display:block;width:26px;height:26px"><svg viewBox="0 0 26 32" width="26" height="32" style="display:block;overflow:visible">` +
      `<path d="M13 0C6 0 0 5.8 0 13c0 9 13 19 13 19s13-10 13-19C26 5.8 20 0 13 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>` +
      `<circle cx="13" cy="13" r="5" fill="#fff"/></svg></span>`,
  });
}
function _carIcon() {
  return L.divIcon({
    className: 'vp-map-car', iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;` +
      `background:#fff;box-shadow:0 1px 6px rgba(18,32,63,.45)"><i class="bi bi-car-front-fill" style="color:#12203f;font-size:1rem"></i></span>`,
  });
}

// -------------------------------------------------------------- rider-side: pick pickup/drop on a real map
// Emits update:pickup / update:drop with a {lat, lng} object whenever the rider taps the map, drags a
// pin, or uses "Use my location" - the parent view (RequestMobility.js) owns the actual lat/lng state
// (v-model style) and re-sends it back down as props, same pattern the rest of this app already uses
// for controlled inputs. No address search/autocomplete: keeping this to click-to-pin plus free-text
// labels (already on the form) avoids depending on a second, rate-limited geocoding service on top
// of the map tiles.
export const LocationPickerMap = {
  props: {
    pickupLat: { type: Number, default: null }, pickupLng: { type: Number, default: null },
    dropLat: { type: Number, default: null }, dropLng: { type: Number, default: null },
  },
  data() { return { map: null, pickupMarker: null, dropMarker: null, line: null, stage: 'pickup', geoBusy: false, geoError: '' }; },
  computed: {
    bothSet() { return this.pickupLat != null && this.dropLat != null; },
  },
  mounted() {
    _ensureLeafletIconPath();
    const center = this.pickupLat != null ? [this.pickupLat, this.pickupLng] : OSM_DEFAULT_CENTER;
    this.map = L.map(this.$refs.el).setView(center, 13);
    L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(this.map);
    this.map.on('click', (e) => this.onMapClick(e.latlng));
    this._syncMarkers();
    // Leaflet measures its container on creation - if that container was still 0-height (e.g. inside
    // a tab or a card that was still laying out), one delayed re-check fixes a half-grey map.
    setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 250);
  },
  beforeDestroy() {
    if (this.map) { this.map.remove(); this.map = null; }
  },
  watch: {
    pickupLat() { this._syncMarkers(); }, pickupLng() { this._syncMarkers(); },
    dropLat() { this._syncMarkers(); }, dropLng() { this._syncMarkers(); },
  },
  methods: {
    setStage(s) { this.stage = s; },
    onMapClick(latlng) {
      const point = { lat: latlng.lat, lng: latlng.lng };
      if (this.stage === 'drop' && this.pickupLat != null) {
        this.$emit('update:drop', point);
        this.stage = 'pickup';
      } else {
        this.$emit('update:pickup', point);
        this.stage = this.dropLat == null ? 'drop' : 'pickup';
      }
    },
    useMyLocation() {
      if (!navigator.geolocation) { this.geoError = 'Location is not available in this browser.'; return; }
      this.geoBusy = true; this.geoError = '';
      navigator.geolocation.getCurrentPosition((pos) => {
        this.geoBusy = false;
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const settingDrop = this.stage === 'drop' && this.pickupLat != null;
        this.$emit(settingDrop ? 'update:drop' : 'update:pickup', point);
        if (this.map) this.map.setView([point.lat, point.lng], 15);
        this.stage = settingDrop ? 'pickup' : (this.dropLat == null ? 'drop' : 'pickup');
      }, (err) => {
        this.geoBusy = false;
        this.geoError = 'Could not get your location - ' + (err && err.message ? err.message : 'permission denied') + '.';
      }, { timeout: 8000 });
    },
    _syncMarkers() {
      if (!this.map) return;
      if (this.pickupLat != null) {
        const ll = [this.pickupLat, this.pickupLng];
        if (this.pickupMarker) this.pickupMarker.setLatLng(ll);
        else this.pickupMarker = L.marker(ll, { icon: _pinIcon('#22d3a4'), draggable: true }).addTo(this.map)
          .on('dragend', (e) => this.$emit('update:pickup', e.target.getLatLng()));
      } else if (this.pickupMarker) { this.map.removeLayer(this.pickupMarker); this.pickupMarker = null; }
      if (this.dropLat != null) {
        const ll = [this.dropLat, this.dropLng];
        if (this.dropMarker) this.dropMarker.setLatLng(ll);
        else this.dropMarker = L.marker(ll, { icon: _pinIcon('#6c7bff'), draggable: true }).addTo(this.map)
          .on('dragend', (e) => this.$emit('update:drop', e.target.getLatLng()));
      } else if (this.dropMarker) { this.map.removeLayer(this.dropMarker); this.dropMarker = null; }
      if (this.bothSet) {
        const pts = [[this.pickupLat, this.pickupLng], [this.dropLat, this.dropLng]];
        if (this.line) this.line.setLatLngs(pts);
        else this.line = L.polyline(pts, { color: '#6c7bff', weight: 3, dashArray: '2 8' }).addTo(this.map);
        this.map.fitBounds(pts, { padding: [32, 32], maxZoom: 15 });
      } else if (this.line) { this.map.removeLayer(this.line); this.line = null; }
    },
  },
  template: `
  <div class="location-picker-map">
    <div class="flex between wrap gap-2 mb-2">
      <div class="flex gap-2">
        <button type="button" class="btn btn-sm" :class="stage === 'pickup' ? '' : 'btn-outline'" @click="setStage('pickup')">
          <i class="bi bi-geo-alt-fill" style="color:#22d3a4"></i> {{ pickupLat != null ? 'Change pickup' : 'Set pickup' }}
        </button>
        <button type="button" class="btn btn-sm" :class="stage === 'drop' ? '' : 'btn-outline'" @click="setStage('drop')">
          <i class="bi bi-flag-fill" style="color:#6c7bff"></i> {{ dropLat != null ? 'Change drop-off' : 'Set drop-off' }}
        </button>
      </div>
      <button type="button" class="btn btn-sm btn-outline" :disabled="geoBusy" @click="useMyLocation">
        <span v-if="geoBusy" class="spin"></span><i v-else class="bi bi-crosshair"></i> Use my location
      </button>
    </div>
    <div ref="el" class="lp-map-canvas" style="height:260px;border-radius:12px;overflow:hidden;border:1px solid var(--line)"></div>
    <div class="tiny muted mt-1"><i class="bi bi-info-circle"></i> Real OpenStreetMap - tap the map (or drag a pin) to set {{ stage === 'drop' ? 'the drop-off location' : 'the pickup location' }}.</div>
    <div v-if="geoError" class="error-text mt-1">{{ geoError }}</div>
  </div>`,
};

// -------------------------------------------------------------- rider + driver partner: navigate on a real map
// Drop-in replacement for RouteMap wherever real pickup/drop coordinates exist: same props plus the
// four lat/lng values, same phase pill/labels underneath, but a genuine OpenStreetMap view with a
// straight-line path overlay and a marker that moves along that line as the job progresses (still
// driven by ridePos()/valetPos() - this never claims to be live GPS tracking, see the disclaimer in
// the template). Falls back to the illustrative RouteMap automatically whenever coordinates are
// missing (a job requested before this feature existed, or requested without using the map), so
// nothing that already works can break.
export const LiveRouteMap = {
  components: { RouteMap },
  props: {
    pickupLabel: { type: String, default: '' }, dropLabel: { type: String, default: '' },
    pickupLat: { type: Number, default: null }, pickupLng: { type: Number, default: null },
    dropLat: { type: Number, default: null }, dropLng: { type: Number, default: null },
    distanceKm: { type: [Number, String], default: null },
    pct: { type: Number, default: 0 },
    cancelled: { type: Boolean, default: false },
  },
  data() { return { map: null, marker: null }; },
  computed: {
    hasRealPoints() { return this.pickupLat != null && this.pickupLng != null && this.dropLat != null && this.dropLng != null; },
    clampedPct() { return Math.max(0, Math.min(100, this.pct || 0)); },
    phaseLabel() {
      if (this.cancelled) return 'Cancelled';
      if (this.clampedPct <= 0) return 'Waiting at pickup';
      if (this.clampedPct >= 100) return 'Arrived';
      return 'On the way';
    },
    markerLatLng() {
      const t = this.clampedPct / 100;
      return [this.pickupLat + (this.dropLat - this.pickupLat) * t, this.pickupLng + (this.dropLng - this.pickupLng) * t];
    },
  },
  mounted() { if (this.hasRealPoints) this._init(); },
  beforeDestroy() { if (this.map) { this.map.remove(); this.map = null; } },
  watch: {
    hasRealPoints(v) { if (v) this.$nextTick(() => { if (!this.map) this._init(); }); },
    pct() { this._moveMarker(); },
    cancelled() { this._moveMarker(); },
  },
  methods: {
    _init() {
      _ensureLeafletIconPath();
      this.map = L.map(this.$refs.el, { scrollWheelZoom: false }).setView([this.pickupLat, this.pickupLng], 13);
      L.tileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }).addTo(this.map);
      L.marker([this.pickupLat, this.pickupLng], { icon: _pinIcon('#22d3a4') }).addTo(this.map);
      L.marker([this.dropLat, this.dropLng], { icon: _pinIcon('#6c7bff') }).addTo(this.map);
      const line = L.polyline([[this.pickupLat, this.pickupLng], [this.dropLat, this.dropLng]],
        { color: '#6c7bff', weight: 3, dashArray: '2 8' }).addTo(this.map);
      this.map.fitBounds(line.getBounds(), { padding: [32, 32], maxZoom: 15 });
      if (!this.cancelled) this.marker = L.marker(this.markerLatLng, { icon: _carIcon() }).addTo(this.map);
      setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 250);
    },
    _moveMarker() {
      if (!this.map) return;
      if (this.cancelled) { if (this.marker) { this.map.removeLayer(this.marker); this.marker = null; } return; }
      if (this.marker) this.marker.setLatLng(this.markerLatLng);
      else this.marker = L.marker(this.markerLatLng, { icon: _carIcon() }).addTo(this.map);
    },
  },
  template: `
  <div class="live-route-map">
    <div v-if="hasRealPoints" ref="el" class="live-map-canvas" style="height:220px;border-radius:12px;overflow:hidden;border:1px solid var(--line)"></div>
    <route-map v-else :pickup-label="pickupLabel" :drop-label="dropLabel" :distance-km="distanceKm" :pct="pct" :cancelled="cancelled"></route-map>
    <template v-if="hasRealPoints">
      <div class="flex between wrap gap-2 small mt-1">
        <div><i class="bi bi-geo-alt-fill ok-text"></i> {{ pickupLabel }}</div>
        <span class="pill" :class="cancelled ? 'bad' : (clampedPct >= 100 ? 'ok' : 'info')">{{ phaseLabel }}</span>
        <div><i class="bi bi-flag-fill"></i> {{ dropLabel }}</div>
      </div>
      <div class="tiny muted mt-1"><i class="bi bi-info-circle"></i> Real map (OpenStreetMap){{ distanceKm != null ? ' · ' + distanceKm + ' km' : '' }} - straight-line path shown, not turn-by-turn directions.</div>
    </template>
  </div>`,
};
