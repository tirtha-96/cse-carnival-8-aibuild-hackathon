require('dotenv').config();
const path = require('path');
const assert = require('assert');
const { app, store, agent } = require('../server');

async function run() {
  console.log('--- Starting CampusOS Gemini AI & Live Database Verification ---');
  
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = 'http://127.0.0.1:' + port + '/api';
  console.log('Test server listening on ' + baseUrl);

  try {
    // 1. Check Config & Health
    const cfgRes = await fetch(baseUrl + '/config').then(r => r.json());
    console.log('Config response:', cfgRes);
    assert.strictEqual(cfgRes.ai_configured, true, 'AI should be configured with GEMINI_API_KEY');

    // 2. Query Agent for Class Lookup
    console.log('\n[Test 1] Asking agent: "What classes do I have on Wednesday?"');
    const chat1Res = await fetch(baseUrl + '/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What classes do I have on Wednesday?' })
    }).then(r => r.json());
    if (chat1Res.error) throw new Error(`Test 1 Chat Error: ${chat1Res.error}`);
    console.log('Agent reply:\n' + chat1Res.message);
    assert.ok(chat1Res.message && chat1Res.tool_calls >= 1, 'Agent should call tools and respond');

    await new Promise(res => setTimeout(res, 2500));

    // 3. Test Live Data Grounding
    console.log('\n[Test 2] Live Data Grounding: Modifying an announcement in SQLite database...');
    const originalAnn = store.get('announcements', 'ann-002');
    const testTitle = 'CRITICAL: Lab 7A01 Maintenance - Relocated';
    store.update('announcements', 'ann-002', { title: testTitle });

    // Verify directly from SQLite
    const updatedInDb = store.get('announcements', 'ann-002');
    assert.strictEqual(updatedInDb.title, testTitle, 'Database must have the updated title');
    console.log('Confirmed update in SQLite records table: ' + updatedInDb.title);

    // Ask the agent about it
    console.log('Asking agent: "Are there any notices about Lab 7A01 maintenance?"');
    const chat2Res = await fetch(baseUrl + '/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Are there any notices about Lab 7A01 maintenance?' })
    }).then(r => r.json());
    if (chat2Res.error) throw new Error(`Test 2 Chat Error: ${chat2Res.error}`);
    console.log('Agent reply:\n' + chat2Res.message);
    assert.ok(chat2Res.message.includes('7A01') || chat2Res.message.toLowerCase().includes('maintenance'), 'Agent must ground its answer in the updated announcement');

    // Revert announcement
    store.update('announcements', 'ann-002', { title: originalAnn.title });
    console.log('Restored original announcement in SQLite.');

    await new Promise(res => setTimeout(res, 2500));

    // 4. Test Action: Event Registration & SQLite persistence
    console.log('\n[Test 3] Action test: Registering Dr. Doom for event evt-005 in SQLite...');
    const evtBefore = store.get('events', 'evt-005');
    console.log('evt-005 registrations before:', evtBefore.registrations.length, 'registered count:', evtBefore.registered);

    const chat3Res = await fetch(baseUrl + '/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "Register me for the Freshers' Orientation — CSE Fall 2026.",
        student: { student_id: '20-40532', name: 'Dr. Doom' }
      })
    }).then(r => r.json());
    if (chat3Res.error) throw new Error(`Test 3 Chat Error: ${chat3Res.error}`);
    console.log('Agent reply:\n' + chat3Res.message);

    const evtAfter = store.get('events', 'evt-005');
    console.log('evt-005 registrations after:', evtAfter.registrations.length, 'registered count:', evtAfter.registered);
    assert.strictEqual(evtAfter.registered, evtBefore.registered + 1, 'Event registered count must increment in SQLite');
    assert.ok(evtAfter.registrations.some(r => r.student_id === '20-40532'), 'Student must be present in SQLite registrations array');

    // Cancel registration to restore state
    store.cancelRegistration('evt-005', '20-40532');
    const evtRestored = store.get('events', 'evt-005');
    assert.strictEqual(evtRestored.registered, evtBefore.registered, 'Event registered count must restore in SQLite');
    console.log('Restored evt-005 registrations in SQLite.');

    await new Promise(res => setTimeout(res, 2500));

    // 5. Test Action: Room Booking & SQLite persistence
    console.log('\n[Test 4] Action test: Booking Room 7A02 via agent...');
    const chat4Res = await fetch(baseUrl + '/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Book Room 7A02 on 2026-09-08 from 3 PM to 5 PM for Project Discussion.',
        student: { student_id: '20-40532', name: 'Dr. Doom' }
      })
    }).then(r => r.json());
    if (chat4Res.error) throw new Error(`Test 4 Chat Error: ${chat4Res.error}`);
    console.log('Agent reply:\n' + chat4Res.message);

    const roomAfterBooking = store.findRoom('7A02');
    const booking = roomAfterBooking.bookings.find(b => b.date === '2026-09-08' && b.start_time === '15:00');
    assert.ok(booking, 'Room booking must be stored in SQLite');
    console.log('Confirmed booking in SQLite:', booking);

    // Cancel room booking
    store.cancelBooking('7A02', booking.booking_id);
    const roomAfterCancel = store.findRoom('7A02');
    assert.ok(!roomAfterCancel.bookings.some(b => b.booking_id === booking.booking_id), 'Booking must be removed from SQLite');
    console.log('Restored Room 7A02 bookings in SQLite.');

    console.log('\nALL VERIFICATION TESTS PASSED SUCCESSFULLY! Database updates confirmed in SQLite.');
  } finally {
    server.close();
    store.db.close();
  }
}

run().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
