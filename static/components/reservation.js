export default {
  template: `
    <div class="container my-4">
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h2>My Bookings</h2>
        <router-link to="/dashboard" class="btn btn-secondary">Back to Dashboard</router-link>
      </div>

      <!-- Loading Spinner -->
      <div v-if="loading" class="text-center">
        <div class="spinner-border" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>

      <!-- No Bookings State -->
      <div v-else-if="reservations.length === 0" class="text-center text-muted">
        <div class="card">
          <div class="card-body">
            <i class="bi bi-calendar-x" style="font-size: 3rem; opacity: 0.3;"></i>
            <h5 class="mt-3">No Bookings Found</h5>
            <p>You haven't made any parking reservations yet.</p>
            <router-link to="/dashboard" class="btn btn-primary">Book Your First Spot</router-link>
          </div>
        </div>
      </div>

      <!-- Bookings Content -->
      <div v-else>
        <!-- Summary Cards -->
        <div class="row mb-4">
          <div class="col-md-3 mb-3">
            <div class="card bg-primary text-white">
              <div class="card-body">
                <h5 class="card-title">Total Bookings</h5>
                <h3>{{ reservations.length }}</h3>
              </div>
            </div>
          </div>
          <div class="col-md-3 mb-3">
            <div class="card bg-success text-white">
              <div class="card-body">
                <h5 class="card-title">Upcoming</h5>
                <h3>{{ upcomingBookings.length }}</h3>
              </div>
            </div>
          </div>
          <div class="col-md-3 mb-3">
            <div class="card bg-info text-white">
              <div class="card-body">
                <h5 class="card-title">Past</h5>
                <h3>{{ pastBookings.length }}</h3>
              </div>
            </div>
          </div>
          <div class="col-md-3 mb-3">
            <div class="card bg-warning text-dark">
              <div class="card-body">
                <h5 class="card-title">Total Spent</h5>
                <h3>₹{{ totalSpent.toFixed(2) }}</h3>
              </div>
            </div>
          </div>
        </div>

        <!-- Filter Tabs -->
        <ul class="nav nav-tabs mb-4">
          <li class="nav-item">
            <button 
              class="nav-link" 
              :class="{ active: activeTab === 'upcoming' }" 
              @click="activeTab = 'upcoming'"
            >
              Upcoming ({{ upcomingBookings.length }})
            </button>
          </li>
          <li class="nav-item">
            <button 
              class="nav-link" 
              :class="{ active: activeTab === 'past' }" 
              @click="activeTab = 'past'"
            >
              Past ({{ pastBookings.length }})
            </button>
          </li>
          <li class="nav-item">
            <button 
              class="nav-link" 
              :class="{ active: activeTab === 'all' }" 
              @click="activeTab = 'all'"
            >
              All ({{ reservations.length }})
            </button>
          </li>
        </ul>

        <!-- Search and Filter -->
        <div class="row mb-3">
          <div class="col-md-6">
            <input 
              type="text" 
              class="form-control" 
              placeholder="Search by parking lot name, vehicle number..." 
              v-model="searchQuery"
            >
          </div>
          <div class="col-md-3">
            <select class="form-select" v-model="statusFilter">
              <option value="">All Statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div class="col-md-3">
            <select class="form-select" v-model="sortBy">
              <option value="start_time_desc">Newest First</option>
              <option value="start_time_asc">Oldest First</option>
              <option value="amount_desc">Highest Amount</option>
              <option value="amount_asc">Lowest Amount</option>
            </select>
          </div>
        </div>

        <!-- Bookings List -->
        <div class="row">
          <div v-for="booking in filteredBookings" :key="booking.id" class="col-md-6 mb-4">
            <div 
              class="card h-100" 
              :class="{ 
                'border-warning': isHighlighted(booking.id),
                'border-success': booking.status === 'confirmed' || booking.status === 'active',
                'border-secondary': booking.status === 'completed',
                'border-danger': booking.status === 'cancelled'
              }"
            >
              <div class="card-header d-flex justify-content-between align-items-center">
                <span class="badge bg-primary">#{{ booking.id }}</span>
                <span class="badge" :class="getStatusClass(booking.status)">
                  {{ formatStatus(booking.status) }}
                </span>
              </div>
              <div class="card-body">
                <h5 class="card-title">{{ booking.lot_name }}</h5>
                
                <div class="booking-details mb-3">
                  <div class="d-flex align-items-center mb-2">
                    <i class="bi bi-car-front me-2"></i>
                    <span>{{ booking.vehicle_number }}</span>
                  </div>
                  <div class="d-flex align-items-center mb-2">
                    <i class="bi bi-p-square me-2"></i>
                    <span>Slot {{ booking.slot_number }}</span>
                  </div>
                  <div class="d-flex align-items-center mb-2">
                    <i class="bi bi-calendar me-2"></i>
                    <span>{{ formatDate(booking.start_time) }}</span>
                  </div>
                  <div class="d-flex align-items-center mb-2">
                    <i class="bi bi-clock me-2"></i>
                    <span>{{ formatTimeRange(booking.start_time, booking.end_time) }}</span>
                  </div>
                  <div class="d-flex align-items-center mb-2">
                    <i class="bi bi-credit-card me-2"></i>
                    <span>{{ formatPaymentMode(booking.payment_mode) }}</span>
                  </div>
                  <div v-if="booking.valet_service !== 'none'" class="d-flex align-items-center mb-2">
                    <i class="bi bi-person-check me-2"></i>
                    <span>{{ formatValetService(booking.valet_service) }}</span>
                  </div>
                  <div v-if="booking.amenities" class="d-flex align-items-center mb-2">
                    <i class="bi bi-star me-2"></i>
                    <span>{{ booking.amenities }}</span>
                  </div>
                </div>

                <div class="d-flex justify-content-between align-items-center">
                  <div class="fw-bold text-success">₹{{ booking.total_amount.toFixed(2) }}</div>
                  <div>
                    <button 
                      v-if="canCancel(booking)" 
                      class="btn btn-sm btn-outline-danger me-2" 
                      @click="cancelBooking(booking.id)"
                      :disabled="cancelling === booking.id"
                    >
                      {{ cancelling === booking.id ? 'Cancelling...' : 'Cancel' }}
                    </button>
                    <button 
                      class="btn btn-sm btn-outline-primary" 
                      @click="showBookingDetails(booking)"
                    >
                      Details
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- No Results -->
        <div v-if="filteredBookings.length === 0" class="text-center text-muted mt-4">
          <p>No bookings found matching your criteria.</p>
        </div>
      </div>

      <!-- Booking Details Modal -->
      <div class="modal fade" id="bookingDetailsModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Booking Details #{{ selectedBooking?.id }}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" v-if="selectedBooking">
              <div class="row">
                <div class="col-md-6">
                  <h6>Parking Information</h6>
                  <table class="table table-sm">
                    <tr>
                      <td><strong>Parking Lot:</strong></td>
                      <td>{{ selectedBooking.lot_name }}</td>
                    </tr>
                    <tr>
                      <td><strong>Slot Number:</strong></td>
                      <td>{{ selectedBooking.slot_number }}</td>
                    </tr>
                    <tr>
                      <td><strong>Vehicle:</strong></td>
                      <td>{{ selectedBooking.vehicle_number }}</td>
                    </tr>
                    <tr>
                      <td><strong>Date:</strong></td>
                      <td>{{ formatDate(selectedBooking.start_time) }}</td>
                    </tr>
                    <tr>
                      <td><strong>Time:</strong></td>
                      <td>{{ formatTimeRange(selectedBooking.start_time, selectedBooking.end_time) }}</td>
                    </tr>
                  </table>
                </div>
                <div class="col-md-6">
                  <h6>Booking Information</h6>
                  <table class="table table-sm">
                    <tr>
                      <td><strong>Status:</strong></td>
                      <td>
                        <span class="badge" :class="getStatusClass(selectedBooking.status)">
                          {{ formatStatus(selectedBooking.status) }}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td><strong>Payment:</strong></td>
                      <td>{{ formatPaymentMode(selectedBooking.payment_mode) }}</td>
                    </tr>
                    <tr>
                      <td><strong>Total Amount:</strong></td>
                      <td class="fw-bold text-success">₹{{ selectedBooking.total_amount.toFixed(2) }}</td>
                    </tr>
                    <tr v-if="selectedBooking.valet_service !== 'none'">
                      <td><strong>Valet Service:</strong></td>
                      <td>{{ formatValetService(selectedBooking.valet_service) }}</td>
                    </tr>
                    <tr v-if="selectedBooking.amenities">
                      <td><strong>Amenities:</strong></td>
                      <td>{{ selectedBooking.amenities }}</td>
                    </tr>
                  </table>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
              <button 
                v-if="selectedBooking && canCancel(selectedBooking)" 
                type="button" 
                class="btn btn-danger" 
                @click="cancelBooking(selectedBooking.id)"
                :disabled="cancelling === selectedBooking.id"
              >
                {{ cancelling === selectedBooking.id ? 'Cancelling...' : 'Cancel Booking' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,

  data() {
    return {
      reservations: [],
      loading: true,
      activeTab: 'upcoming',
      searchQuery: '',
      statusFilter: '',
      sortBy: 'start_time_desc',
      selectedBooking: null,
      cancelling: null,
      highlightId: null
    };
  },

  computed: {
    upcomingBookings() {
      const now = new Date();
      return this.reservations.filter(booking => new Date(booking.end_time) > now);
    },

    pastBookings() {
      const now = new Date();
      return this.reservations.filter(booking => new Date(booking.end_time) <= now);
    },

    totalSpent() {
      return this.reservations
        .filter(booking => booking.status !== 'cancelled')
        .reduce((total, booking) => total + booking.total_amount, 0);
    },

    filteredBookings() {
      let bookings = [];
      
      // Filter by tab
      switch (this.activeTab) {
        case 'upcoming':
          bookings = this.upcomingBookings;
          break;
        case 'past':
          bookings = this.pastBookings;
          break;
        default:
          bookings = this.reservations;
      }

      // Filter by search query
      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        bookings = bookings.filter(booking =>
          booking.lot_name.toLowerCase().includes(query) ||
          booking.vehicle_number.toLowerCase().includes(query) ||
          booking.slot_number.toLowerCase().includes(query)
        );
      }

      // Filter by status
      if (this.statusFilter) {
        bookings = bookings.filter(booking => booking.status === this.statusFilter);
      }

      // Sort bookings
      bookings.sort((a, b) => {
        switch (this.sortBy) {
          case 'start_time_asc':
            return new Date(a.start_time) - new Date(b.start_time);
          case 'start_time_desc':
            return new Date(b.start_time) - new Date(a.start_time);
          case 'amount_asc':
            return a.total_amount - b.total_amount;
          case 'amount_desc':
            return b.total_amount - a.total_amount;
          default:
            return new Date(b.start_time) - new Date(a.start_time);
        }
      });

      return bookings;
    }
  },

  methods: {
    async fetchReservations() {
      try {
        const response = await fetch('/api/reservations', {
          headers: { 'Authentication-token': localStorage.getItem('auth_token') }
        });

        if (response.ok) {
          this.reservations = await response.json();
        } else {
          if (response.status === 401 || response.status === 403) {
            this.logout();
            return;
          }
          throw new Error('Failed to fetch reservations');
        }
      } catch (error) {
        console.error('Error fetching reservations:', error);
        alert('Failed to load your bookings. Please try again.');
      } finally {
        this.loading = false;
      }
    },

    async cancelBooking(bookingId) {
      if (!confirm("Are you sure you want to cancel this booking?")) return;

      this.cancelling = bookingId;

      try {
        const response = await fetch(`/api/reservations/${bookingId}`, {
          method: "DELETE",
          headers: { 'Authentication-token': localStorage.getItem('auth_token') }
        });

        if (response.ok) {
          await this.fetchReservations();
          alert("Booking cancelled successfully");
          
          // Close modal if it's open
          const modal = bootstrap.Modal.getInstance(document.getElementById('bookingDetailsModal'));
          if (modal) modal.hide();
        } else {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to cancel booking");
        }
      } catch (error) {
        console.error("Error cancelling booking:", error);
        alert(error.message || "Failed to cancel booking");
      } finally {
        this.cancelling = null;
      }
    },

    showBookingDetails(booking) {
      this.selectedBooking = booking;
      const modal = new bootstrap.Modal(document.getElementById('bookingDetailsModal'));
      modal.show();
    },

    canCancel(booking) {
      const now = new Date();
      const startTime = new Date(booking.start_time);
      return startTime > now && booking.status !== 'cancelled';
    },

    isHighlighted(bookingId) {
      return this.highlightId && this.highlightId == bookingId;
    },

    formatDate(dateString) {
      return new Date(dateString).toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    },

    formatTimeRange(start, end) {
      const formatTime = (date) => new Date(date).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${formatTime(start)} - ${formatTime(end)}`;
    },

    formatStatus(status) {
      const statuses = {
        'confirmed': 'Confirmed',
        'active': 'Active',
        'completed': 'Completed',
        'cancelled': 'Cancelled'
      };
      return statuses[status] || status;
    },

    formatPaymentMode(mode) {
      const modes = {
        'online': 'Online Payment',
        'offline': 'Pay at Parking'
      };
      return modes[mode] || mode;
    },

    formatValetService(service) {
      const services = {
        'oneway': 'One-Way Valet',
        'both': 'Both Ways Valet',
        'none': 'No Valet'
      };
      return services[service] || service;
    },

    getStatusClass(status) {
      const classes = {
        'confirmed': 'bg-success',
        'active': 'bg-primary',
        'completed': 'bg-secondary',
        'cancelled': 'bg-danger'
      };
      return classes[status] || 'bg-info';
    },

    logout() {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_roles');
      this.$router.push('/login');
    }
  },

  mounted() {
    // Check for highlight parameter
    this.highlightId = this.$route.query.highlight;
    this.fetchReservations();
  }
};
