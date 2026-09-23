"""VParkEasy - run with:   python app.py      (or)   flask --app app run

The factory lives in Applications/factory.py so the Celery worker can build the very same app.
"""
try:                                    # optional: load variables from a .env file (see .env.example)
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:                     # python-dotenv not installed - environment variables still work
    pass

from Applications.factory import create_app  # noqa: E402

app = create_app()

if __name__ == "__main__":
    import os
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 5000)),
            debug=app.config["DEBUG"], threaded=True)
