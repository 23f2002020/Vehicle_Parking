from flask import current_app as app, jsonify, request, render_template
from flask_security import auth_required, roles_required, roles_accepted, current_user, hash_password,login_user, logout_user, verify_and_update_password
from .database import db
from .models import User, Role, ParkingLot, ParkingSpot, Reservation
from .models import  SubscriptionPlan, UserSubscription, PaymentTransaction
from datetime import datetime, timedelta
from werkzeug.security import check_password_hash, generate_password_hash

@app.route('/',methods = ['GET'])
def home():
    return render_template('index.html')

@app.route('/admin')
@auth_required('token') #authentication
@roles_required('admin') #authorization
def admin():
    return jsonify({
        "message": "Hello Admin! you have successfully logged in"
        })

@app.route('/api/home')
@auth_required('token') #authentication
@roles_accepted('user', 'admin') #authorization

def user_home():
    user=current_user
    return jsonify({
        "message": f"Hello {user.username}! you have successfully logged in",
        "email": user.email,
        "username": user.username,
        "password": user.password
    })

@app.route('/api/login', methods=['POST'])

def custom_login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"message": "Email and password are required"}), 400

    user = app.security.datastore.find_user(email=email)
    if not user:
        return jsonify({"message": "User not found"}), 404

    # ✅ If another user is logged in, log them out
    if current_user.is_authenticated:
        if current_user.id != user.id:
            logout_user()  # Logout previous user
        else:
            return jsonify({"message": "User already logged in"}), 400

    # ✅ Check password
    if not verify_and_update_password(password, user):
        return jsonify({"message": "Incorrect password"}), 401

    login_user(user)
    
    return jsonify({
        "message": "Login successful",
        "user": {
            "auth_token": user.get_auth_token(),
            "username": user.username,
            "email": user.email
        }
    }), 200
    
   

@app.route('/api/register', methods=['POST'])
def create_user():
    credentials = request.get_json()
    if not app.security.datastore.find_user(email =credentials['email']): 
        app.security.datastore.create_user(email = credentials['email'], username= credentials['username'], password = hash_password(credentials['password']), active = True, roles = ['user'])
        db.session.commit()
        return jsonify({
            "message": "User created successfully"
        }), 201
    return jsonify({
            "message": "User already exists!"
        }), 400



@app.route('/api/initiate-payment', methods=['POST'])
@auth_required('token')
def initiate_payment():
    """Mock payment initiation endpoint for demo"""
    data = request.get_json()
    
    # Validate required fields
    if not data or 'plan_id' not in data:
        return jsonify({"message": "Plan ID is required"}), 400
    
    plan = SubscriptionPlan.query.get(data['plan_id'])
    if not plan:
        return jsonify({"message": "Invalid subscription plan"}), 400
    
    # Create a mock payment order
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
    
    # In a real app, you would verify with payment gateway here
    # For demo, we'll just trust the callback
    
    # Extract plan ID from the mock order ID
    plan_id = int(data.get('plan_id', 0))
    plan = SubscriptionPlan.query.get(plan_id)
    if not plan:
        return jsonify({"message": "Plan not found"}), 404
    
    # Create transaction record
    transaction = PaymentTransaction(
        user_id=current_user.id,
        amount=plan.price,
        payment_method="mock",
        status="completed",
        transaction_id=data['payment_id']
    )
    
    # Calculate subscription dates
    start_date = datetime.utcnow()
    end_date = start_date + timedelta(days=plan.duration_days)
    
    # Create subscription
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