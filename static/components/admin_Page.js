
export default {
  template: `
  <div class="container mt-4">
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3">
      <div class="d-flex align-items-center gap-3">
        <h2 class="mb-0">Admin Dashboard</h2>
        <input type="text" class="form-control" placeholder="Search parking lots..." style="width: 250px;" v-model="search">
      </div>
      <div class="mt-2 mt-sm-0">
        <button class="btn btn-success" data-bs-toggle="modal" data-bs-target="#createLotModal" @click="resetForm">+ Create Parking Lot</button>
        <button class="btn btn-warning ms-2" @click="toggleAdminSubs">Subscribe</button>
        <button class="btn btn-outline-primary ms-2" @click="toggleCharts">
          {{ showCharts ? 'Hide Charts' : 'View Charts' }}
        </button>
      
        <router-link to="/profile" class="btn btn-outline-info ms-2">My Profile</router-link>
        <button class="btn btn-outline-danger ms-2" @click="logout">Logout</button>
      </div>
    </div>

    <div v-if="showAdminSubs" class="mb-4 px-3 pb-2">
      <h4 class="mb-2">Admin Subscription Plans</h4>
      <div class="row g-3">
        <div v-for="plan in adminPlans" :key="plan.id" class="col-md-4">
          <div class="card h-100 shadow-sm">
            <div class="card-body">
              <h5 class="card-title fw-bold">{{ plan.name }}</h5>
              <div class="mb-1 text-secondary">{{ plan.description }}</div>
              <div class="mb-1">Duration: <b>{{ plan.duration }} days</b></div>
              <div class="mb-1">Price: <span class="fw-semibold text-primary">₹{{ plan.price }}</span></div>
              <div class="mb-1">Free Parkings: {{ plan.free_parkings }}</div>
              <div class="mb-1">Free Washes: {{ plan.free_washes }}</div>
            </div>
            <div class="card-footer text-end bg-transparent border-0 pt-2">
              <template v-if="adminSubscribedPlanId === plan.id">
                <span class="badge bg-success">Active</span>
              </template>
              <button v-else class="btn btn-outline-warning btn-sm" @click="buyAdminPlan(plan)">
                Subscribe
              </button>
            </div>
          </div>
        </div>
        <div v-if="adminPlans.length===0" class="text-muted px-2">No admin plans available.</div>
      </div>
    </div>

    <div class="row mb-4">
      <div class="col-md-4" v-for="(val, key) in stats" :key="key">
        <div class="card shadow-sm border-start border-4" :class="cardColors[key]">
          <div class="card-body">
            <h6 class="text-muted text-uppercase">{{ formatStatsKey(key) }}</h6>
            <h4 class="fw-bold">{{ key === 'todayRevenue' ? '₹' + val : val }}</h4>
          </div>
        </div>
      </div>
    </div>

    <div v-if="filteredLots.length" class="table-responsive mb-4">
      <table class="table table-bordered">
        <thead class="table-light">
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Available</th>
            <th>Price/hr</th>
            <th>Supervisor</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lot in filteredLots" :key="lot.id">
            <td>{{ lot.name }}</td>
            <td>{{ lot.address }}</td>
            <td>{{ lot.available_spots }}</td>
            <td>₹{{ lot.price_per_hour }}</td>
            <td>{{ lot.supervisor_name }}</td>
            <td>
              <button class="btn btn-sm btn-primary me-1" @click="openEditLot(lot)">Edit</button>
              <button class="btn btn-sm btn-danger" @click="deleteLot(lot.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="text-muted text-center">No parking lots found.</div>

    <div class="modal fade" id="createLotModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog">
        <form class="modal-content" @submit.prevent="submitForm">
          <div class="modal-header">
            <h5 class="modal-title">{{ isEditMode ? 'Edit Parking Lot' : 'Create Parking Lot' }}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="form-floating mb-2">
              <input v-model="form.name" type="text" class="form-control" id="lotName" placeholder="Lot Name" required>
              <label for="lotName">Lot Name</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model="form.address" type="text" class="form-control" id="lotAddress" placeholder="Address" required>
              <label for="lotAddress">Address</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model="form.pin_code" type="text" class="form-control" id="lotPin" placeholder="Pincode" required>
              <label for="lotPin">Pin Code</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model="form.supervisor_name" type="text" class="form-control" id="supervisor" placeholder="Supervisor Name" required />
              <label for="supervisor">Supervisor Name</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model.number="form.rows" type="number" class="form-control" id="lotRows" placeholder="Rows" min="1" required>
              <label for="lotRows">Rows</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model.number="form.columns" type="number" class="form-control" id="lotCols" placeholder="Columns" min="1" required>
              <label for="lotCols">Columns</label>
            </div>
            <div class="form-floating mb-2">
              <input v-model.number="form.floors" type="number" class="form-control" id="lotFloors" placeholder="Floors" min="1" required>
              <label for="lotFloors">Floors</label>
            </div>
            <div class="mb-2">
              <label class="form-label">Upload Image</label>
              <input type="file" class="form-control" @change="handleImageUpload">
            </div>
            <div class="form-floating mb-2">
              <input v-model.number="form.price_per_hour" type="number" class="form-control" id="lotPrice" placeholder="Price per hour ₹" min="0" required>
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
            <button class="btn btn-primary" type="submit">{{ isEditMode ? 'Update' : 'Create' }}</button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="showCharts" class="mt-5">
      <div class="row g-4">
        <div class="col-md-6">
          <div class="card shadow-sm p-3">
            <h6 class="text-muted">Earnings Overview</h6>
            <canvas id="revenueChart"></canvas>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card shadow-sm p-3">
            <h6 class="text-muted">Customer Feedback</h6>
            <canvas id="feedbackChart"></canvas>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card shadow-sm p-3">
            <h6 class="text-muted">Most Booked Slots</h6>
            <canvas id="demandChart"></canvas>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card shadow-sm p-3">
            <h6 class="text-muted">Service Usage</h6>
            <canvas id="servicesChart"></canvas>
          </div>
        </div>
        <div class="col-md-12">
          <div class="card shadow-sm p-3">
            <h6 class="text-muted">Monthly Earnings (Year-wise)</h6>
            <canvas id="yearEarningsChart"></canvas>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,

  data() {
    return {
      showCharts: false,
      showAdminSubs: false,
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
      isEditMode: false,
      currentLotId: null,
      form: {
        name: '',
        address: '',
        pin_code: '',
        supervisor_name: '',
        rows: 1,
        columns: 1,
        floors: 1,
        price_per_hour: 100,
        charging_available: false,
        water_wash_available: false,
        other_services: '',
        image: null
      },
      adminPlans: [],
      adminSubscribedPlanId: null
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

  created() {
    const headers = { 
      'Authentication-token': localStorage.getItem("auth_token"),
      'Content-Type': 'application/json' 
    };

    fetch("/api/subscriptions", { headers }).then(r => r.json()).then(plans => {
      this.adminPlans = plans.filter(p => p.plan_type === 'admin');
    });

    // FIX: Correctly find the active subscription's plan ID from the nested object
    fetch("/api/user/subscriptions", { headers })
      .then(r => r.json())
      .then(subs => {
        const activeSub = subs.find(sub => sub.is_active);
        this.adminSubscribedPlanId = activeSub ? activeSub.plan.id : null;
    });
  },

  methods: {
    toggleAdminSubs() {
      this.showAdminSubs = !this.showAdminSubs;
    },

    buyAdminPlan(plan) {
      // FIX: Corrected auth header
      fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Authentication-token': localStorage.getItem("auth_token"),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          plan_id: plan.id,
          payment_method: "offline",
          amount: plan.price,
          payment_type: "subscription" // Good practice to specify
        })
      })
      .then(res => {
        if (!res.ok) throw new Error("Subscription failed");
        return res.json();
      })
      .then(resp => {
        alert(resp.message);
        this.adminSubscribedPlanId = plan.id;
        this.showAdminSubs = false;
      })
      .catch(err => alert(err.message));
    },

    formatStatsKey(key) {
      return key.replace(/([A-Z])/g, ' $1').replace(/^./, m => m.toUpperCase()).trim();
    },

    fetchAdminLots() {
      fetch('/api/parking_lot', {
        headers: { 'Authentication-token': localStorage.getItem('auth_token') }
      })
        .then(res => res.json())
        .then(data => {
          this.adminLots = data;
          this.stats.totalLots = data.length;
          this.stats.availableSpots = data.reduce((acc, lot) => acc + (lot.available_spots || 0), 0);
        });
    },

    handleImageUpload(event) {
      this.form.image = event.target.files[0];
    },

    submitForm() {
      const lotData = { ...this.form };
      lotData.number_of_spots = lotData.rows * lotData.columns * lotData.floors;

      const url = this.isEditMode
        ? `/api/parking_lot/${this.currentLotId}`
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
          if (data.message && data.message.includes("successfully")) {
            this.fetchAdminLots();
            this.resetForm();
            bootstrap.Modal.getInstance(document.getElementById('createLotModal')).hide();
          } else if (data.message) {
            alert(data.message);
          }
        });
    },

    resetForm() {
      this.form = {
        name: '',
        address: '',
        pin_code: '',
        supervisor_name: '',
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

    openEditLot(lot) {
      // This will now work correctly because the backend sends all fields
      this.form = {
        name: lot.name || '',
        address: lot.address || '',
        pin_code: lot.pin_code || '',
        supervisor_name: lot.supervisor_name || '',
        rows: lot.rows || 1,
        columns: lot.columns || 1,
        floors: lot.floors || 1,
        price_per_hour: lot.price_per_hour || 0,
        charging_available: !!lot.charging_available,
        water_wash_available: !!lot.water_wash_available,
        other_services: lot.other_services || '',
        image: null
      };
      this.isEditMode = true;
      this.currentLotId = lot.id;
      const modal = new bootstrap.Modal(document.getElementById('createLotModal'));
      modal.show();
    },

    deleteLot(id) {
      if (!confirm("Are you sure you want to delete this lot?")) return;
      // FIX: The DELETE request now targets the correct URL structure
      fetch(`/api/parking_lot/${id}`, {
        method: 'DELETE',
        headers: {
          'Authentication-token': localStorage.getItem('auth_token'),
        }
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
      new Chart(document.getElementById('revenueChart'), {
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
      new Chart(document.getElementById('feedbackChart'), {
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
      new Chart(document.getElementById('demandChart'), {
        type: 'doughnut',
        data: {
          labels: ['Slot 1', 'Slot 2', 'Slot 3', 'Slot 4'],
          datasets: [{
            data: [10, 25, 40, 30],
            backgroundColor: ['#007bff', '#6610f2', '#17a2b8', '#ffc107']
          }]
        }
      });
      new Chart(document.getElementById('servicesChart'), {
        type: 'polarArea',
        data: {
          labels: ['Charging', 'Water Wash', 'Other'],
          datasets: [{
            data: [12, 19, 8],
            backgroundColor: ['#0dcaf0', '#20c997', '#ffc107']
          }]
        }
      });
      new Chart(document.getElementById('yearEarningsChart'), {
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
        });
    },

    fetchStats() {
      this.stats.todayRevenue = 1875;
    }
  },

  mounted() {
    this.fetchAdminLots();
    this.fetchStats();
    this.fetchProfile();
  }
}