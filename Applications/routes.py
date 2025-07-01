from flask import current_app as app, jsonify, request, render_template
from flask_security import auth_required, roles_required, roles_accepted, current_user, hash_password, login_user, logout_user, verify_and_update_password
from .database import db
from .models import User, Role, ParkingLot, ParkingSpot, Reservation, SubscriptionPlan, UserSubscription, PaymentTransaction, ValetRequest,  AdminSubscription, Admin
from datetime import datetime, timedelta
from werkzeug.security import check_password_hash, generate_password_hash

from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app
from flask_login import login_required, current_user
from .subscriptions import SubscriptionService # Import the service layer

sub_bp = Blueprint('subscriptions', __name__, url_prefix='/subscriptions')

@sub_bp.route('/plans')
def view_plans():
    user_plans = SubscriptionPlan.query.filter_by(plan_type='user', is_active=True).order_by(SubscriptionPlan.price).all()
    admin_plans = SubscriptionPlan.query.filter_by(plan_type='admin', is_active=True).order_by(SubscriptionPlan.price).all()
    return render_template('subscriptions/plans.html', user_plans=user_plans, admin_plans=admin_plans)

@sub_bp.route('/subscribe/<int:plan_id>', methods=['GET', 'POST'])
@login_required # Requires user to be logged in
def subscribe_to_plan(plan_id):
    plan = SubscriptionPlan.query.get_or_404(plan_id)
    if request.method == 'POST':
        # This is where actual payment initiation would happen
        # For dummy transaction, we simulate success
        # Call a service function to handle subscription logic
        success = SubscriptionService.process_subscription(current_user, plan) # Assumes current_user is either User or Admin
        if success:
            flash(f'Successfully subscribed to {plan.name}!', 'success')
            return redirect(url_for('subscriptions.my_subscription'))
        else:
            flash('Subscription failed. Please try again.', 'danger')
    return render_template('subscriptions/subscribe.html', plan=plan)

@sub_bp.route('/my_subscription')
@login_required
def my_subscription():
    # Logic to fetch current user's/admin's subscription details
    if isinstance(current_user._get_current_object(), User): # Check if it's a User
        current_sub = UserSubscription.query.filter_by(user_id=current_user.id, status='active').first()
        free_allowance_info = {
            'allowed': current_user.free_parking_minutes_allowed,
            'used': current_user.free_parking_minutes_used,
            'remaining': current_user.free_parking_minutes_allowed - current_user.free_parking_minutes_used
        }
    elif isinstance(current_user._get_current_object(), Admin): # Check if it's an Admin
        current_sub = AdminSubscription.query.filter_by(admin_id=current_user.id, status='active').first()
        free_allowance_info = {
            'allowed': current_user.free_spots_allowed,
            'used': current_user.free_spots_used,
            'remaining': current_user.free_spots_allowed - current_user.free_spots_used
        }
    else:
        current_sub = None
        free_allowance_info = None

    return render_template('subscriptions/my_subscription.html', current_sub=current_sub, free_allowance_info=free_allowance_info)

# Other routes for managing upgrades, downgrades, cancellations.


# --- Basic Routes ---
routes_bp = Blueprint('routes_bp', __name__)

# --- Basic Routes ---
@routes_bp.route('/', methods=['GET'])
def home():
    return render_template('index.html')

@routes_bp.route('/api/login', methods=['POST'])
def custom_login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"message": "Email and password are required"}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        return jsonify({"message": "User not found"}), 404

    if current_user.is_authenticated:
        logout_user()

    if not verify_and_update_password(password, user):
        return jsonify({"message": "Incorrect password"}), 401

    login_user(user)
    user_roles = [role.name for role in user.roles]

    return jsonify({
        "message": "Login successful",
        "user": {
            "auth_token": user.get_auth_token(),
            "username": user.username,
            "email": user.email,
            "roles": user_roles
        }
    }), 200

@routes_bp.route('/api/register', methods=['POST'])
def create_user():
    credentials = request.get_json()
    if not User.query.filter_by(email=credentials['email']).first():
        user = User(
            email=credentials['email'],
            username=credentials['username'],
            password=hash_password(credentials['password']),
            active=True
        )
        user.roles = [Role.query.filter_by(name='user').first()]
        db.session.add(user)
        db.session.commit()
        return jsonify({"message": "User created successfully"}), 201
    return jsonify({"message": "User already exists!"}), 400

@routes_bp.route('/api/logout', methods=['POST', 'GET'])
@auth_required('token')
def logout():
    logout_user()
    return jsonify({"message": "Logged out successfully"}), 200


# --- User Specific API Routes ---
@app.route('/api/user/profile', methods=['GET'])
@auth_required('token')
@roles_accepted('user')
def get_user_profile():
    """Retrieves the current user's profile information."""
    user = current_user
    return jsonify({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "roles": [role.name for role in user.roles]
    }), 200

