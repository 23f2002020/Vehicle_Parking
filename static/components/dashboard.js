export default {
  template: `
  <div class="container my-4">
    <div class="d-flex align-items-center justify-content-between mb-4 p-2 border-bottom">
      <div class="d-flex align-items-center gap-2">
        <img src="/static/Image1.png" alt="VParkEasy Logo" height="40">
        <span class="fs-3 fw-bold">VParkEasy</span>
      </div>

      <input type="text" v-model="search" class="form-control w-50 mx-3" placeholder="Search Parking Lots">
      
      <div class="dropdown">
        <button class="btn btn-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown">
          <i class="bi bi-person-circle me-1"></i> My Account
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><router-link class="dropdown-item" to="/profile"><i class="bi bi-person me-2"></i>Profile</router-link></li>
          <li><router-link class="dropdown-item" to="/subscriptions"><i class="bi bi-credit-card me-2"></i>Subscriptions</router-link></li>
          <li><router-link class="dropdown-item" to="/MyBookings"><i class="bi bi-calendar-check me-2"></i>My Booking</router-link></li>
          <li><router-link class="dropdown-item" to="/payments"><i class="bi bi-receipt me-2"></i>Payments</router-link></li>
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item text-danger" @click="logout"><i class="bi bi-box-arrow-right me-2"></i>Logout</button></li>
        </ul>
      </div>
    </div>

    <div class="user-bookings mb-5">
      <h2>Upcoming Bookings</h2>
      <div v-if="loading" class="loading-spinner">
        <i class="bi bi-arrow-repeat"></i> Loading...
      </div>
      <div v-else-if="upcoming.length === 0" class="no-bookings"> You have no upcoming bookings </div>
      <div v-else class="booking-list">
        <div v-for="booking in upcoming" :key="booking.id" class="booking-card">
          <div class="booking-header">
            <span class="booking-id">#{{ booking.id }}</span>
            <span class="booking-status" :class="booking.status">{{ booking.status }}</span>
          </div>
          <div class="booking-details">
            <div><i class="bi bi-geo-alt"></i> {{ booking.lot_name }}</div>
            <div><i class="bi bi-car-front"></i> {{ booking.vehicle_number }}</div>
            <div><i class="bi bi-p-square"></i> Slot {{ booking.slot_number }}</div>
            <div><i class="bi bi-calendar"></i> {{ formatDate(booking.start_time) }} | {{ formatTimeRange(booking.start_time, booking.end_time) }}</div>
             <div v-if="booking.amenities" class="amenities">
              <i class="bi bi-star"></i> {{ booking.amenities }}
            </div>
          </div>
          <div class="booking-footer">
            <div class="total-amount">₹{{ booking.total_amount }}</div>
            <div class="d-flex gap-2">
                <router-link to="/MyBookings" class="btn btn-sm btn-outline-primary">Edit</router-link>
                <button class="btn btn-sm btn-outline-danger" @click="cancelBooking(booking.id)">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <div v-if="loading" class="row">
      <div class="col-sm-12 col-md-6 col-lg-4 mb-4" v-for="n in 3" :key="'skel-'+n">
        <div class="card h-100 shadow-sm" aria-hidden="true">
          <div class="card-body">
            <h5 class="card-title placeholder-glow">
              <span class="placeholder col-6"></span>
            </h5>
            <p class="card-text placeholder-glow">
              <span class="placeholder col-7"></span> <span class="placeholder col-4"></span>
              <span class="placeholder col-4"></span> <span class="placeholder col-6"></span>
              <span class="placeholder col-8"></span>
            </p>
            <a class="btn btn-primary disabled placeholder col-6" aria-disabled="true"></a>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="filteredLots.length" class="row">
      <div class="col-md-4 mb-4" v-for="lot in filteredLots" :key="lot.id">
        <div class="card shadow">
          <img src="/static/image2.png" class="card-img-top" :alt="lot.name">
          <div class="card-body">
            <h5 class="card-title">{{ lot.name }}</h5>
            <p class="card-text">{{ lot.address }} (₹{{ lot.price_per_hour }}/hr)</p>
            <p class="card-text"><small class="text-muted">Pincode: {{ lot.pin_code }}</small></p>
            <p class="card-text">Available Spots: {{ lot.available_spots }}</p>
            <button class="btn btn-outline-primary w-100" @click="previewMap(lot)">Locate on Map</button>
            <button class="btn btn-success w-100 mt-2" @click="startBooking(lot)">Book Now</button>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="text-center text-muted mt-5">
      <p>No parking lots available or something went wrong.</p>
    </div>

    <div class="modal fade" id="mapModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-lg modal-dialog-centered">
        <div class="modal-content p-3">
          <h5 class="modal-title">Parking Location - {{ selectedLot ? selectedLot.name : '' }}</h5>
          <div class="ratio ratio-16x9">
            <iframe v-if="selectedLot" class="w-100"
              :src="'https://maps.google.com/maps?q=' + encodeURIComponent(selectedLot.address) + '&output=embed'"
              frameborder="0">
            </iframe>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,

  data() {
    return {
      upcoming: [],
      past: [],
      lots: [],
      search: '',
      selectedLot: null,
      loading: true
    };
  },

  computed: {
    filteredLots() {
      if (!this.search) {
        return this.lots;
      }
      const query = this.search.toLowerCase();
      return this.lots.filter(lot =>
        lot.name?.toLowerCase().includes(query) ||
        lot.address?.toLowerCase().includes(query) ||
        lot.pin_code?.includes(query)
      );
    }
  },

  methods: {
    async robustFetch(url) {
        const response = await fetch(url, {
            headers: { 'Authentication-token': localStorage.getItem('auth_token') }
        });
        const contentType = response.headers.get("content-type");
        if (!response.ok) {
            // If the session expired, the server might redirect to a login page (HTML)
            // or return a non-JSON error.
            if (!contentType || !contentType.includes("application/json")) {
                 throw new Error("Your session may have expired. Please log in again.");
            }
            // If it's a JSON error response, let it pass to be handled by the caller.
        }
        return response; // Return the full response
    },
    async fetchUserBookings() {
      try {
        const response = await this.robustFetch('/api/reservations');
        const data = await response.json();

        if (response.ok) {
          this.upcoming = data.filter(b => new Date(b.end_time) > new Date())
                            .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
          this.past = data.filter(b => new Date(b.end_time) <= new Date())
                            .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
        } else {
          throw new Error(data.message || `Failed to fetch bookings: ${response.statusText}`);
        }
      } catch (error) {
        console.error("Error fetching bookings:", error);
        alert(error.message);
        if (error.message.includes("session")) this.logout();
      } finally {
        this.loading = false;
      }
    },

    async fetchLots() {
      try {
        const response = await this.robustFetch('/api/parking_lot');
        this.lots = await response.json();
      } catch (error) {
        alert(error.message);
        this.logout();
      }
    },

    formatDate(dateString) {
      if (!dateString) return '';
      const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
      return new Date(dateString).toLocaleDateString('en-IN', options);
    },

    formatTimeRange(start, end) {
      const formatTime = (date) => new Date(date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      return `${formatTime(start)} - ${formatTime(end)}`;
    },

    async cancelBooking(bookingId) {
      if (!confirm("Are you sure you want to cancel this booking? Refund policies may apply.")) {
        return;
      }
      
      try {
        const response = await fetch(`/api/reservations/${bookingId}`, {
          method: "DELETE",
          headers: {
            'Content-Type': 'application/json',
            'Authentication-token': localStorage.getItem('auth_token')
          }
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to cancel booking");
        }
        
        alert(data.message || "Booking cancelled successfully");
        await this.fetchUserBookings();
        
      } catch (error) {
        console.error("Error cancelling booking:", error);
        alert(error.message);
      }
    },

    previewMap(lot) {
      this.selectedLot = lot;
      new bootstrap.Modal(document.getElementById('mapModal')).show();
    },
    startBooking(lot) {
      this.$router.push({
        name: 'booking',
        query: { lot_id: lot.id }
      });
    },
    logout() {
      fetch('/api/logout', {
        method: 'POST',
        headers: { 'Authentication-token': localStorage.getItem('auth_token') }
      })
      .finally(() => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_roles');
        this.$router.push('/login');
      });
    },
    logoutOnUnload() {
      // This can sometimes be unreliable depending on the browser.
      const token = localStorage.getItem('auth_token');
      if (token) {
        navigator.sendBeacon('/api/logout', JSON.stringify({ 'Authentication-token': token }));
      }
    }
  },

  mounted() {
    this.fetchLots();
    this.fetchUserBookings();
    window.addEventListener('beforeunload', this.logoutOnUnload);
  },

  beforeUnmount() {
    window.removeEventListener('beforeunload', this.logoutOnUnload);
  }
};