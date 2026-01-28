# all imports
import os.path
import re
import requests
from ics import Calendar
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import sys
import datetime
import time

# rendering into a log file
# Redirects all print statements to .txt 
#sys.stdout = open(r'C:\DevTools\Projects\exile\sync_log.txt', 'a')
#sys.stderr = sys.stdout

#print(f"\n--- Sync Attempt: {datetime.datetime.now()} ---")


# configuration
CALENDAR_SOURCES = [
    {"name": "eLearning", "url": "--------------------------elearning ics url------------"},
    {"name": "Teams", "url": "--------------------------teams ics url---------------------"},
]

# target timezone
TIMEZONE = 'America/Chicago'

# course code regex pattern
COURSE_REGEX = r'\b(CS|MATH|PHYS|FILM|GOVT|HIST|BIOL|CHEM|CE|SE)\s?-?(\d{4})\b'

# scopes reqd by google calendar api
SCOPES = ['https://www.googleapis.com/auth/calendar']

def get_google_service():

    """ auths with google and return the service obj """

    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
    return build('calendar', 'v3', credentials=creds)

def extract_course_tag(event):

    """ scans event for course codes """

    full_text = (event.name or "") + " " + (event.description or "")
    match = re.search(COURSE_REGEX, full_text, re.IGNORECASE)
    if match:
        return f"[{match.group(1).upper()} {match.group(2)}]"
    return None


def sync_calendars():
    print("Authenticating with Google...")
    try:
        service = get_google_service()
    except Exception as e:
        print(f"CRITICAL AUTH ERROR: {e}")
        return

    for source in CALENDAR_SOURCES:
        if "INSERT_YOUR" in source['url']:
            print(f"Skipping {source['name']} (URL not set)")
            continue

        print(f"--- Processing {source['name']} ---")
        try:
            response = requests.get(source['url'])
            response.raise_for_status()
            c = Calendar(response.text)
        except Exception as e:
            print(f"Error fetching {source['name']}: {e}")
            continue

        for event in c.events:
            # --- THE BRAKE PEDAL ---
            # Pauses for 0.5 seconds to prevent "Rate Limit Exceeded"
            time.sleep(0.5)

            try:
                # 1. Course Distinction
                course_tag = extract_course_tag(event)
                original_title = event.name or "Untitled Event"
                if course_tag and not original_title.startswith(course_tag):
                    new_summary = f"{course_tag} {original_title}"
                else:
                    new_summary = original_title

                # 2. ID Cleanup
                clean_id = re.sub(r'[^a-v0-9]', '', event.uid.lower())

                # 3. Event Body
                event_body = {
                    'summary': new_summary,
                    'description': f"{event.description}\n\n[Synced from {source['name']}]",
                    'start': {'dateTime': event.begin.isoformat(), 'timeZone': TIMEZONE},
                    'end': {'dateTime': event.end.isoformat(), 'timeZone': TIMEZONE},
                    'id': clean_id,
                    'reminders': {
                        'useDefault': False,
                        'overrides': [
                            {'method': 'popup', 'minutes': 24 * 60},
                            {'method': 'popup', 'minutes': 72 * 60},
                        ],
                    },
                }

                # 4. Push to Google
                try:
                    service.events().insert(calendarId='primary', body=event_body).execute()
                    print(f"Created: {new_summary}")
                except HttpError as error:
                    # 409 means "Event exists", so we update it.
                    if error.resp.status == 409:
                        try:
                            service.events().update(calendarId='primary', eventId=clean_id, body=event_body).execute()
                            print(f"Updated: {new_summary}")
                        except HttpError as update_error:
                             print(f"Failed to update {new_summary}: {update_error}")
                    else:
                        print(f"API Error on {new_summary}: {error}")

            except Exception as ev_err:
                print(f"Skipping event due to internal error: {ev_err}")

if __name__ == '__main__':
    sync_calendars()
    print("Sync Complete.")
