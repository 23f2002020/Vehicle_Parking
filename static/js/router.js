import { session, isAdmin, isDriver, isPartner, homeFor } from './session.js';

import Landing from './views/landing/Landing.js';
import Login from './views/auth/Login.js';
import Register from './views/auth/Register.js';
import NotFound from './views/NotFound.js';

// Views for each dashboard are loaded lazily - nobody downloads code for a dashboard they can't use.
const UserLayout = () => import('./views/user/UserLayout.js').then(m => m.default);
const AdminLayout = () => import('./views/admin/AdminLayout.js').then(m => m.default);
const PartnerLayout = () => import('./views/partner/PartnerLayout.js').then(m => m.default);
const PartnerLogin = () => import('./views/partner/PartnerLogin.js').then(m => m.default);
const PartnerRegister = () => import('./views/partner/PartnerRegister.js').then(m => m.default);
const u = name => () => import(`./views/user/${name}.js`).then(m => m.default);
const a = name => () => import(`./views/admin/${name}.js`).then(m => m.default);
const p = name => () => import(`./views/partner/${name}.js`).then(m => m.default);

const routes = [
  { path: '/', component: Landing, meta: { title: 'Find it. Book it. Park easy.' } },
  { path: '/login', component: Login, meta: { guest: true, title: 'Sign in' } },
  { path: '/register', component: Register, meta: { guest: true, title: 'Create your account' } },
  { path: '/partner/login', component: PartnerLogin, meta: { guest: true, title: 'Partner sign in' } },
  { path: '/partner/register', component: PartnerRegister, meta: { guest: true, title: 'Become a driver partner' } },

  {
    path: '/app', component: UserLayout, meta: { role: 'user' },
    children: [
      { path: '', component: u('UserHome'), meta: { title: 'Home' } },
      { path: 'find', component: u('FindParking'), meta: { title: 'Find parking' } },
      { path: 'book/:lotId(\\d+)', component: u('BookingWizard'), meta: { title: 'Book a slot' } },
      { path: 'bookings', component: u('MyBookings'), meta: { title: 'My bookings' } },
      { path: 'bookings/:id(\\d+)', component: u('BookingDetail'), meta: { title: 'Booking' } },
      { path: 'payments', component: u('Payments'), meta: { title: 'Payments' } },
      { path: 'plans', component: u('Plans'), meta: { title: 'Plans' } },
      // "Book a Ride" / "Request Valet" / "My Rides" / "My Valet Requests" - the minimal additions
      // for the driver-partner domain, wired to /api/rides and /api/valet (resources/mobility.py).
      { path: 'mobility', component: u('Mobility'), meta: { title: 'Rides & valet' } },
      { path: 'mobility/:kind(ride|valet)/new', component: u('RequestMobility'), meta: { title: 'New request' } },
      { path: 'mobility/:kind(ride|valet)/:id(\\d+)', component: u('MobilityDetail'), meta: { title: 'Ride / valet' } },
      { path: 'profile', component: u('Profile'), meta: { title: 'Profile' } },
    ],
  },
  {
    path: '/admin', component: AdminLayout, meta: { role: 'admin' },
    children: [
      { path: '', component: a('AdminOverview'), meta: { title: 'Overview' } },
      { path: 'reports', component: a('AdminReports'), meta: { title: 'Reports' } },
      { path: 'lots', component: a('AdminLots'), meta: { title: 'Parking lots' } },
      { path: 'lots/:id(\\d+)/slots', component: a('AdminSlotBoard'), meta: { title: 'Slot board' } },
      { path: 'operations', component: a('AdminOperations'), meta: { title: 'Live operations' } },
      { path: 'users', component: a('AdminUsers'), meta: { title: 'Drivers' } },
      { path: 'transactions', component: a('AdminTransactions'), meta: { title: 'Transactions' } },
      { path: 'plans', component: a('AdminPlans'), meta: { title: 'Plans & billing' } },
      // driver PARTNER (ride captain / valet driver) management - see AdminDrivers.js for why this
      // is named "Driver partners", distinct from the "Drivers" (parking customers) item above.
      { path: 'driver-partners', component: a('AdminDrivers'), meta: { title: 'Driver partners' } },
      { path: 'driver-partners/:id(\\d+)', component: a('AdminDriverDetail'), meta: { title: 'Driver partner' } },
      { path: 'rides-valet', component: a('AdminMobility'), meta: { title: 'Rides & valet jobs' } },
      { path: 'driver-revenue', component: a('AdminDriverRevenue'), meta: { title: 'Driver partner revenue' } },
      { path: 'system', component: a('AdminSystem'), meta: { title: 'System' } },
      { path: 'profile', component: () => import('./views/user/Profile.js').then(m => m.default), meta: { title: 'Profile' } },
    ],
  },
  {
    // driver PARTNER (ride captain / valet driver) dashboard - see PartnerLayout.js for why this
    // is a separate section from '/app' rather than reusing/extending the existing driver UI.
    path: '/partner', component: PartnerLayout, meta: { role: 'driver' },
    children: [
      { path: '', component: p('PartnerHome'), meta: { title: 'Dashboard' } },
      { path: 'jobs', component: p('PartnerJobs'), meta: { title: 'Jobs' } },
      { path: 'jobs/:kind(ride|valet)/:id(\\d+)', component: p('PartnerJobDetail'), meta: { title: 'Job details' } },
      { path: 'vehicle', component: p('PartnerVehicle'), meta: { title: 'My vehicle' } },
      { path: 'kyc', component: p('PartnerKyc'), meta: { title: 'Verification' } },
      { path: 'earnings', component: p('PartnerEarnings'), meta: { title: 'Earnings' } },
      { path: 'ratings', component: p('PartnerRatings'), meta: { title: 'Ratings' } },
      { path: 'notifications', component: p('PartnerNotifications'), meta: { title: 'Notifications' } },
      { path: 'profile', component: p('PartnerProfile'), meta: { title: 'Profile' } },
    ],
  },

  // friendly aliases for old links
  { path: '/dashboard', redirect: () => homeFor() },
  { path: '/MyBookings', redirect: '/app/bookings' },
  { path: '/booking', redirect: '/app/find' },
  { path: '/profile', redirect: () => (isAdmin() ? '/admin/profile' : isPartner() ? '/partner/profile' : '/app/profile') },
  { path: '/subscriptions', redirect: '/app/plans' },
  { path: '/payments', redirect: '/app/payments' },
  { path: '/admin/dashboard', redirect: '/admin' },
  { path: '*', component: NotFound, meta: { title: 'Page not found' } },
];

const router = new VueRouter({
  mode: 'history',
  routes,
  scrollBehavior(to, from, saved) { return saved || { x: 0, y: 0 }; },
});

router.beforeEach((to, from, next) => {
  const role = to.matched.map(r => r.meta.role).find(Boolean);
  if (role) {
    if (!session.token || !session.user) {
      const loginPath = role === 'driver' ? '/partner/login' : '/login';
      const query = role === 'driver' ? { next: to.fullPath } : { next: to.fullPath, as: role };
      return next({ path: loginPath, query });
    }
    if (role === 'admin' && !isAdmin()) return next(homeFor());
    if (role === 'user' && !isDriver()) return next(homeFor());
    if (role === 'driver' && !isPartner()) return next(homeFor());
  }
  if (to.matched.some(r => r.meta.guest) && session.token && session.user) return next(homeFor());
  next();
});

router.afterEach(to => {
  const t = to.meta && to.meta.title;
  document.title = t ? `${t} · VParkEasy` : 'VParkEasy';
});

export default router;
