export default {
  template: `
  <div class="container my-4">
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2 class="mb-0">My Bookings</h2>
      <router-link to="/dashboard" class="btn btn-sm btn-outline-secondary">Back to Dashboard</router-link>
    </div>

    <div v-if="loading" class="text-center p-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-if="success" class="alert alert-success">{{ success }}</div>

    <h4 class="mt-3">Upcoming & Active</h4>
    <div v-if="!loading && upcoming.length > 0" class="list-group">
      <div v-for="booking in upcoming" :key="booking.id" class="list-group-item list-group-item-action flex-column align-items-start">
        <div class="d-flex w-100 justify-content-between">
          <h5 class="mb-1">{{ booking.lot_name }} - Slot {{ booking.slot_number }}</h5>
          <span :class="['badge', statusClass(booking.status)]">{{ booking.status }}</span>
        </div>
        <p class="mb-1">
          From: <strong>{{ formatDT(booking.start_time) }}</strong><br>
          To: <strong>{{ formatDT(booking.end_time) }}</strong><br>
          Vehicle: <strong>{{ booking.vehicle_number }}</strong>
        </p>
        <div class="mt-2">
          <button @click="editBooking(booking)" class="btn btn-sm btn-primary me-2">Edit</button>
          <button @click="cancelBooking(booking)" class="btn btn-sm btn-danger">Cancel</button>
        </div>
      </div>
    </div>
    <div v-if="!loading && upcoming.length === 0 && !error" class="alert alert-info">No upcoming bookings.</div>

    <h4 class="mt-5">Past Bookings</h4>
    <div v-if="!loading && past.length > 0" class="list-group">
      <div v-for="booking in past" :key="booking.id" class="list-group-item list-group-item-action flex-column align-items-start">
        <div class="d-flex w-100 justify-content-between">
          <h5 class="mb-1">{{ booking.lot_name }} - Slot {{ booking.slot_number }}</h5>
           <span :class="['badge', statusClass(booking.status)]">{{ booking.status }}</span>
        </div>
        <p class="mb-1">
          On: <strong>{{ formatDT(booking.start_time) }}</strong><br>
          Vehicle: <strong>{{ booking.vehicle_number }}</strong>
        </p>
      </div>
    </div>
    <div v-if="!loading && past.length === 0 && !error" class="alert alert-secondary">No past bookings.</div>

    <div v-if="editForm" class="modal fade show" style="display: block; background-color: rgba(0,0,0,0.5);" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <form @submit.prevent="submitEdit">
            <div class="modal-header">
              <h5 class="modal-title">Edit Booking - {{ editForm.lot_name }}</h5>
              <button type="button" class="btn-close" @click="cancelEdit"></button>
            </div>
            <div class="modal-body">
              <p>You are editing the booking for <strong>Slot {{ editForm.slot_number }}</strong>.</p>
              <div class="mb-3">
                <label for="start_time_edit" class="form-label">New Start Time:</label>
                <input id="start_time_edit" type="datetime-local" v-model="editForm.start_time" class="form-control" required>
                <div class="form-text">The booking duration of {{ editForm.durationHours }} hour(s) will be maintained.</div>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" @click="cancelEdit" class="btn btn-secondary">Close</button>
              <button type="submit" class="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
  `,
  data() {
    return {
      token: localStorage.getItem('auth_token') || '',
      upcoming: [],
      past: [],
      editForm: null,
      loading: false,
      error: '',
      success: ''
    };
  },
  mounted() {
    this.fetchBookings();
  },
  methods: {
    fetchBookings() {
      this.loading = true;
      this.error = '';
      this.success = '';
      fetch('/api/reservations', {
        headers: {
          // FIX: This now uses the correct header format
          'Authentication-token': this.token
        }
      })
        .then(async res => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({ message: 'An unknown server error occurred.' }));
            throw new Error(data.message);
          }
          return res.json();
        })
        .then(bookings => {
          this.upcoming = bookings.filter(b => ['upcoming', 'active'].includes(b.status));
          this.past = bookings.filter(b => ['completed', 'cancelled'].includes(b.status));
        })
        .catch(err => {
          this.error = err.message;
        })
        .finally(() => {
          this.loading = false;
        });
    },

    editBooking(booking) {
      const toLocalInput = (dt) => {
        if (!dt) return '';
        const d = new Date(dt);
        // Correctly formats for <input type="datetime-local">
        return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      };
      this.editForm = {
        id: booking.id,
        start_time: toLocalInput(booking.start_time),
        durationHours: this.durationInHours(booking.start_time, booking.end_time),
        lot_name: booking.lot_name,
        slot_number: booking.slot_number,
      };
      this.error = '';
      this.success = '';
    },
    cancelEdit() {
      this.editForm = null;
    },
    submitEdit() {
      if (!this.editForm) return;
      
      const startISO = new Date(this.editForm.start_time).toISOString();
      this.loading = true;

      fetch(`/api/reservations/${this.editForm.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          // FIX: This now uses the correct header format
          'Authentication-token': this.token
        },
        body: JSON.stringify({ start_datetime: startISO })
      })
        .then(async res => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message);
          return data;
        })
        .then(data => {
          this.success = data.message || "Booking updated!";
          this.editForm = null;
          this.fetchBookings(); // Refresh the list
        })
        .catch(err => { this.error = err.message; })
        .finally(() => { this.loading = false; });
    },

    cancelBooking(booking) {
      if (!confirm('Are you sure you want to cancel this booking?')) return;

      this.loading = true;
      fetch(`/api/reservations/${booking.id}`, {
        method: 'DELETE',
        headers: {
          // FIX: This now uses the correct header format and Content-Type
          'Content-Type': 'application/json',
          'Authentication-token': this.token
        }
      })
        .then(async res => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.message);
          return data;
        })
        .then(data => {
          this.success = data.message || "Booking cancelled.";
          this.fetchBookings(); // Refresh the list
        })
        .catch(err => { this.error = err.message; })
        .finally(() => { this.loading = false; });
    },

    formatDT(dt) {
      if (!dt) return '';
      return new Date(dt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    },
    durationInHours(start, end) {
      if (!start || !end) return 1;
      const s = new Date(start);
      const e = new Date(end);
      return Math.round((e - s) / 3600000) || 1;
    },
    statusClass(status) {
        const classes = {
            'upcoming': 'bg-info text-dark',
            'active': 'bg-success',
            'completed': 'bg-secondary',
            'cancelled': 'bg-danger',
        };
        return classes[status] || 'bg-light text-dark';
    }
  }
}