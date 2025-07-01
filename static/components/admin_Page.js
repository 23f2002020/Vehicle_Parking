// Admin Dashboard Vue Component
export default {
  template: `
  <div class="container mt-4">
    <!-- Header with actions and search -->
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3">
      <div class="d-flex align-items-center gap-3">
        <h2 class="mb-0">Admin Dashboard</h2>
        <input type="text" class="form-control" placeholder="Search parking lots..." style="width: 250px;" v-model="search">
      </div>
      <div class="mt-2 mt-sm-0">
        <button class="btn btn-success" data-bs-toggle="modal" data-bs-target="#createLotModal">+ Create Parking Lot</button>
        <router-link to="/subscriptions" class="btn btn-warning ms-2">Subscribe</router-link>
        <button class="btn btn-outline-primary ms-2" @click="toggleCharts">
          {{ showCharts ? 'Hide Charts' : 'View Charts' }}
        </button>
        <button class="btn btn-outline-info ms-2" @click="showProfileModal = true">My Profile</button>
        <button class="btn btn-outline-danger ms-2" @click="logout">Logout</button>
      </div>
    </div>

    <!-- Summary Stats -->
    <div class="row mb-4">
      <div class="col-md-4" v-for="(val, key) in stats" :key="key">
        <div class="card shadow-sm border-start border-4" :class="cardColors[key]">
          <div class="card-body">
            <h6 class="text-muted text-uppercase">{{ key.replace(/([A-Z])/g, ' $1') }}</h6>
            <h4 class="fw-bold">{{ key === 'todayRevenue' ? '₹' + val : val }}</h4>
          </div>
        </div>
      </div>
    </div>

    <!-- Parking Lot Table -->
    <div v-if="filteredLots.length" class="table-responsive mb-4">
      <table class="table table-bordered">
        <thead class="table-light">
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Spots</th>
            <th>Available</th>
            <th>Price/hr</th>
            <th>Supervisor</th>
            <th>Image</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lot in filteredLots" :key="lot.id">
            <td>{{ lot.name }}</td>
            <td>{{ lot.address }}</td>
            <td>{{ lot.rows * lot.columns * lot.floors }}</td>
            <td>{{ lot.available_spots }}</td>
            <td>₹{{ lot.price_per_hour }}</td>
            <td>{{ lot.supervisor_name }}</td>
            <td>
              <img :src="lot.image_url || '/static/default-lot.png'" alt="Lot Image" style="width: 80px; height: auto;" />
            </td>
            <td>
              <button class="btn btn-sm btn-primary me-1" @click="editLot(lot)">Edit</button>
              <button class="btn btn-sm btn-danger" @click="deleteLot(lot.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="text-muted text-center">No parking lots found.</div>

    <!-- Create Lot Modal -->
    <div class="modal fade" id="createLotModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">{{ isEditMode ? 'Edit Parking Lot' : 'Create Parking Lot' }}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="form-floating mb-2">
              <input v-model="form.name" type="text" class="form-control" id="lotName" placeholder="Lot Name">
              <label for="lotName">Lot Name</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model="form.address" type="text" class="form-control" id="lotAddress" placeholder="Address">
              <label for="lotAddress">Address</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model="form.pin_code" type="text" class="form-control" id="lotPin" placeholder="Pincode">
              <label for="lotPin">Pin Code</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model="form.supervisor" class="form-control mb-2" id="supervisor" placeholder="Supervisor Name" required />
              <label for="supervisor">Supervisor Name</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model.number="form.rows" type="number" class="form-control" id="lotRows" placeholder="Rows">
              <label for="lotRows">Rows</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model.number="form.columns" type="number" class="form-control" id="lotCols" placeholder="Columns">
              <label for="lotCols">Columns</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model.number="form.floors" type="number" class="form-control" id="lotFloors" placeholder="Floors">
              <label for="lotFloors">Floors</label>
            </div>
            <div class="mb-2">
              <label class="form-label">Upload Image</label>
              <input type="file" class="form-control" @change="handleImageUpload">
            </div>
            <div class="form-floating mb-2">
              <input v-model.number="form.price_per_hour" type="number" class="form-control" id="lotPrice" placeholder="Price per hour ₹">
              <label for="lotPrice">Price per Hour (₹)</label>
            </div>
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" id="chargingAvailable" v-model="form.charging_available">
              <label class="form-check-label" for="chargingAvailable">Charging Station Available</label>
            </div>
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" id="waterWashAvailable" v-model="form.water_wash_available">
              <label class="form-check-label" for="waterWashAvailable">Water Wash Available</label>
            </div>
            <div class="form-floating mb-2">
              <textarea v-model="form.other_services" class="form-control" id="otherServices" placeholder="Other Services" style="height: 80px"></textarea>
              <label for="otherServices">Other Services (optional)</label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button class="btn btn-primary" @click="submitForm">{{ isEditMode ? 'Update' : 'Create' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Chart and Stats Summary -->
    <div v-if="showCharts" class="mt-5">
      <div class="row">
        <div class="col-md-6 mb-4">
          <h6 class="text-muted">Earnings Overview</h6>
          <canvas id="revenueChart"></canvas>
        </div>
        <div class="col-md-6 mb-4">
          <h6 class="text-muted">Customer Feedback</h6>
          <canvas id="feedbackChart"></canvas>
        </div>
        <div class="col-md-6 mb-4">
          <h6 class="text-muted">Most Booked Slots</h6>
          <canvas id="demandChart"></canvas>
        </div>
        <div class="col-md-6 mb-4">
          <h6 class="text-muted">Service Usage</h6>
          <canvas id="servicesChart"></canvas>
        </div>
        <div class="col-md-12 mb-4">
          <h6 class="text-muted">Monthly Earnings (Year-wise)</h6>
          <canvas id="yearEarningsChart"></canvas>
        </div>
      </div>
    </div>
  </div>

  `,

data() {
  return {
    showCharts: false,
    search: '',
    stats: {
      totalLots: 0,
      availableSpots: 0,
      todayRevenue: 0
    },
    adminLots: [],
    cardColors: {
      totalLots: 'border-primary',
      availableSpots: 'border-success',
      todayRevenue: 'border-info'
    },
    showProfileModal: false,
    profile: {
      username: '',
      email: '',
      password: ''
    },
    isEditMode: false,
    currentLotId: null,
    form: {
      name: '',
      address: '',
      pin_code: '',
      supervisor: '',
      rows: 1,
      columns: 1,
      floors: 1,
      price_per_hour: 100,
      charging_available: false,
      water_wash_available: false,
      other_services: '',
      image: null
    }
  };
},

computed: {
  filteredLots() {
    return this.adminLots.filter(lot =>
      lot.name.toLowerCase().includes(this.search.toLowerCase()) ||
      lot.address.toLowerCase().includes(this.search.toLowerCase())
    );
  }
},

methods: {
  fetchAdminLots() {
    fetch('/api/parking_lot', {
      headers: { 'Authentication-token': localStorage.getItem('auth_token') }
    })
      .then(res => res.json())
      .then(data => {
        this.adminLots = data;
        this.stats.totalLots = data.length;
        this.stats.availableSpots = data.reduce((acc, lot) => acc + (lot.available_spots || 0), 0);
;
      });
  },

  handleImageUpload(event) {
    this.form.image = event.target.files[0];
  },

  submitForm() {
    const lotData = { ...this.form };
    lotData.supervisor_name = lotData.supervisor;
    lotData.number_of_spots = lotData.rows * lotData.columns * lotData.floors;

    const url = this.isEditMode
      ? `/api/parking_lot?lot_id=${this.currentLotId}`
      : '/api/parking_lot';
    const method = this.isEditMode ? 'PUT' : 'POST';

    fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authentication-token': localStorage.getItem('auth_token')
      },
      body: JSON.stringify(lotData)
    })
      .then(res => res.json())
      .then(data => {
        if (data.message.includes("successfully")) {
          if (this.form.image) {
            const formData = new FormData();
            formData.append("file", this.form.image);
            fetch(`/api/parking_lot/upload_image/${this.currentLotId || data.lot_id}`, {
              method: "POST",
              headers: { 'Authentication-token': localStorage.getItem('auth_token') },
              body: formData
            });
          }
          this.fetchAdminLots();
          this.resetForm();
          bootstrap.Modal.getInstance(document.getElementById('createLotModal')).hide();
        } else {
          alert(data.message);
        }
      });
  },

  resetForm() {
    this.form = {
      name: '',
      address: '',
      pin_code: '',
      supervisor: '',
      rows: 1,
      columns: 1,
      floors: 1,
      price_per_hour: 100,
      charging_available: false,
      water_wash_available: false,
      other_services: '',
      image: null
    };
    this.isEditMode = false;
    this.currentLotId = null;
  },

  editLot(lot) {
    this.form = {
      ...lot,
      supervisor: lot.supervisor_name
    };
    this.isEditMode = true;
    this.currentLotId = lot.id;
    const modal = new bootstrap.Modal(document.getElementById('createLotModal'));
    modal.show();
  },

  deleteLot(id) {
    if (!confirm("Are you sure you want to delete this lot?")) return;
    fetch(`/api/parking_lot?id=${id}`, {
      method: 'DELETE',
      headers: { 'Authentication-token': localStorage.getItem('auth_token') }
    })
      .then(res => res.json())
      .then(data => {
        this.fetchAdminLots();
        alert(data.message);
      });
  },

  logout() {
    fetch('/api/logout', {
      method: 'POST',
      headers: { 'Authentication-token': localStorage.getItem('auth_token') }
    }).finally(() => {
      localStorage.clear();
      this.$router.push('/login');
    });
  },

  toggleCharts() {
    this.showCharts = !this.showCharts;
    if (this.showCharts) {
      this.$nextTick(this.renderCharts);
    }
  },

  renderCharts() {
    const revenueCtx = document.getElementById('revenueChart');
    const feedbackCtx = document.getElementById('feedbackChart');
    const demandCtx = document.getElementById('demandChart');
    const servicesCtx = document.getElementById('servicesChart');
    const yearlyCtx = document.getElementById('yearEarningsChart');

    // Revenue Chart (Dummy)
    new Chart(revenueCtx, {
      type: 'line',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [{
          label: 'Revenue (₹)',
          data: [300, 500, 700, 600, 400, 800, 1000],
          borderColor: 'rgba(75, 192, 192, 1)',
          fill: false
        }]
      }
    });

    // Feedback Chart
    new Chart(feedbackCtx, {
      type: 'bar',
      data: {
        labels: ['Happy', 'Neutral', 'Unhappy'],
        datasets: [{
          label: 'Feedback Count',
          data: [30, 10, 5],
          backgroundColor: ['#28a745', '#ffc107', '#dc3545']
        }]
      }
    });

    // Demand Chart
    new Chart(demandCtx, {
      type: 'doughnut',
      data: {
        labels: ['Slot 1', 'Slot 2', 'Slot 3', 'Slot 4'],
        datasets: [{
          data: [10, 25, 40, 30],
          backgroundColor: ['#007bff', '#6610f2', '#17a2b8', '#ffc107']
        }]
      }
    });

    // Services Chart
    new Chart(servicesCtx, {
      type: 'polarArea',
      data: {
        labels: ['Charging', 'Water Wash', 'Other'],
        datasets: [{
          data: [12, 19, 8],
          backgroundColor: ['#0dcaf0', '#20c997', '#ffc107']
        }]
      }
    });

    // Yearly Earnings
    new Chart(yearlyCtx, {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [{
          label: 'Monthly Revenue (₹)',
          data: [5000, 7000, 8000, 6500, 9000, 7500],
          backgroundColor: '#198754'
        }]
      }
    });
  },

  fetchProfile() {
    fetch('/api/user/profile', {
      headers: { 'Authentication-token': localStorage.getItem('auth_token') }
    })
      .then(res => res.json())
      .then(data => {
        this.profile.email = data.email;
        this.profile.username = data.username;
      });
  },

  updateProfile() {
    fetch('/api/user/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authentication-token': localStorage.getItem('auth_token')
      },
      body: JSON.stringify(this.profile)
    })
      .then(res => res.json())
      .then(() => {
        this.showProfileModal = false;
      });
  },

  fetchStats() {
    // Optional: Replace with actual backend API call
    this.stats.todayRevenue = 1875; // Dummy value for now
  }
},

mounted() {
  this.fetchAdminLots();
  this.fetchStats();
  this.fetchProfile();
}

}
