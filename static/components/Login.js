
export default{
    template:`
    <div class="login-page position-relative min-vh-100">
    <!-- Background image with blur -->
    <div class="background-container">
      <img src="/static/Image1.png" class="background-image" alt="Login Background" />
    </div>

    <div class="container d-flex justify-content-center align-items-center vh-100">
      <div class="glass-box p-4 rounded-4 shadow-lg">
        <h3 class="text-center mb-4 text-black">VParkEasy Login</h3>
        <p class="text-danger text-center">{{ message }}</p>
        
        <form @submit.prevent="login">
          <div class="mb-3">
            <label for="email" class="form-label">Email</label>
            <input type="email" class="form-control" id="email" v-model="FormData.email" required>
          </div>
          <div class="mb-3">
            <label for="password" class="form-label">Password</label>
            <input type="password" class="form-control" id="password" v-model="FormData.password" required>
          </div>
          <div class="d-grid mb-3">
            <button class="btn btn-light btn-glass" type="submit">Login</button>
          </div>
        </form>

        <div class="text-center">
          <router-link to="/register" class="text-blue">New user? Register</router-link> |
          <router-link to="/forgot" class="text-blue-50">Forgot Password?</router-link>
        </div>
      </div>
    </div>
  </div>
    `,
    data:function(){
        return{
            FormData:{
                email:'',
                password:''

            },
            message:''
        }
    },
    methods:{
        
        login: function () {
  fetch('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(this.FormData)
  })
  .then(async response => {
    const data = await response.json();
    console.log(data);
    if (response.ok) {
      localStorage.setItem("auth_token", data.user["auth_token"]);

      const roles = data.user.roles || [];
      if (roles.includes("admin")) {
        this.$router.push('/admin/dashboard');
      } else {
        this.$router.push('/dashboard');
      }

    } else {
      const rawMessage = data.message || "Login failed";
      this.message = this.formatMessage(rawMessage);
    }
  })
  .catch(error => {
    this.message = this.formatMessage("An error occurred: " + error.message);
  });
},
logoutOnClose: function () {
            const token = localStorage.getItem('auth_token');
            if (token) {
                navigator.sendBeacon('/api/logout', JSON.stringify({ auth_token: token }));
                localStorage.removeItem('auth_token');
            }
        },
formatMessage(message) {
    if (!message) return '';
    
    // Capitalize first letter of each word
    let formatted = message
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    // Add exclamation if not already there
    if (!formatted.endsWith('!')) {
        formatted += '!';
    }

    return formatted;
}
    },
    mounted() {
        window.addEventListener('beforeunload', this.logoutOnClose);
    },
    beforeDestroy() {
        window.removeEventListener('beforeunload', this.logoutOnClose);
    }
}

