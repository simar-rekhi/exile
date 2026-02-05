const { BlackboardCalendarScraper } = require('./blackboard-to-gcal');
const fs = require('fs').promises;
require('dotenv').config();

async function main() {
  console.log(' Testing Blackboard Scraper');
  console.log('=============================\n');

  if (!process.env.BLACKBOARD_USERNAME || !process.env.BLACKBOARD_PASSWORD) {
    console.error(' Please set BLACKBOARD_USERNAME and BLACKBOARD_PASSWORD in .env file');
    process.exit(1);
  }

  const scraper = new BlackboardCalendarScraper();
  
  try {
    console.log('Initializing browser...');
    await scraper.initialize();
    
    console.log('Logging in to Blackboard...');
    await scraper.login();
    
    console.log('Navigating to calendar...');
    await scraper.navigateToCalendar();
    
    console.log('Extracting events...');
    const rawEvents = await scraper.extractCalendarEvents();
    
    console.log(`\n Found ${rawEvents.length} raw events\n`);
    
    // Process events
    const processedEvents = rawEvents.map(event => scraper.processEvent(event));
    
    // Display events
    console.log(' Processed Events:');
    console.log('===================\n');
    
    processedEvents.forEach((event, index) => {
      console.log(`${index + 1}. ${event.summary}`);
      console.log(`   Course: ${event.courseCode}`);
      console.log(`   Date: ${event.dateStr} ${event.timeStr}`);
      console.log(`   Original: ${event.originalTitle}`);
      console.log('');
    });
    
    // Save to file
    await fs.writeFile(
      './test-events.json',
      JSON.stringify(processedEvents, null, 2)
    );
    console.log(' Events saved to test-events.json');
    
    // Save raw events for debugging
    await fs.writeFile(
      './test-events-raw.json',
      JSON.stringify(rawEvents, null, 2)
    );
    console.log(' Raw events saved to test-events-raw.json');
    
    console.log('\n Test complete!');
    
    // Keep browser open for inspection
    if (!process.env.HEADLESS) {
      console.log('\n  Browser kept open for inspection. Press Ctrl+C to close.');
      await new Promise(() => {}); // Keep running
    }
    
  } catch (error) {
    console.error(' Error:', error.message);
    console.error(error.stack);
  } finally {
    if (process.env.HEADLESS) {
      await scraper.close();
    }
  }
}

main();
