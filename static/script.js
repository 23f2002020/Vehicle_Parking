import Home from './components/home.js'
import Login from './components/login.js'
import Register from './components/register.js'
import NavBar from './components/Navbar.js'
import Footer from './components/footer.js'
import dashboard from './components/dashboard.js'
import booking from './components/booking.js'
import admin_Page from './components/admin_Page.js'


const routes = [
    {path: '/',component: Home},
    {path: '/login',component: Login},
    {path: '/register',component: Register},
    {path: '/dashboard',component: dashboard},
    {path: '/admin/dashboard',component: admin_Page},
    {path: '/booking', component: booking, name: 'booking'}
]

const router = new VueRouter({
    routes
})

const app = new Vue({
    el: '#app',
    router,
    components: {
        'nav-bar': NavBar,
        'foot': Footer
    },
    template: `<div class="container">
    <nav-bar></nav-bar>
    <router-view></router-view>
    <foot></foot>
    </div>`,
     data: {
        section:"Frontend"
    }

})