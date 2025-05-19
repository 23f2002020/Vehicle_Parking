class config():
    DEBUG = False
    SQLALCHEMY_TRACK_MODIFICATIONS = True

class LocalConfig(config):
    # configuration
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///vehicle_Parking.sqlite3"

    #config for security
    SECRET_KEY = "secret_key"
    SECURITY_PASSWORD_HASH = "bcrypt" # machanism for hashing password
    SECURITY_PASSWORD_SALT = "security_password_salt" #helps hashing a password
    WTF_CSRF_ENABLED = False
    SECURITY_TOKEN_AUTHENTICATION_HEADER = "Authentication-token"
    JWT_SECRET_KEY = "jwt_secret_key"
