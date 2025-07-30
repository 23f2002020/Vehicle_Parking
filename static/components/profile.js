export default {
  template: `
    <div class="container my-4">
      <div class="row justify-content-center">
        <div class="col-md-8">
          <div class="card">
            <div class="card-header">
              <h2 class="mb-0">User Profile</h2>
            </div>
            <div class="card-body">
              <div v-if="loading" class="text-center">
                <div class="spinner-border" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
              </div>
              <form v-else @submit.prevent="updateProfile">
                <div class="mb-3">
                  <label for="username" class="form-label">Username</label>
                  <input type="text" class="form-control" id="username" v-model="profile.username" required>
                </div>
                <div class="mb-3">
                  <label for="email" class="form-label">Email</label>
                  <input type="email" class="form-control" id="email" v-model="profile.email" required>
                </div>
                <div class="mb-3">
                  <label for="phone" class="form-label">Phone</label>
                  <input type="text" class="form-control" id="phone" v-model="profile.phone">
                </div>
                <div class="mb-3" v-if="!isAdmin">
                  <label for="address" class="form-label">Address</label>
                  <input type="text" class="form-control" id="address" v-model="profile.address">
                </div>
                <div class="mb-3" v-if="isAdmin">
                  <label for="age" class="form-label">Age</label>
                  <input type="number" class="form-control" id="age" v-model="profile.age">
                </div>
                <div class="mb-3">
                  <label for="password" class="form-label">New Password (leave blank to keep current)</label>
                  <input type="password" class="form-control" id="password" v-model="profile.password">
                </div>
                <div class="mb-3">
                  <label for="confirmPassword" class="form-label">Confirm New Password</label>
                  <input type="password" class="form-control" id="confirmPassword" v-model="profile.confirmPassword">
                </div>
                <div class="d-flex gap-2">
                  <button type="submit" class="btn btn-primary" :disabled="updating">
                    {{ updating ? 'Updating...' : 'Update Profile' }}
                  </button>
                  <button @click="goToDashboard">Back to Dashboard</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,

  data() {
    return {
      profile: {
        username: '',
        email: '',
        phone: '',
        address: '',
        age: null,
        password: '',
        confirmPassword: ''
      },
      isAdmin: false,
      loading: true,
      updating: false
    };
  },

  methods: {
    async fetchProfile() {
      try {
        const response = await fetch('/api/user/profile', {
          headers: { 'Authentication-token': localStorage.getItem('auth_token') }
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            this.logout();
            return;
          }
          throw new Error('Failed to fetch profile');
        }

        const data = await response.json();
        this.profile.username = data.username;
        this.profile.email = data.email;
        this.profile.phone = data.phone || '';
        this.profile.address = data.address || '';
        this.profile.age = data.age || null;
        this.isAdmin = data.roles.includes('admin');
      } catch (error) {
        console.error("Error fetching profile:", error);
        alert("Failed to load profile. Please try again.");
      } finally {
        this.loading = false;
      }
    },

    async updateProfile() {
      if (this.profile.password && this.profile.password !== this.profile.confirmPassword) {
        alert("Passwords don't match!");
        return;
      }

      this.updating = true;

      const payload = {
        username: this.profile.username,
        email: this.profile.email,
        phone: this.profile.phone
      };

      if (!this.isAdmin) {
        payload.address = this.profile.address;
      } else {
        payload.age = this.profile.age;
      }

      if (this.profile.password) {
        payload.password = this.profile.password;
      }

      try {
        const response = await fetch('/api/user/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authentication-token': localStorage.getItem('auth_token')
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            this.logout();
            return;
          }
          throw new Error('Failed to update profile');
        }

        const data = await response.json();
        alert(data.message || 'Profile updated successfully');
        this.fetchProfile();
        this.profile.password = '';
        this.profile.confirmPassword = '';
      } catch (error) {
        console.error("Error updating profile:", error);
        alert("Failed to update profile. " + (error.message || "Please try again."));
      } finally {
        this.updating = false;
      }
    },

    logout() {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_roles');
      this.$router.push('/login');
    },
    goToDashboard() {
  if (this.isAdmin) {
    this.$router.push("/admin/dashboard");
  } else {
    this.$router.push("/dashboard");
  }
}
  },

  mounted() {
    this.fetchProfile();
  }
};
