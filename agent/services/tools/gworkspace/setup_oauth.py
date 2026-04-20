import os.path
import sys

# Add project root to sys.path
sys.path.append(os.getcwd())

from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

# If modifying these scopes, delete the file token.json.
SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive",
]

def main():
    """Shows basic usage of the Drive v3 API.
    Prints the names and ids of the first 10 files the user has access to.
    """
    creds = None
    token_path = 'agent/services/tools/gworkspace/token.json'
    creds_path = 'agent/services/tools/gworkspace/credentials.json'

    # The file token.json stores the user's access and refresh tokens, and is
    # created automatically when the authorization flow completes for the first
    # time.
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(creds_path):
                print(f"Error: {creds_path} not found.")
                print("Please follow these steps:")
                print("1. Go to https://console.cloud.google.com/")
                print("2. Create an OAuth 2.0 Client ID for 'Desktop app'.")
                print(f"3. Download the JSON file and save it as {creds_path}")
                return

            flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
            creds = flow.run_local_server(port=0)
        
        # Save the credentials for the next run
        with open(token_path, 'w') as token:
            token.write(creds.to_json())
        
        print(f"Success! token.json has been created at {token_path}")

if __name__ == '__main__':
    main()
