export default {
template:`
<div class="booking-container">
    <!-- Step 1: Parking Lot Overview -->
    <div v-if="currentStep === 1" class="lot-overview animate__animated animate__fadeIn">
      <div class="lot-header">
        <h1 class="lot-title">{{ currentLot.name }}</h1>
        <div class="lot-rating">
          <span class="rating-badge">4.5 ★</span>
          <span>(1.2K reviews)</span>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-4 align-items-center lot-details-horizontal">
        <div><i class="bi bi-geo-alt"></i> {{ currentLot.address }}</div>
        <div><i class="bi bi-clock"></i> 24/7 Operation</div>
        <div><i class="bi bi-currency-rupee"></i> {{ currentLot.price_per_hour }}/hr</div>
      </div>



      <div class="action-buttons">
        <button class="btn btn-primary btn-lg" @click="currentStep = 2">
          Select Date & Time
          <i class="bi bi-arrow-right"></i>
        </button>
      </div>

      <div class="lot-features">
        <div class="feature-card">
          <i class="bi bi-shield-check"></i>
          <span>24/7 Security</span>
        </div>
        <div class="feature-card">
          <i class="bi bi-camera-video"></i>
          <span>CCTV Surveillance</span>
        </div>
        <div v-if="currentLot.charging_available" class="feature-card">
          <i class="bi bi-ev-station"></i>
          <span>EV Charging</span>
        </div>
        <div v-if="currentLot.water_wash_available" class="feature-card">
          <i class="bi bi-droplet"></i>
          <span>Car Wash</span>
        </div>
        <div v-if="currentLot.other_services" class="feature-card">
          <i class="bi bi-three-dots"></i>
          <span>{{ currentLot.other_services }}</span>
        </div>
      </div>
    </div>

    <!-- Step 2: Date/Time Selection -->
    <div v-if="currentStep === 2" class="datetime-selection animate__animated animate__fadeIn">
      <div class="step-header">
        <button class="btn btn-back" @click="currentStep = 1">
          <i class="bi bi-arrow-left"></i>
        </button>
        <h2>Select Date & Time</h2>
      </div>

      <div class="calendar-container">
        <div class="calendar-header">
          <button class="btn btn-nav" @click="prevMonth">
            <i class="bi bi-chevron-left"></i>
          </button>
          <h4>{{ currentMonth }} {{ currentYear }}</h4>
          <button class="btn btn-nav" @click="nextMonth">
            <i class="bi bi-chevron-right"></i>
          </button>
        </div>

        <div class="calendar-days">
          <div class="day-header" v-for="day in ['S', 'M', 'T', 'W', 'T', 'F', 'S']" :key="day">
            {{ day }}
          </div>
          <div
            v-for="day in calendarDays"
            :key="day.date"
            class="day-cell"
            :class="{
              'disabled': day.disabled,
              'selected': day.selected,
              'current': day.isToday
            }"
            @click="selectDate(day)"
          >
            {{ day.day }}
            <div class="day-indicator" v-if="day.isToday"></div>
          </div>
        </div>
      </div>

      <div class="time-selection">
        <h4>Select Time Slot ({{ durationHours }} hours)</h4>
        <div class="time-slots">
            <div class="form-group mb-3">
                <label for="durationSelect">Booking Duration:</label>
                <select id="durationSelect" class="form-select" v-model.number="durationHours" @change="fetchAvailableTimeSlots">
                    <option value="1">1 Hour</option>
                    <option value="2">2 Hours</option>
                    <option value="3">3 Hours</option>
                    <option value="4">4 Hours</option>
                    <option value="5">5 Hours</option>
                    <option value="6">6 Hours</option>
                    <option value="7">7 Hours</option>
                    <option value="8">8 Hours</option>
                    <option value="9">9 Hours</option>
                    <option value="10">10 Hours</option>
                    <option value="11">11 Hours</option>
                    <option value="12">12 Hours</option>
                </select>
            </div>
          <button
            v-for="slotWindow in availableTimeWindows"
            :key="slotWindow.start"
            class="time-slot"
            :class="{ 'active': selectedTimeSlotStart === slotWindow.start }"
            @click="selectTimeSlot(slotWindow)"
            :disabled="slotWindow.available_slots_count === 0"
          >
            {{ formatTimeForDisplay(slotWindow.start) }} - {{ formatTimeForDisplay(slotWindow.end) }}
            <span v-if="slotWindow.available_slots_count > 0" class="badge bg-success ms-2">{{ slotWindow.available_slots_count }} available</span>
            <span v-else class="badge bg-danger ms-2">Full</span>
          </button>
          <div v-if="availableTimeWindows.length === 0 && selectedDate" class="text-muted mt-3">
            No slots available for the selected date and duration. Try a different date or duration.
          </div>
        </div>
      </div>

      <div class="action-buttons">
        <button class="btn btn-primary btn-lg" @click="currentStep = 3" :disabled="!selectedDate || !selectedTimeSlotStart">
          Select Parking Slot
          <i class="bi bi-arrow-right"></i>
        </button>
      </div>
    </div>

    <!-- Step 3: Slot Selection with Enhanced Animation -->
    <div v-if="currentStep === 3" class="slot-selection animate__animated animate__fadeIn">
      <div class="step-header">
        <button class="btn btn-back" @click="currentStep = 2">
          <i class="bi bi-arrow-left"></i>
        </button>
        <h2>Select Your Parking Slot</h2>
      </div>

      <div class="floor-selector" v-if="currentLot.floors > 1">
        <button
          v-for="f in parseInt(currentLot.floors)"
          :key="f"
          class="floor-btn"
          :class="{ 'active': currentFloor === f }"
          @click="currentFloor = f"
        >
          Floor {{ f }}
        </button>
      </div>

      <div class="slot-map">
        <div class="slot-legend">
          <div class="legend-item">
            <div class="slot-indicator available pulse"></div>
            <span>Available</span>
          </div>
          <div class="legend-item">
            <div class="slot-indicator selected pulse"></div>
            <span>Selected</span>
          </div>
          <div class="legend-item">
            <div class="slot-indicator booked"></div>
            <span>Booked</span>
          </div>
        </div>

        <div class="parking-layout">
          <div v-if="loadingSlots" class="text-center">Loading slots...</div>
          <div v-else-if="currentFloorSlotsGrouped.length === 0" class="text-center text-muted">No slots found for this floor.</div>
          <div class="parking-row" v-for="(row, rowIndex) in currentFloorSlotsGrouped" :key="'row-'+rowIndex">
            <div class="row-label">Row {{ row.row }}</div>
            <div class="row-slots">
              <button
                v-for="slot in row.slots"
                :key="slot.id"
                class="parking-slot"
                :class="{
                  'available': isSlotAvailableForSelectedTime(slot.id),
                  'booked': !isSlotAvailableForSelectedTime(slot.id),
                  'selected': selectedSlot?.id === slot.id,
                  'pulse': isSlotAvailableForSelectedTime(slot.id) && !selectedSlot
                }"
                @click="selectSlot(slot)"
                :disabled="!isSlotAvailableForSelectedTime(slot.id)"
              >
                {{ slot.slot_number }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="action-buttons">
        <button class="btn btn-primary btn-lg" @click="proceedToPayment" :disabled="!selectedSlot">
          Proceed to Payment
          <i class="bi bi-arrow-right"></i>
        </button>
      </div>

      <div class="footer">
        <p>VParkEasy © 2025 | All rights reserved | Crafted with care by BMS Private Limited</p>
      </div>
    </div>

    <!-- Step 4: Payment & Vehicle Details -->
    <div v-if="currentStep === 4" class="payment-section animate__animated animate__fadeIn">
      <div class="step-header">
        <button class="btn btn-back" @click="currentStep = 3">
          <i class="bi bi-arrow-left"></i>
        </button>
        <h2>Complete Your Booking</h2>
      </div>

      <div class="booking-summary">
        <h4>Booking Summary</h4>
        <div class="summary-item">
          <span>Parking Lot:</span>
          <span>{{ currentLot.name }}</span>
        </div>
        <div class="summary-item">
          <span>Date:</span>
          <span>{{ formattedSelectedDate }}</span>
        </div>
        <div class="summary-item">
          <span>Time:</span>
          <span>{{ formatTimeForDisplay(selectedTimeSlotStart) }} - {{ formatTimeForDisplay(selectedTimeSlotEnd) }}</span>
        </div>
        <div class="summary-item">
          <span>Slot:</span>
          <span>Slot {{ selectedSlot?.slot_number }}</span>
        </div>
        <div class="summary-item">
          <span>Duration:</span>
          <span>{{ durationHours }} hours</span>
        </div>
        <div class="summary-item total">
          <span>Total:</span>
          <span>₹{{ calculateTotal() }}</span>
        </div>
      </div>

      <div class="vehicle-details">
        <h4>Vehicle Details</h4>
        <div class="form-group">
          <label>Vehicle Number</label>
          <input
            type="text"
            class="form-control"
            v-model="vehicleNumber"
            placeholder="e.g. TN01AB1234"
            required
          >
        </div>

        <div class="form-group">
          <label>Valet Service</label>
          <select class="form-control" v-model="valet">
            <option value="none">No Valet Service</option>
            <option value="oneway">One-Way Valet (₹50)</option>
            <option value="both">Both Ways Valet (₹80)</option>
          </select>
        </div>
      </div>

      <div class="payment-options">
        <h4>Payment Method</h4>
        <div class="payment-methods">
          <div
            class="payment-method"
            :class="{ 'active': paymentMode === 'online' }"
            @click="paymentMode = 'online'"
          >
            <i class="bi bi-credit-card"></i>
            <span>Online Payment</span>
          </div>
          <div
            class="payment-method"
            :class="{ 'active': paymentMode === 'offline' }"
            @click="paymentMode = 'offline'"
          >
            <i class="bi bi-cash"></i>
            <span>Pay at Parking</span>
          </div>
        </div>

        <div v-if="paymentMode === 'online'" class="card-details">
          <div class="form-group">
            <label>Card Number</label>
            <input type="text" class="form-control" v-model="cardNumber" placeholder="1234 5678 9012 3456" required>
          </div>
          <div class="row">
            <div class="col-md-6">
              <div class="form-group">
                <label>Expiry Date</label>
                <input type="text" class="form-control" v-model="cardExpiry" placeholder="MM/YY" required>
              </div>
            </div>
            <div class="col-md-6">
              <div class="form-group">
                <label>CVV</label>
                <input type="text" class="form-control" v-model="cardCvv" placeholder="123" required>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label>Cardholder Name</label>
            <input type="text" class="form-control" v-model="cardName" placeholder="John Doe" required>
          </div>
        </div>
      </div>

      <div class="action-buttons">
        <button
          class="btn btn-primary btn-lg"
          @click="confirmBooking"
          :disabled="!isPaymentValid || bookingInProgress"
        >
          {{ bookingInProgress ? 'Processing...' : 'Confirm Booking' }}
        </button>
      </div>
    </div>

    <!-- Booking Confirmation Modal -->
    <div class="modal fade" id="bookingConfirmationModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-body text-center p-4">
            <div class="success-icon">
              <i class="bi bi-check-circle"></i>
            </div>
            <h3 class="mt-3">Booking Confirmed!</h3>
            <p>Your parking slot has been successfully booked.</p>

            <div class="confirmation-details">
              <div class="detail-item">
                <span>Booking ID:</span>
                <strong>{{ bookingId }}</strong>
              </div>
              <div class="detail-item">
                <span>Vehicle:</span>
                <strong>{{ vehicleNumber }}</strong>
              </div>
              <div class="detail-item">
                <span>Slot:</span>
                <strong>Slot {{ selectedSlot?.slot_number }}</strong>
              </div>
              <div class="detail-item">
                <span>Date & Time:</span>
                <strong>{{ formattedSelectedDate }} at {{ formatTimeForDisplay(selectedTimeSlotStart) }}</strong>
              </div>
            </div>

            <button class="btn btn-primary mt-3" data-bs-dismiss="modal" @click="resetBooking">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
`,

  data() {
    const today = new Date();
    return {
      currentStep: 1,
      currentLot: {
        id: null,
        name: "Loading...",
        address: "",
        price_per_hour: 0,
        rows: 0,
        columns: 0,
        floors: 1,
        charging_available: false,
        water_wash_available: false,
        other_services: null,
        available_spots: 0,
        min_gap_minutes: 15
      },
      currentMonth: today.toLocaleString('default', { month: 'long' }),
      currentYear: today.getFullYear(),
      calendarDays: [],
      selectedDate: null,
      durationHours: 1,
      availableTimeWindows: [],
      selectedTimeSlotStart: null,
      selectedTimeSlotEnd: null,
      // This will now be correctly populated
      selectedTimeWindowSlots: [],
      allSlots: [],
      currentFloor: 1,
      selectedSlot: null,
      vehicleNumber: '',
      valet: 'none',
      paymentMode: 'offline',
      cardNumber: '',
      cardExpiry: '',
      cardCvv: '',
      cardName: '',
      bookingInProgress: false,
      bookingId: null,
      loadingSlots: false
    };
  },
  watch: {
    selectedDate: 'fetchAvailableTimeSlots',
    durationHours: 'fetchAvailableTimeSlots'
  },


  computed: {
    formattedSelectedDate() {
      if (!this.selectedDate) return '';
      return this.selectedDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    },
    currentFloorSlotsGrouped() {
      // Filter slots for the current floor
      const floorSlots = this.allSlots.filter(s => {
            const spotsPerFloor = this.currentLot.rows * this.currentLot.columns;
            if (spotsPerFloor === 0) return false;
            const floorLevel = Math.floor((s.slot_number - 1) / spotsPerFloor) + 1;
            return floorLevel === this.currentFloor;
        });


      const rows = {};
      floorSlots.forEach(slot => {
        const spotsPerRow = this.currentLot.columns;
        const rowIndexInFloor = Math.floor(((slot.slot_number - 1) % (this.currentLot.rows * this.currentLot.columns)) / spotsPerRow);
        const rowLetter = String.fromCharCode(65 + rowIndexInFloor);


        if (!rows[rowLetter]) {
          rows[rowLetter] = { row: rowLetter, slots: [] }; // Added row property
        }
        rows[rowLetter].slots.push(slot);
      });


      return Object.keys(rows).sort().map(row => ({
        row,
        slots: rows[row].slots.sort((a, b) => a.slot_number - b.slot_number)
      }));
    },
    isPaymentValid() {
      if (!this.vehicleNumber) return false;
      if (this.paymentMode === 'online') {
        return this.cardNumber && this.cardExpiry && this.cardCvv && this.cardName;
      }
      return true;
    }
  },


  watch: {
    selectedDate: 'fetchAvailableTimeSlots',
    durationHours: 'fetchAvailableTimeSlots' // Watch durationHours as well
  },


  methods: {
    async fetchLotDetails(lotId) {
       this.loading = true;
        try {
            const response = await fetch(`/api/parking_lot/${lotId}`, { headers: { 'Authentication-token': localStorage.getItem('auth_token') } });
            if (response.status === 401) { this.$router.push('/login'); return; }
            if (!response.ok) throw new Error('Could not load lot details');
            this.currentLot = await response.json();
        } catch (error) {
            alert(error.message);
            this.$router.push('/dashboard');
        } finally {
            this.loading = false;
        }
    },


    async fetchAllSlotsForLot() {
        this.loadingSlots = true;
        try {
            const response = await fetch(`/api/lots/${this.currentLot.id}/slots`, { headers: { 'Authentication-token': localStorage.getItem('auth_token') } });
            if (response.status === 401) { this.$router.push('/login'); return; }
            if (!response.ok) throw new Error('Could not load parking slot details');
            this.allSlots = await response.json();
        } catch (error) {
            alert(error.message);
        } finally {
            this.loadingSlots = false;
        }
    },


      async fetchAvailableTimeSlots() {
      if (!this.selectedDate) return;
      this.availableTimeWindows = [];
      this.selectedTimeSlotStart = null;
      this.selectedTimeWindowSlots = [];
      const formattedDate = this.selectedDate.toISOString().split('T')[0];
      try {
        const response = await fetch(`/api/lots/${this.currentLot.id}/availability?date=${formattedDate}&duration=${this.durationHours}`, {
          headers: { 'Authentication-token': localStorage.getItem('auth_token') }
        });
        if (response.status === 401) { this.$router.push('/login'); return; }
        if (!response.ok) throw new Error('Failed to fetch time slots');
        this.availableTimeWindows = await response.json();
      } catch (error) {
        console.error(error);
      }
    },

    // CORRECTED: This method now populates the available physical slots for the chosen time.
    selectTimeSlot(slotWindow) {
      this.selectedTimeSlotStart = slotWindow.start;
      this.selectedTimeSlotEnd = slotWindow.end;
      // This is the crucial fix for the "All Slots Booked" issue.
      this.selectedTimeWindowSlots = slotWindow.available_slots || [];
      // Reset selected physical slot when time changes
      this.selectedSlot = null;
    },

    // This method now works correctly because selectedTimeWindowSlots is populated.
    isSlotAvailableForSelectedTime(slotId) {
      return this.selectedTimeWindowSlots.some(s => s.slot_id === slotId);
    },


    formatTimeForDisplay(isoString) {
      if (!isoString) return '';
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    },


    generateCalendarDays() {
      const year = this.currentYear;
      const month = new Date(`${this.currentMonth} 1, ${year}`).getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const firstDay = new Date(year, month, 1).getDay();


      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize today to start of day for accurate comparison


      const days = [];


      // Previous month days (empty placeholders)
      for (let i = 0; i < firstDay; i++) {
        days.push({
          day: '',
          date: null,
          disabled: true,
          isToday: false,
          selected: false
        });
      }


      // Current month days
      for (let i = 1; i <= daysInMonth; i++) {
        const date = new Date(year, month, i);
        date.setHours(0, 0, 0, 0); // Normalize date to start of day for accurate comparison


        const isToday = date.getTime() === today.getTime();
        const isSelected = this.selectedDate && date.getTime() === this.selectedDate.getTime();


        days.push({
          day: i,
          date: date,
          disabled: date < today, // Disable past days
          isToday: isToday,
          selected: isSelected
        });
      }


      this.calendarDays = days;
    },


    prevMonth() {
      const date = new Date(`${this.currentMonth} 1, ${this.currentYear}`);
      date.setMonth(date.getMonth() - 1);
      this.currentMonth = date.toLocaleString('default', { month: 'long' });
      this.currentYear = date.getFullYear();
      this.generateCalendarDays();
    },


    nextMonth() {
      const date = new Date(`${this.currentMonth} 1, ${this.currentYear}`);
      date.setMonth(date.getMonth() + 1);
      this.currentMonth = date.toLocaleString('default', { month: 'long' });
      this.currentYear = date.getFullYear();
      this.generateCalendarDays();
    },


    selectDate(day) {
      if (day.disabled) return;
      this.selectedDate = day.date;
      this.selectedTimeSlotStart = null; // Clear selected time slot when date changes
      this.selectedTimeSlotEnd = null;
      this.selectedTimeWindowSlots = []; // Clear available slots for time window
      this.selectedSlot = null; // Clear selected physical slot
      this.generateCalendarDays(); // Update calendar to show selection
      this.fetchAvailableTimeSlots(); // Fetch new time slots for the selected date
    },


    fetchParkingLayout() {
      if (this.currentLot.id) {
          this.fetchAllSlotsForLot();
      }
    },

    selectSlot(slot) {
      if (this.isSlotAvailableForSelectedTime(slot.id)) {
          if (this.selectedSlot?.id === slot.id) {
            this.selectedSlot = null;
          } else {
            this.selectedSlot = slot;
          }
      } else {
          alert("This slot is not available for the selected time window.");
      }
    },


    proceedToPayment() {
      if (this.selectedSlot && this.selectedTimeSlotStart && this.selectedTimeSlotEnd && this.selectedDate) {
        this.currentStep = 4;
      } else {
        alert("Please select a date, time slot, and a parking slot to proceed.");
      }
    },


    calculateTotal() {
      if (!this.currentLot.price_per_hour || !this.durationHours) return 0;
      const basePrice = this.currentLot.price_per_hour * this.durationHours;
      let valetPrice = 0;


      if (this.valet === 'oneway') valetPrice = 50;
      if (this.valet === 'both') valetPrice = 80;


      return basePrice + valetPrice;
    },


    async confirmBooking() {
      if (!this.isPaymentValid) {
        alert("Please fill in all required payment and vehicle details.");
        return;
      }

      if (!this.selectedSlot || !this.selectedTimeSlotStart || !this.selectedTimeSlotEnd) {
        alert("Please complete slot and time selection.");
        return;
      }

      const payload = {
        lot_id: this.currentLot.id,
        slot_id: this.selectedSlot.id,
        start_datetime: new Date(this.selectedTimeSlotStart).toISOString(),
        end_datetime: new Date(this.selectedTimeSlotEnd).toISOString(),
        vehicle_number: this.vehicleNumber,
        valet: this.valet,
        payment_method: this.paymentMode
      };

      this.bookingInProgress = true;


      fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Authentication-token': localStorage.getItem('auth_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      // CORRECTED: More robust error handling.
      .then(res => {
        const contentType = res.headers.get("content-type");
        // If the response is not OK (e.g., status 400, 401, 500)
        if (!res.ok) {
          // Check if the server sent a JSON error message
          if (contentType && contentType.indexOf("application/json") !== -1) {
            return res.json().then(errorData => {
              // We have a JSON error, throw its message
              throw new Error(errorData.message || 'An unknown error occurred.');
            });
          } else {
            // The server returned HTML or text, not JSON. Throw a generic error.
            throw new Error(`Server returned an error: ${res.status} ${res.statusText}`);
          }
        }
        // If response is OK, parse it as JSON
        return res.json();
      })
      .then(data => {
        if (data.reservation_id) {
          this.bookingId = data.reservation_id;
          const modal = new bootstrap.Modal(document.getElementById('bookingConfirmationModal'));
          modal.show();
        } else {
          alert(data.message || "Booking failed.");
        }
      })
      .catch(err => {
        console.error("Booking failed:", err);
        // Display the cleaner error message from our new logic
        alert("Something went wrong during booking: " + err.message);
      })
      .finally(() => {
        this.bookingInProgress = false;
      });
    },

    resetBooking() {
      this.currentStep = 1;
      this.selectedDate = null;
      this.selectedTimeSlotStart = null;
      this.selectedTimeSlotEnd = null;
      this.selectedTimeWindowSlots = [];
      this.selectedSlot = null;
      this.vehicleNumber = '';
      this.valet = 'none';
      this.paymentMode = 'offline';
      this.cardNumber = '';
      this.cardExpiry = '';
      this.cardCvv = '';
      this.cardName = '';
      this.bookingId = null;
      this.availableTimeWindows = [];
      this.allSlots = []; 
      const lotId = this.$route.query.lot_id;
      this.fetchLotDetails(lotId);
      this.generateCalendarDays();
      this.fetchParkingLayout();
    },
  },
 isSlotAvailableForSelectedTime(slotId) {
    return this.selectedTimeWindowSlots.some(s => s.id === slotId);
  },


  async mounted() {
    const lotId = this.$route.query.lot_id;
    if (!lotId) {
      alert("No parking lot selected!");
      this.$router.push('/dashboard');
      return;
    }

    await this.fetchLotDetails(lotId);
    this.generateCalendarDays?.();
    this.fetchParkingLayout?.();

    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
      new bootstrap.Modal(document.getElementById('bookingConfirmationModal'));
    }
  }
};