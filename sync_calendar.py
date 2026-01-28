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



# configuration
CALENDAR_SOURCES = [
    {"name": "eLearning", "url": "add your ics link here"},
    {"name": "Teams", "url": "add your ics link here"},
]

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


def parse_course_code(event):

    """ attempt to find a course code. designed to handle variable lengths. return a clean tag """

    # combine title + descrip to search for the code
    text_to_search = (event.name or "") + " " + (event.description or "")


    # regex usage - look for patterns CS 3345, CS-3345, CS3345
    match = re.search(r'\b(CS|MATH|PHYS|FILM|GOVT|HIST|BIOL|CHEM|CE|SE)\s?-?(\d{4})\b', text_to_search, re.IGNORECASE)

    if match:
        return f"[{match.group(1).upper()} {match.group(2)}]"
    return None


def sync_calendar():
    service = get_google_service()
    
    for source in CALENDAR_SOURCES:
        print(f"Fetching {source['name']}...")
        try:
            c = Calendar(requests.get(source['url']).text)
        except Exception as e:
            print(f"Failed to fetch {source['name']}: {e}")
            continue

        for event in c.events:
            # 1. custom title logic
            course_tag = parse_course_code(event)
            new_summary = event.name
            
            # Only prepend if the tag isn't already there
            if course_tag and not new_summary.startswith(course_tag):
                new_summary = f"{course_tag} {new_summary}"

            # 2. prevent duplicates
            # We use the ICS UID but strip non-alphanumeric chars to satisfy Google's ID requirements
            clean_id = re.sub(r'[^a-v0-9]', '', event.uid.lower())

            # 3. Define the Event Body
            event_body = {
                'summary': new_summary,
                'description': f"{event.description}\n\n(Source: {source['name']})",
                'start': {'dateTime': event.begin.isoformat(), 'timeZone': 'America/Chicago'}, # Set your specific timezone
                'end': {'dateTime': event.end.isoformat(), 'timeZone': 'America/Chicago'},
                'id': clean_id,
                
                # 4. Custom Reminders (24h and 72h prior)
                'reminders': {
                    'useDefault': False,
                    'overrides': [
                        {'method': 'popup', 'minutes': 24 * 60},  # 24 hours
                        {'method': 'popup', 'minutes': 72 * 60},  # 72 hours
                    ],
                },
            }

            try:
                # Try to insert the event
                service.events().insert(calendarId='primary', body=event_body).execute()
                print(f"Created: {new_summary}")
            except HttpError as error:
                # If error 409 (Conflict), the event exists, so we update it
                if error.resp.status == 409:
                    service.events().update(calendarId='primary', eventId=clean_id, body=event_body).execute()
                    print(f"Updated: {new_summary}")
                else:
                    print(f"An error occurred: {error}")



if __name__ == '__main__':
    sync_calendars()
