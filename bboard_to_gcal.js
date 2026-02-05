const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  blackboard: {
    url: 'https://elearning.utdallas.edu', 
    username: process.env.BLACKBOARD_USERNAME,
    password: process.env.BLACKBOARD_PASSWORD,
  },
  google: {
    credentialsPath: './credentials.json',
    tokenPath: './token.json',
  },
  headless: false, // Set to true for production
};

class BlackboardCalendarScraper {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    this.browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
  }

  async login() {
    console.log('Logging into Blackboard...');
    await this.page.goto(CONFIG.blackboard.url, { waitUntil: 'networkidle2' });

    // Wait for login form - adjust selectors based on your Blackboard version
    await this.page.waitForSelector('input[name="user_id"], input[type="text"]', { timeout: 10000 });
    
    // Enter credentials
    await this.page.type('input[name="user_id"], input[type="text"]', CONFIG.blackboard.username);
    await this.page.type('input[name="password"], input[type="password"]', CONFIG.blackboard.password);
    
    // Click login button
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
      this.page.click('input[type="submit"], button[type="submit"]'),
    ]);

    console.log('Login successful!');
  }

  async navigateToCalendar() {
    console.log('Navigating to calendar...');
    
    // Look for calendar link - adjust selector based on your Blackboard layout
    // Common selectors:
    // - Ultra: 'a[href*="calendar"]'
    // - Classic: '#calendarLink'
    const calendarSelectors = [
      'a[href*="calendar"]',
      '#calendarLink',
      'a:contains("Calendar")',
      '[data-id="calendar"]',
    ];

    for (const selector of calendarSelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 3000 });
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
          this.page.click(selector),
        ]);
        console.log('Calendar loaded!');
        return;
      } catch (e) {
        continue;
      }
    }

    // If no link found, try direct URL
    await this.page.goto(`${CONFIG.blackboard.url}/webapps/calendar/viewPersonal`, {
      waitUntil: 'networkidle2',
    });
  }

  async extractCalendarEvents() {
    console.log('Extracting calendar events...');
    
    // Wait for calendar to load
    await this.page.waitForTimeout(2000);

    // Extract events - this will vary based on Blackboard version
    const events = await this.page.evaluate(() => {
      const extractedEvents = [];
      
      // For Blackboard Ultra
      const ultraEvents = document.querySelectorAll('[data-testid="calendar-event"], .calendar-event, .event-item');
      
      ultraEvents.forEach((eventElement) => {
        try {
          // Extract event title
          const titleElement = eventElement.querySelector('.event-title, .title, [class*="title"]');
          const title = titleElement ? titleElement.textContent.trim() : '';
          
          // Extract course name/code
          const courseElement = eventElement.querySelector('.course-name, .course-id, [class*="course"]');
          let courseName = courseElement ? courseElement.textContent.trim() : '';
          
          // Sometimes course is in the link or parent
          if (!courseName) {
            const courseLink = eventElement.querySelector('a[href*="/course/"]');
            if (courseLink) {
              const urlMatch = courseLink.href.match(/course_id=([^&]+)/);
              courseName = urlMatch ? urlMatch[1] : '';
            }
          }
          
          // Extract date/time
          const dateElement = eventElement.querySelector('.date, .event-date, time, [class*="date"]');
          const dateStr = dateElement ? dateElement.textContent.trim() : '';
          
          // Extract due time
          const timeElement = eventElement.querySelector('.time, .event-time, [class*="time"]');
          const timeStr = timeElement ? timeElement.textContent.trim() : '';
          
          // Extract description/details
          const descElement = eventElement.querySelector('.description, .details, [class*="desc"]');
          const description = descElement ? descElement.textContent.trim() : '';
          
          if (title && dateStr) {
            extractedEvents.push({
              title,
              courseName,
              dateStr,
              timeStr,
              description,
              rawHTML: eventElement.innerHTML.substring(0, 500), // For debugging
            });
          }
        } catch (e) {
          console.error('Error extracting event:', e);
        }
      });
      
      // For Blackboard Classic - different structure
      if (extractedEvents.length === 0) {
        const classicEvents = document.querySelectorAll('.eventDiv, tr[class*="event"]');
        
        classicEvents.forEach((eventElement) => {
          try {
            const allText = eventElement.textContent.trim();
            const links = eventElement.querySelectorAll('a');
            
            let title = '';
            let courseName = '';
            
            links.forEach(link => {
              const href = link.href || '';
              if (href.includes('course_id')) {
                const match = href.match(/course_id=([^&]+)/);
                if (match) courseName = match[1];
              }
              if (!title && link.textContent.trim()) {
                title = link.textContent.trim();
              }
            });
            
            if (title) {
              extractedEvents.push({
                title,
                courseName,
                dateStr: allText,
                timeStr: '',
                description: allText,
                rawHTML: eventElement.innerHTML.substring(0, 500),
              });
            }
          } catch (e) {
            console.error('Error extracting classic event:', e);
          }
        });
      }
      
      return extractedEvents;
    });

    console.log(`Found ${events.length} events`);
    return events;
  }

  async getUpcomingEvents(daysAhead = 30) {
    await this.initialize();
    await this.login();
    await this.navigateToCalendar();
    
    const events = await this.extractCalendarEvents();
    
    // Process and clean up events
    const processedEvents = events.map(event => this.processEvent(event));
    
    await this.browser.close();
    return processedEvents;
  }

  processEvent(event) {
    // Parse date and time
    const { dateStr, timeStr, title, courseName, description } = event;
    
    // Try to extract course code from various sources
    let courseCode = courseName;
    
    // Check if course code is in the title
    const coursePattern = /([A-Z]{2,4}\s*\d{4})/i;
    const titleMatch = title.match(coursePattern);
    if (titleMatch) {
      courseCode = titleMatch[1];
    }
    
    // Clean up course code
    if (courseCode && courseCode.startsWith('_')) {
      // Blackboard course IDs often look like "_12345_1"
      // Try to find readable course name in description
      const descMatch = description.match(coursePattern);
      if (descMatch) {
        courseCode = descMatch[1];
      }
    }
    
    // Create formatted title with course code
    const formattedTitle = courseCode ? `${courseCode} - ${title}` : title;
    
    return {
      summary: formattedTitle,
      description: description || `${title}\nCourse: ${courseCode || 'Unknown'}`,
      courseCode: courseCode || 'Unknown',
      originalTitle: title,
      dateStr,
      timeStr,
      rawEvent: event,
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

class GoogleCalendarSync {
  constructor() {
    this.calendar = null;
    this.auth = null;
  }

  async authorize() {
    const credentials = JSON.parse(await fs.readFile(CONFIG.google.credentialsPath, 'utf8'));
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we have a token
    try {
      const token = await fs.readFile(CONFIG.google.tokenPath, 'utf8');
      oAuth2Client.setCredentials(JSON.parse(token));
    } catch (err) {
      // Need to get new token
      await this.getNewToken(oAuth2Client);
    }

    this.auth = oAuth2Client;
    this.calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
  }

  async getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
    });

    console.log('Authorize this app by visiting this url:', authUrl);
    console.log('Then run the script again with the authorization code.');
    
    // In a real implementation, you'd handle the OAuth flow here
    throw new Error('Please authorize the app first');
  }

  async addEvent(event, calendarId = 'primary') {
    try {
      // Parse the date/time from Blackboard format
      const startDateTime = this.parseDateTime(event.dateStr, event.timeStr);
      
      const calendarEvent = {
        summary: event.summary,
        description: event.description,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'America/Chicago', // Update to your timezone
        },
        end: {
          dateTime: new Date(startDateTime.getTime() + 60 * 60 * 1000).toISOString(), // 1 hour duration
          timeZone: 'America/Chicago',
        },
        colorId: this.getCourseColor(event.courseCode),
      };

      const result = await this.calendar.events.insert({
        calendarId,
        resource: calendarEvent,
      });

      console.log(`Event created: ${event.summary}`);
      return result.data;
    } catch (error) {
      console.error(`Error creating event: ${event.summary}`, error.message);
      return null;
    }
  }

  parseDateTime(dateStr, timeStr) {
    // This is a simple parser - you may need to adjust based on your Blackboard's date format
    // Common formats: "Feb 10, 2025", "2025-02-10", "Monday, February 10, 2025"
    
    const now = new Date();
    let date = new Date(dateStr);
    
    // If time string exists, parse it
    if (timeStr) {
      const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const meridiem = timeMatch[3];
        
        if (meridiem && meridiem.toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        } else if (meridiem && meridiem.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
        
        date.setHours(hours, minutes, 0, 0);
      }
    } else {
      // Default to 11:59 PM if no time specified
      date.setHours(23, 59, 0, 0);
    }
    
    return date;
  }

  getCourseColor(courseCode) {
    // Assign different colors to different courses
    // Google Calendar color IDs: 1-11
    const colors = {
      'CS': '9',   // Blue
      'MATH': '5', // Yellow
      'PHYS': '10', // Green
      'ENG': '4',  // Flamingo
      'HIST': '6', // Orange
    };
    
    const prefix = courseCode ? courseCode.match(/^[A-Z]+/)?.[0] : null;
    return colors[prefix] || '1'; // Default to lavender
  }

  async syncEvents(events) {
    console.log(`Syncing ${events.length} events to Google Calendar...`);
    
    for (const event of events) {
      await this.addEvent(event);
      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log('Sync complete!');
  }
}

// Main execution
async function main() {
  try {
    // Check environment variables
    if (!CONFIG.blackboard.username || !CONFIG.blackboard.password) {
      console.error('Please set BLACKBOARD_USERNAME and BLACKBOARD_PASSWORD environment variables');
      process.exit(1);
    }

    // Scrape Blackboard
    console.log('Starting Blackboard scraper...');
    const scraper = new BlackboardCalendarScraper();
    const events = await scraper.getUpcomingEvents();
    
    // Save events to file for review
    await fs.writeFile(
      './blackboard-events.json',
      JSON.stringify(events, null, 2)
    );
    console.log(`Saved ${events.length} events to blackboard-events.json`);

    // Sync to Google Calendar
    console.log('\nStarting Google Calendar sync...');
    const gcal = new GoogleCalendarSync();
    await gcal.authorize();
    await gcal.syncEvents(events);

    console.log('\nAll done!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { BlackboardCalendarScraper, GoogleCalendarSync };