@app.route('/api/user/profile', methods=['PUT'])
@auth_required('token')
@roles_accepted('user')
def update_user_profile():
    """Updates the current user's profile information."""
    data = request.get_json()
    user = current_user

    if 'username' in data:
        user.username = data['username']
    if 'email' in data:
        user.email = data['email']
    if 'password' in data and data['password']:
        user.password = generate_password_hash(data['password'])

    db.session.commit()
    return jsonify({"message": "Profile updated successfully"}), 200

@app.route('/api/user/favorite_lots', methods=['GET'])
@auth_required('token')
@roles_accepted('user')
def get_favorite_lots():
    """
    Fetches the user's favorite parking lots.
    (Placeholder: You'll need to implement a 'FavoriteLot' model and relationship in models.py)
    """
    # For now, return an empty list or mock data
    return jsonify({"message": "Favorite lots feature coming soon.", "favorites": []}), 200

@app.route('/api/user/summary_chart_data', methods=['GET'])
@auth_required('token')
@roles_accepted('user')
def get_summary_chart_data():
    """
    Provides data for user summary charts (e.g., parking history, spending).
    (Placeholder: Implement data aggregation logic)
    """
    # For now, return mock data
    return jsonify({"message": "Summary chart data coming soon.", "data": []}), 200

@app.route('/api/user/book_helper', methods=['POST'])
@auth_required('token')
@roles_accepted('user')
def book_helper():
    """Allows user to book a helper (e.g., valet, car wash assistant)."""
    data = request.get_json()
    request_type = data.get('request_type', 'helper')
    vehicle_location = data.get('vehicle_location')
    notes = data.get('notes')
    reservation_id = data.get('reservation_id') # Optional, if linked to a specific parking

    if not vehicle_location:
        return jsonify({"message": "Vehicle location is required to book a helper."}), 400

    # Check if user has an active subscription that allows helper services
    # This might require a new field in SubscriptionPlan or a logic to check if a plan
    # includes 'valet' or 'helper' type services. For now, we'll assume ValetRequest covers it.
    active_sub = UserSubscription.query.filter_by(user_id=current_user.id, is_active=True).first()
    if not active_sub:
        return jsonify({"message": "Active subscription required for helper services."}), 403

    try:
        valet_request = ValetRequest(
            user_id=current_user.id,
            request_type=request_type, # 'helper' or 'driver'
            vehicle_location=vehicle_location,
            notes=notes,
            reservation_id=reservation_id,
            status='pending'
        )
        db.session.add(valet_request)
        db.session.commit()
        return jsonify({"message": "Helper request submitted successfully!", "request_id": valet_request.id}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Error booking helper: {str(e)}"}), 500

@app.route('/api/user/book_driver', methods=['POST'])
@auth_required('token')
@roles_accepted('user')
def book_driver():
    """Allows user to book a driver."""
    data = request.get_json()
    request_type = data.get('request_type', 'driver')
    vehicle_location = data.get('vehicle_location')
    destination = data.get('destination')
    notes = data.get('notes')

    if not vehicle_location or not destination:
        return jsonify({"message": "Vehicle location and destination are required to book a driver."}), 400

    # Check if user has an active subscription that allows driver services
    active_sub = UserSubscription.query.filter_by(user_id=current_user.id, is_active=True).first()
    if not active_sub:
        return jsonify({"message": "Active subscription required for driver services."}), 403

    try:
        valet_request = ValetRequest(
            user_id=current_user.id,
            request_type=request_type, # 'driver'
            vehicle_location=vehicle_location,
            notes=notes,
            status='pending'
            # You might want to add a 'destination' field to ValetRequest or create a new model
        )
        db.session.add(valet_request)
        db.session.commit()
        return jsonify({"message": "Driver request submitted successfully!", "request_id": valet_request.id}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Error booking driver: {str(e)}"}), 500


# --- Admin Specific API Routes ---
@app.route('/api/admin/dashboard', methods=['GET'])
@auth_required('token')
@roles_required('admin')
def admin_dashboard():
    """Provides a general message for authenticated admins."""
    return jsonify({"message": f"Welcome to the Admin Dashboard, {current_user.username}!"}), 200

@app.route('/api/admin/subscription_plans', methods=['POST'])
@auth_required('token')
@roles_required('admin')
def create_subscription_plan():
    """Allows admin to create a new subscription plan."""
    data = request.get_json()
    required_fields = ['name', 'duration_days', 'price', 'free_parkings']
    if not all(field in data for field in required_fields):
        return jsonify({"message": "Missing required fields for subscription plan"}), 400

    try:
        plan = SubscriptionPlan(
            name=data['name'],
            duration_days=data['duration_days'],
            price=data['price'],
            free_parkings=data.get('free_parkings', 0),
            free_washes=data.get('free_washes', 0),
            description=data.get('description', '')
        )
        db.session.add(plan)
        db.session.commit()
        return jsonify({"message": "Subscription plan created successfully", "plan_id": plan.id}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Error creating subscription plan: {str(e)}"}), 500

@app.route('/api/admin/subscription_plans/<int:plan_id>', methods=['PUT'])
@auth_required('token')
@roles_required('admin')
def update_subscription_plan(plan_id):
    """Allows admin to update an existing subscription plan."""
    plan = SubscriptionPlan.query.get(plan_id)
    if not plan:
        return jsonify({"message": "Subscription plan not found"}), 404

    data = request.get_json()
    plan.name = data.get('name', plan.name)
    plan.duration_days = data.get('duration_days', plan.duration_days)
    plan.price = data.get('price', plan.price)
    plan.free_parkings = data.get('free_parkings', plan.free_parkings)
    plan.free_washes = data.get('free_washes', plan.free_washes)
    plan.description = data.get('description', plan.description)

    db.session.commit()
    return jsonify({"message": "Subscription plan updated successfully"}), 200

@app.route('/api/admin/subscription_plans/<int:plan_id>', methods=['DELETE'])
@auth_required('token')
@roles_required('admin')
def delete_subscription_plan(plan_id):
    """Allows admin to delete a subscription plan."""
    plan = SubscriptionPlan.query.get(plan_id)
    if not plan:
        return jsonify({"message": "Subscription plan not found"}), 404

    db.session.delete(plan)
    db.session.commit()
    return jsonify({"message": "Subscription plan deleted successfully"}), 200

# --- Payment Related Routes (already present, ensuring consistency) ---
@app.route('/api/initiate-payment', methods=['POST'])
@auth_required('token')
def initiate_payment():
    """Mock payment initiation endpoint for demo"""
    data = request.get_json()

    if not data or 'plan_id' not in data:
        return jsonify({"message": "Plan ID is required"}), 400

    plan = SubscriptionPlan.query.get(data['plan_id'])
    if not plan:
        return jsonify({"message": "Invalid subscription plan"}), 400

    mock_order = {
        "order_id": f"mock_order_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "amount": plan.price * 100,  # in paise
        "currency": "INR",
        "status": "created",
        "plan_id": plan.id,
        "mock_payment_id": f"mock_py_{datetime.now().strftime('%Y%m%d%H%M%S')}"
    }

    return jsonify(mock_order)

@app.route('/api/mock-payment-callback', methods=['POST'])
@auth_required('token')
def mock_payment_callback():
    """Mock payment verification endpoint for demo"""
    data = request.get_json()

    if not data or 'order_id' not in data or 'payment_id' not in data:
        return jsonify({"message": "Invalid payment data"}), 400

    plan_id = int(data.get('plan_id', 0))
    plan = SubscriptionPlan.query.get(plan_id)
    if not plan:
        return jsonify({"message": "Plan not found"}), 404

    transaction = PaymentTransaction(
        user_id=current_user.id,
        amount=plan.price,
        payment_method="mock",
        status="completed",
        transaction_id=data['payment_id']
    )

    start_date = datetime.utcnow()
    end_date = start_date + timedelta(days=plan.duration_days)

    subscription = UserSubscription(
        user_id=current_user.id,
        plan_id=plan.id,
        start_date=start_date,
        end_date=end_date,
        remaining_parkings=plan.free_parkings,
        remaining_washes=plan.free_washes,
        is_active=True
    )

    db.session.add(transaction)
    db.session.add(subscription)
    db.session.commit()

    return jsonify({
        "message": "Payment successful and subscription activated",
        "transaction_id": transaction.transaction_id,
        "subscription_id": subscription.id,
        "plan_name": plan.name,
        "end_date": end_date.strftime('%Y-%m-%d')
    })

@app.route('/api/verify-payment/<payment_id>', methods=['GET'])
@auth_required('token')
def verify_payment(payment_id):
    """Mock payment verification endpoint for demo"""
    transaction = PaymentTransaction.query.filter_by(
        transaction_id=payment_id,
        user_id=current_user.id
    ).first()

    if not transaction:
        return jsonify({"message": "Transaction not found"}), 404

    subscription = UserSubscription.query.filter_by(
        user_id=current_user.id
    ).order_by(UserSubscription.start_date.desc()).first()

    return jsonify({
        "status": transaction.status,
        "amount": transaction.amount,
        "subscription_active": subscription.is_active if subscription else False,
        "remaining_parkings": subscription.remaining_parkings if subscription else 0
    })
