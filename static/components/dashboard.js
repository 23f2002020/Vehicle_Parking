export default {
  template: `
  <div class="container my-4">
  <div class="user-bookings">
    <h2>Upcoming Bookings</h2>
    <div v-if="loading" class="loading-spinner">
      <i class="bi bi-arrow-repeat"></i> Loading...
    </div>
    <div v-else-if="bookings.length === 0" class="no-bookings">
      You have no upcoming bookings
    </div>
    <div v-else class="booking-list">
      <div v-for="booking in bookings" :key="booking.id" class="booking-card">
        <div class="booking-header">
          <span class="booking-id">#{{ booking.id }}</span>
          <span class="booking-status" :class="booking.status">{{ booking.status }}</span>
        </div>
        <div class="booking-details">
          <div><i class="bi bi-geo-alt"></i> {{ booking.lot_name }}</div>
          <div><i class="bi bi-car-front"></i> {{ booking.vehicle_number }}</div>
          <div><i class="bi bi-p-square"></i> Floor {{ booking.floor }}, Row {{ booking.row }}, Slot {{ booking.slot_number }}</div>
          <div><i class="bi bi-calendar"></i> {{ formatDate(booking.start_time) }} | {{ formatTimeRange(booking.start_time, booking.end_time) }}</div>
          <div v-if="booking.amenities" class="amenities">
            <i class="bi bi-star"></i> {{ booking.amenities }}
          </div>
        </div>
        <div class="booking-footer">
          <div class="total-amount">₹{{ booking.total_amount }}</div>
          <button class="btn btn-sm btn-outline-danger" @click="cancelBooking(booking.id)">
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
    <!-- Top Navigation Bar -->
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
          <li><router-link class="dropdown-item" to="/reservations"><i class="bi bi-calendar-check me-2"></i>My Bookings</router-link></li>
          <li><router-link class="dropdown-item" to="/payments"><i class="bi bi-receipt me-2"></i>Payments</router-link></li>
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item text-danger" @click="logout"><i class="bi bi-box-arrow-right me-2"></i>Logout</button></li>
        </ul>
      </div>
    </div>

    <!-- Placeholder while loading -->
    <div v-if="loading" class="row">
      <div class="col-md-4 mb-4" v-for="n in 3" :key="n">
        <div class="card" aria-hidden="true">
          <img src="/static/image2.png" class="card-img-top" alt="...">
          <div class="card-body">
            <h5 class="card-title placeholder-glow">
              <span class="placeholder col-6"></span>
            </h5>
            <p class="card-text placeholder-glow">
              <span class="placeholder col-7"></span>
              <span class="placeholder col-4"></span>
              <span class="placeholder col-4"></span>
              <span class="placeholder col-6"></span>
              <span class="placeholder col-8"></span>
            </p>
            <a class="btn btn-primary disabled placeholder col-6" aria-disabled="true"></a>
          </div>
        </div>
      </div>
    </div>

    <!-- Parking Lots Display -->
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

    <!-- Map Modal -->
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
      bookings: [], // from first snippet
      lots: [], // from second snippet
      search: '', // from second snippet
      selectedLot: null, // from second snippet
      loading: true // common, but initialized here
    };
  },

  computed: {
    filteredLots() { // from second snippet
      return this.lots.filter(lot =>
        lot.name?.toLowerCase().includes(this.search.toLowerCase()) ||
        lot.address?.toLowerCase().includes(this.search.toLowerCase())
      );
    }
  },

  methods: {
    async fetchUserBookings() { // from first snippet
      try {
        const response = await fetch('/api/user/reservations', { // Changed from /api/user/bookings to /api/user/reservations as per current `resources.py` and conceptual design
          headers: {
            'Authentication-token': localStorage.getItem('auth_token') // Changed to Authentication-token
          }
        });

        if (response.ok) {
          const data = await response.json();
          this.bookings = data
            .filter(b => new Date(b.end_time) > new Date()) // Only upcoming
            .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
        } else {
          // Handle unauthorized or forbidden access
          if (response.status === 401 || response.status === 403) {
            this.logout();
            return;
          }
          throw new Error(`Failed to fetch bookings: ${response.statusText}`);
        }
      } catch (error) {
        console.error("Error fetching bookings:", error);
      } finally {
        this.loading = false;
      }
    },

    fetchLots() { // from second snippet
      this.loading = true;
      fetch('/api/parking_lot', {
          headers: {
            'Authentication-token': localStorage.getItem('auth_token')
          }
        })
        .then(res => {
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              this.logout();
              return;
            }
            throw new Error('Failed to load lots');
          }
          return res.json();
        })
        .then(data => {
          this.lots = data;
        })
        .catch(error => {
          console.error('Fetch error:', error);
          this.lots = [];
        })
        .finally(() => {
          this.loading = false;
        });
    },

    formatDate(dateString) { // from first snippet
      const options = {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      };
      return new Date(dateString).toLocaleDateString('en-US', options);
    },

    formatTimeRange(start, end) { // from first snippet
      const formatTime = (date) => new Date(date).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${formatTime(start)} - ${formatTime(end)}`;
    },

    async cancelBooking(bookingId) { // from first snippet
      if (confirm("Are you sure you want to cancel this booking?")) {
        try {
          const response = await fetch(`/api/reservations/${bookingId}`, { // Changed to /api/reservations/${bookingId}
            method: "DELETE",
            headers: {
              'Authentication-token': localStorage.getItem('auth_token') // Changed to Authentication-token
            }
          });

          if (response.ok) {
            // Update slot status to available - This logic needs to be handled on the backend
            // The frontend should just re-fetch the bookings after a successful cancellation
            await this.fetchUserBookings();
            alert("Booking cancelled successfully");
          } else {
            const errorData = await response.json();
            throw new Error(errorData.message || "Failed to cancel booking");
          }
        } catch (error) {
          console.error("Error cancelling booking:", error);
          alert(error.message || "Failed to cancel booking");
        }
      }
    },

    // The updateSlotStatus method is removed from here. It should be handled by the backend
    // when a reservation is successfully cancelled. The frontend only needs to trigger
    // the DELETE API call and then refresh its data.

    previewMap(lot) { // from second snippet
      this.selectedLot = lot;
      new bootstrap.Modal(document.getElementById('mapModal')).show();
    },
    startBooking(lot) { // from second snippet
      this.$router.push({
        name: 'booking',
        query: {
          lot_id: lot.id
        }
      });
    },
    logout() { // from second snippet (modified for consistency with Login.js)
      fetch('/api/logout', {
          method: 'POST',
          headers: {
            'Authentication-token': localStorage.getItem('auth_token')
          }
        })
        .finally(() => {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('user_roles'); // Ensure roles are also cleared
          this.$router.push('/login');
        });
    },
    logoutOnUnload() { // from second snippet
      const token = localStorage.getItem('auth_token');
      if (token) {
        // Use keepalive for sendBeacon to ensure request is sent even if page closes
        navigator.sendBeacon('/api/logout', JSON.stringify({
          auth_token: token
        }));
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user_roles');
      }
    }
  },

  mounted() {
    this.fetchLots(); // Fetch lots when dashboard loads
    this.fetchUserBookings(); // Fetch user bookings when dashboard loads
    window.addEventListener('beforeunload', this.logoutOnUnload);
  },

  beforeDestroy() {
    window.removeEventListener('beforeunload', this.logoutOnUnload);
  }
};
