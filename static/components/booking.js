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
      
      <div class="lot-details">
        <div class="detail-item">
          <i class="bi bi-geo-alt"></i>
          <span>{{ currentLot.address }}</span>
        </div>
        <div class="detail-item">
          <i class="bi bi-clock"></i>
          <span>24/7 Operation</span>
        </div>
        <div class="detail-item">
          <i class="bi bi-car-front"></i>
          <span>₹{{ currentLot.price_per_hour }}/hr</span>
        </div>
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
        <h4>Select Time Slot</h4>
        <div class="time-slots">
          <button 
            v-for="slot in timeSlots" 
            :key="slot.value"
            class="time-slot"
            :class="{ 'active': selectedTimeSlot === slot.value }"
            @click="selectTimeSlot(slot.value)"
          >
            {{ slot.label }}
          </button>
        </div>
      </div>
      
      <div class="action-buttons">
        <button class="btn btn-primary btn-lg" @click="currentStep = 3" :disabled="!selectedDate || !selectedTimeSlot">
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
      
      <div class="floor-selector" v-if="floors.length > 1">
        <button 
          v-for="floor in floors" 
          :key="floor.level"
          class="floor-btn"
          :class="{ 'active': currentFloor === floor.level }"
          @click="currentFloor = floor.level"
        >
          Floor {{ floor.level }}
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
          <div class="parking-row" v-for="(row, rowIndex) in currentFloorSlots" :key="'row-'+rowIndex">
            <div class="row-label">Row {{ String.fromCharCode(65 + rowIndex) }}</div>
            <div class="row-slots">
              <button
                v-for="slot in row.slots"
                :key="slot.slot_id"
                class="parking-slot"
                :class="{
                  'available': slot.status === 'A',
                  'booked': slot.status === 'O',
                  'selected': selectedSlot?.slot_id === slot.slot_id,
                  'pulse': slot.status === 'A' && !selectedSlot
                }"
                @click="selectSlot(slot)"
                :disabled="slot.status !== 'A'"
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
          <span>{{ selectedTimeSlot }}</span>
        </div>
        <div class="summary-item">
          <span>Slot:</span>
          <span>Slot {{ selectedSlot?.slot_number }} (Floor {{ selectedSlot?.floor }})</span>
        </div>
        <div class="summary-item">
          <span>Duration:</span>
          <span>2 hours</span>
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
                <strong>Slot {{ selectedSlot?.slot_number }} (Floor {{ selectedSlot?.floor }})</strong>
              </div>
              <div class="detail-item">
                <span>Date & Time:</span>
                <strong>{{ formattedSelectedDate }} at {{ selectedTimeSlot }}</strong>
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
        name: "Premium Parking Plaza",
        address: "Anna Nagar, Chennai",
        price_per_hour: 100,
        rows: 5,
        columns: 10,
        charging_available: false,
        water_wash_available: false,
        other_services: null,
        available_spots: 336
      },
      currentMonth: today.toLocaleString('default', { month: 'long' }),
      currentYear: today.getFullYear(),
      calendarDays: [],
      selectedDate: null,
      timeSlots: [
        { label: '08:00 AM - 10:00 AM', value: '08:00-10:00' },
        { label: '10:00 AM - 12:00 PM', value: '10:00-12:00' },
        { label: '12:00 PM - 02:00 PM', value: '12:00-14:00' },
        { label: '02:00 PM - 04:00 PM', value: '14:00-16:00' },
        { label: '04:00 PM - 06:00 PM', value: '16:00-18:00' },
        { label: '06:00 PM - 08:00 PM', value: '18:00-20:00' }
      ],
      selectedTimeSlot: null,
      floors: [
        { level: 1, slots: [] },
        { level: 2, slots: [] },
        { level: 3, slots: [] },
        { level: 4, slots: [] },
        { level: 5, slots: [] },
        { level: 6, slots: [] }
      ],
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
      bookingId: null
    };
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
    currentFloorSlots() {
      // Organize slots by row for the current floor
      const floorSlots = this.floors.find(f => f.level === this.currentFloor)?.slots || [];
      const rows = {};
      
      floorSlots.forEach(slot => {
        const rowLetter = slot.row || 'A'; // Default to row A if not specified
        if (!rows[rowLetter]) {
          rows[rowLetter] = { slots: [] };
        }
        rows[rowLetter].slots.push(slot);
      });
      
      // Convert to array and sort
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

  methods: {
    generateCalendarDays() {
      const year = this.currentYear;
      const month = new Date(`${this.currentMonth} 1, ${year}`).getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const firstDay = new Date(year, month, 1).getDay();
      
      const today = new Date();
      const days = [];
      
      // Previous month days
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
        const isToday = date.toDateString() === today.toDateString();
        const isSelected = this.selectedDate && date.toDateString() === this.selectedDate.toDateString();
        
        days.push({
          day: i,
          date: date,
          disabled: date < today,
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
      this.generateCalendarDays();
    },
    
    selectTimeSlot(slot) {
      this.selectedTimeSlot = slot;
    },
    
    fetchParkingLayout() {
      // Simulate API call with generated data
      setTimeout(() => {
        this.floors.forEach(floor => {
          floor.slots = this.generateSlotsForFloor(floor.level);
        });
      }, 300);
    },
    
    generateSlotsForFloor(floor) {
      const slots = [];
      const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
      const slotsPerRow = 8;
      
      rows.forEach((row, rowIndex) => {
        for (let i = 1; i <= slotsPerRow; i++) {
          const slotNumber = rowIndex * slotsPerRow + i;
          slots.push({
            slot_id: `F${floor}-${row}-${i}`,
            slot_number: slotNumber,
            floor: floor,
            row: row,
            status: Math.random() > 0.3 ? 'A' : 'O' // 70% available, 30% occupied
          });
        }
      });
      
      return slots;
    },
    
    selectSlot(slot) {
      if (this.selectedSlot?.slot_id === slot.slot_id) {
        this.selectedSlot = null;
      } else {
        this.selectedSlot = slot;
        // Add visual feedback
        const slotElement = document.querySelector(`.parking-slot[data-id="${slot.slot_id}"]`);
        if (slotElement) {
          slotElement.classList.add('select-animation');
          setTimeout(() => {
            slotElement.classList.remove('select-animation');
          }, 500);
        }
      }
    },
    
    proceedToPayment() {
      if (this.selectedSlot) {
        this.currentStep = 4;
      }
    },
    
    calculateTotal() {
      const basePrice = this.currentLot.price_per_hour * 2; // 2 hours
      let valetPrice = 0;
      
      if (this.valet === 'oneway') valetPrice = 50;
      if (this.valet === 'both') valetPrice = 80;
      
      return basePrice + valetPrice;
    },
    
    confirmBooking() {
      if (!this.isPaymentValid) return;
      
      this.bookingInProgress = true;
      
      // Simulate API call
      setTimeout(() => {
        this.bookingId = 'BK-' + Math.floor(Math.random() * 1000000);
        const modal = new bootstrap.Modal(document.getElementById('bookingConfirmationModal'));
        modal.show();
        this.bookingInProgress = false;
      }, 1500);
    },
    
    resetBooking() {
      this.currentStep = 1;
      this.selectedDate = null;
      this.selectedTimeSlot = null;
      this.selectedSlot = null;
      this.vehicleNumber = '';
      this.valet = 'none';
      this.paymentMode = 'offline';
      this.cardNumber = '';
      this.cardExpiry = '';
      this.cardCvv = '';
      this.cardName = '';
      this.bookingId = null;
    }
  },

  mounted() {
    this.generateCalendarDays();
    this.fetchParkingLayout();
    
    // Initialize modal
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
      new bootstrap.Modal(document.getElementById('bookingConfirmationModal'));
    }
  }
};


