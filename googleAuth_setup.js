const { google } = require('googleapis');
const fs = require('fs').promises;
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = './token.json';
const CREDENTIALS_PATH = './credentials.json';

async function authorize() {
  let credentials;
  try {
    const content = await fs.readFile(CREDENTIALS_PATH, 'utf8');
    credentials = JSON.parse(content);
  } catch (err) {
    console.error('Error loading credentials.json');
    console.error('Please download it from Google Cloud Console:');
    console.error('1. Go to https://console.cloud.google.com');
    console.error('2. Create a project or select existing one');
    console.error('3. Enable Google Calendar API');
    console.error('4. Create OAuth 2.0 credentials (Desktop app)');
    console.error('5. Download the credentials and save as credentials.json');
    process.exit(1);
  }

  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Check if we already have a token
  try {
    const token = await fs.readFile(TOKEN_PATH, 'utf8');
    oAuth2Client.setCredentials(JSON.parse(token));
    console.log('Already authorized! Token found.');
    return oAuth2Client;
  } catch (err) {
    return getAccessToken(oAuth2Client);
  }
}

function getAccessToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n📋 AUTHORIZATION REQUIRED');
  console.log('==========================');
  console.log('Please visit this URL to authorize the app:\n');
  console.log(authUrl);
  console.log('\nAfter authorizing, you will be redirected to a URL.');
  console.log('Copy the CODE from the URL and paste it below.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question('Enter the authorization code: ', async (code) => {
      rl.close();
      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        // Store the token
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log('\n Token saved to', TOKEN_PATH);
        console.log('Authorization complete!');
        
        resolve(oAuth2Client);
      } catch (err) {
        console.error('Error retrieving access token:', err);
        reject(err);
      }
    });
  });
}

async function testCalendarAccess(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  
  try {
    const res = await calendar.calendarList.list();
    console.log('\n Your calendars:');
    res.data.items.forEach((cal) => {
      console.log(`  - ${cal.summary} (${cal.id})`);
    });
    console.log('\n Google Calendar access verified!');
  } catch (err) {
    console.error('Error accessing calendar:', err);
  }
}

async function main() {
  console.log(' Google Calendar Setup');
  console.log('==========================\n');
  
  const auth = await authorize();
  await testCalendarAccess(auth);
  
  console.log('\n Setup complete! You can now run the main script with:');
  console.log('   npm start');
}

main().catch(console.error);
