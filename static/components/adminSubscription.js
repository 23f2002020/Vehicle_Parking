// export default {
//   data() {
//     return {
//       mySubscriptions: [],
//       paymentHistory: [],
//     };
//   },
//   created() {
//     this.fetchMySubscriptions();
//     this.fetchPaymentHistory();
//   },
//   methods: {
//     async fetchMySubscriptions() {
//       const token = localStorage.getItem('token');
//       const resp = await axios.get('/api/user/subscriptions', {
//         headers: { Authorization: `Bearer ${token}` }
//       });
//       // Only subscriptions with admin type:
//       this.mySubscriptions = resp.data.filter(s => s.plan.type === 'admin');
//     },
//     async fetchPaymentHistory() {
//       const token = localStorage.getItem('token');
//       const resp = await axios.get('/api/user/payments', {
//         headers: { Authorization: `Bearer ${token}` }
//       });
//       // Only payments related to subscriptions:
//       this.paymentHistory = resp.data.filter(
//         p => p.type === 'subscription' || p.payment_type === 'subscription'
//       );
//     },
//   },
//   template: `
//     <div>
//       <h2>My Admin Subscriptions</h2>
//       <div v-if="mySubscriptions.length">
//         <table>
//           <thead>
//             <tr><th>Plan</th><th>Start</th><th>End</th><th>Status</th></tr>
//           </thead>
//           <tbody>
//             <tr v-for="sub in mySubscriptions">
//               <td>{{ sub.plan_name }}</td>
//               <td>{{ sub.start_date }}</td>
//               <td>{{ sub.end_date }}</td>
//               <td>{{ sub.is_active ? "Active" : "Inactive" }}</td>
//             </tr>
//           </tbody>
//         </table>
//       </div>
//       <div v-else>
//         <em>No admin subscriptions found.</em>
//       </div>
//       <h3>Payment History</h3>
//       <table>
//         <thead>
//           <tr><th>Date</th><th>Amount (₹)</th><th>Method</th><th>Status</th></tr>
//         </thead>
//         <tbody>
//           <tr v-for="p in paymentHistory">
//             <td>{{ p.timestamp || p.date }}</td>
//             <td>₹{{ p.amount }}</td>
//             <td>{{ p.method || p.payment_method }}</td>
//             <td>{{ p.status }}</td>
//           </tr>
//         </tbody>
//       </table>
//     </div>
//   `
// }
