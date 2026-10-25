// The ElevenLabs coach sends one message at a time: the agent answers several quick messages with one reply, so the
// events that come meanwhile wait and go together. In duplex the user also talks to the agent, which answers them on its
// own and acts on their words through the page's client tools. Here with a fake client in place of the vendored one,
// handing the agent's events on the way web/vendor/elevenlabs-client-1.27.0 does (onIncomingEvent first, then the
// callbacks).
import test from 'node:test';
import assert from 'node:assert/strict';

let session = null;            // the fake conversation of the last start
let hold = null;               // a promise startSession waits for (a session still connecting)
let setup = async () => {};    // what the client does while it starts (asks for a microphone, in voice mode)

function fakeSession(opts) {
  const s = { opts, sent: [], volumes: [], activity: 0, ended: 0, interrupts: 0, mode: 'listening', cut: 0, broken: false };
  const mode = m => { if (m !== s.mode) { s.mode = m; opts.onModeChange?.({ mode: m }); } };
  s.conversation = {
    sendUserMessage: m => { if (s.broken) throw new Error('socket closed'); s.sent.push(JSON.parse(m)); },
    sendUserActivity: () => { s.activity += 1; },
    setMicMuted: async m => { s.micMuted = m; },
    // (a text-only conversation has no voice: the client throws)
    setVolume: opts.textOnly ? () => { throw new Error('setVolume is not supported in text conversations'); }
      : ({ volume }) => { s.volumes.push(volume); },
    endSession: async () => { s.ended += 1; opts.onDisconnect?.({ reason: 'user' }); },
    output: { interrupt: () => { s.interrupts += 1; } },
    // the client's input.setDevice: a new microphone stream with its own constraints, in place of the one it had
    changeInputDevice: async () => { s.input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); },
  };
  // the agent's events
  s.audio = id => {
    opts.onIncomingEvent?.({ type: 'audio', audio_event: { event_id: id, audio_base_64: 'AAAA' } });
    if (s.cut <= id) { opts.onAudio?.('AAAA'); mode('speaking'); }
  };
  s.text = (id, message) => {
    opts.onIncomingEvent?.({ type: 'agent_response', agent_response_event: { agent_response: message, event_id: id } });
    opts.onMessage?.({ source: 'ai', role: 'agent', message, event_id: id });
  };
  s.part = (id, text) => {                     // a piece of a reply's text as the LLM writes it
    const part = { type: 'delta', text, event_id: id };
    opts.onIncomingEvent?.({ type: 'agent_chat_response_part', text_response_part: part });
    opts.onAgentChatResponsePart?.(part);
  };
  s.interrupt = id => {
    opts.onIncomingEvent?.({ type: 'interruption', interruption_event: { event_id: id } });
    s.cut = id;
    opts.onInterruption?.({ event_id: id });
    if (!opts.textOnly) mode('listening');
  };
  s.played = () => mode('listening');          // the audio worklet ran out of audio
  s.user = (id, text) => {                     // the user's words, transcribed (duplex)
    opts.onIncomingEvent?.({ type: 'user_transcript', user_transcription_event: { user_transcript: text, event_id: id } });
    opts.onMessage?.({ source: 'user', role: 'user', message: text, event_id: id });
  };
  s.tool = (id, name, parameters) => {         // the agent calls a client tool in reply `id`: what the client sends back
    opts.onIncomingEvent?.({ type: 'client_tool_call',
      client_tool_call: { tool_name: name, tool_call_id: 't1', parameters, event_id: id, expects_response: true } });
    return opts.clientTools[name](parameters);
  };
  return s;
}

globalThis.window = {
  ElevenLabsClient: {
    Conversation: {
      startSession: async opts => {
        const s = fakeSession(opts);
        await setup(opts);
        if (hold) await hold;
        session = s;
        opts.onConnect?.({ conversationId: 'made-up-conversation' });
        return s.conversation;
      },
    },
  },
};
const { ElevenCoach, CAP_MS, ECHO_MS, GAP_MS, GRACE_MS, QUIET_MS, START_MS, TALK_MS, USER_MS, echoOf } = await import('../web/js/eleven-coach.js');
const later = () => { let open; const p = new Promise(r => { open = r; }); p.open = open; return p; };

test('one message in flight; what comes meanwhile goes together, as one message, when the reply arrives', async () => {
  const cues = [], dispatched = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', llm: 'gemini-2.5-flash', textOnly: true });
  await coach.start({ onCue: c => cues.push(c), onDispatch: (marks, events) => dispatched.push(events.length) });
  const s = session;
  const a = coach.send({ summary: 'set start' });
  assert.ok(a);
  assert.equal(coach.send({ summary: 'form fault' }), null);          // waits for the reply to the first
  assert.equal(coach.send({ summary: 'out of view' }), null);
  assert.equal(s.sent.length, 1);
  s.text(1, 'Jumping jacks, set one.');
  assert.equal(cues[0].marks, a);
  assert.equal(s.sent.length, 2);                                       // the two that waited, as one message
  assert.deepEqual(s.sent[1].events.map(e => e.summary), ['form fault', 'out of view']);
  assert.match(s.sent[1].summary, /2 things happened/);
  s.text(2, 'Arms overhead, and step back so I can see you.');
  assert.equal(cues.length, 2);
  assert.deepEqual(dispatched, [1, 2]);
  coach.send({ summary: 'set end' });                                   // nothing in flight: goes at once, alone
  assert.equal(s.sent.length, 3);
  assert.equal(s.sent[2].summary, 'set end');
  s.text(3, 'Set done.');
  await coach.stop();
  assert.equal(s.ended, 1);
});

test('a reply given up on still holds the next message: two messages are never out at once', async () => {
  const cues = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: true });
  await coach.start({ onCue: c => cues.push(c) });
  const s = session;
  const a = coach.send({ summary: 'first' });
  assert.equal(coach.send({ summary: 'second' }), null);
  coach.release(a);                                                     // the page spoke its own cue for 'first'
  assert.equal(s.sent.length, 1);                                       // 'second' still waits for that reply
  s.text(1, 'late reply to first');
  assert.equal(cues[0].marks, a);                                       // matched to 'first', which the page skips
  assert.equal(s.sent.length, 2);                                       // and now 'second' goes
  s.text(2, 'reply to second');
  assert.equal(cues[1].event.summary, 'second');
  coach.release(a);                                                     // (a second release of an old message: nothing)
  assert.equal(s.sent.length, 2);
  await coach.stop();
});

test('no reply within the cap: the coach goes on in step, and a reply that began before the next message is not its reply', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const cues = [], done = [], replies = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false });
  await coach.start({ onCue: c => cues.push(c), onDone: (m, how) => done.push([m, how]), onReply: m => replies.push(m) });
  const s = session;
  const a = coach.send({ summary: 'A' });
  coach.send({ summary: 'B' });
  t.mock.timers.tick(3000);
  coach.release(a);                                                     // the page's fallback for A
  s.audio(7);                                                           // A's reply starts after all: not heard
  assert.deepEqual(s.volumes, [0]);
  t.mock.timers.tick(CAP_MS - 3000);                                    // ... and its text never comes
  assert.deepEqual(done, [[a, 'cap']]);
  assert.equal(s.sent.length, 2);                                       // B goes at the cap
  const b = coach.inFlight.marks;
  s.audio(7);                                                           // more of A, and then its text: still A's
  s.text(7, 'reply to A');
  assert.equal(cues[0].marks, a);
  assert.equal(coach.inFlight?.marks, b);                               // B is still waiting for its own reply
  s.audio(8);                                                           // B's reply: heard (what is left of A goes first)
  assert.equal(replies.at(-1), b);
  assert.equal(s.interrupts, 1);
  assert.deepEqual(s.volumes, [0, 1]);
  s.text(8, 'reply to B');
  assert.equal(cues[1].marks, b);
  assert.equal(coach.inFlight, null);
  await coach.stop();
});

test('at the cap with nothing of the reply come, the next message waits until the agent is quiet: a later reply is still the late one', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const cues = [], done = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: true });
  await coach.start({ onCue: c => cues.push(c), onDone: (m, how) => done.push([m, how]) });
  const s = session;
  const a = coach.send({ summary: 'A' });
  coach.send({ summary: 'B' });
  t.mock.timers.tick(CAP_MS);
  assert.deepEqual(done, [[a, 'cap']]);
  assert.equal(s.sent.length, 1);                                       // B waits a little more
  assert.equal(coach.send({ summary: 'C' }), null);                     // (so does what comes meanwhile)
  t.mock.timers.tick(GRACE_MS - 500);
  s.part(1, 'late ');                                                   // A's reply begins after all: the wait goes on
  t.mock.timers.tick(GRACE_MS - 1);
  assert.equal(s.sent.length, 1);
  s.text(1, 'late reply to A');
  assert.equal(cues[0].marks, a);                                       // A's, not B's
  assert.equal(s.sent.length, 2);                                       // and B and C go
  assert.deepEqual(s.sent[1].events.map(e => e.summary), ['B', 'C']);
  s.text(2, 'reply to B and C');
  assert.deepEqual(cues[1].event.events.map(e => e.summary), ['B', 'C']);

  const d = coach.send({ summary: 'D' });                               // no reply at all: the next goes once it is quiet
  t.mock.timers.tick(CAP_MS);
  assert.deepEqual(done.at(-1), [d, 'cap']);
  assert.equal(coach.send({ summary: 'E' }), null);
  t.mock.timers.tick(GRACE_MS - 1);
  assert.equal(s.sent.length, 3);
  t.mock.timers.tick(1);
  assert.equal(s.sent.length, 4);
  assert.equal(s.sent[3].summary, 'E');
  s.text(3, 'reply to E');
  assert.equal(cues[2].event.summary, 'E');

  coach.send({ summary: 'F' });                                         // its reply began before the cap: no wait
  s.part(4, 'F...');
  t.mock.timers.tick(CAP_MS);
  coach.send({ summary: 'G' });
  assert.equal(s.sent.length, 6);
  s.text(4, 'reply to F');
  s.text(5, 'reply to G');
  assert.deepEqual(cues.slice(3).map(c => c.event.summary), ['F', 'G']);
  await coach.stop();
});

test("with the agent's voice, a reply that comes in the wait after the cap is not heard, and the next one is", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const replies = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false });
  await coach.start({ onReply: m => replies.push(m) });
  const s = session;
  const a = coach.send({ summary: 'A' });
  coach.send({ summary: 'B' });
  t.mock.timers.tick(3000);
  coach.release(a);                                                     // the page spoke its own cue for A
  t.mock.timers.tick(CAP_MS - 3000 + 1000);
  s.audio(1);                                                           // A's reply, a second after the cap
  assert.deepEqual(replies, [a]);
  assert.deepEqual(s.volumes, [0]);
  s.text(1, 'late reply to A');
  assert.equal(s.sent.length, 2);
  const b = coach.inFlight.marks;
  s.audio(2);
  assert.deepEqual(replies, [a, b]);
  assert.deepEqual(s.volumes, [0, 1]);                                  // B's reply is heard, what is left of A is not
  assert.equal(s.interrupts, 1);
  await coach.stop();
});

test("with the agent's voice, a gap inside a reply and its voice after its text are not the next message's first sound", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const replies = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false });
  await coach.start({ onReply: m => replies.push(m) });
  const s = session;
  const a = coach.send({ summary: 'A' });
  coach.send({ summary: 'B' });
  s.audio(5);
  assert.deepEqual(replies, [a]);
  s.played();                                                           // a gap: the client is briefly back to listening
  s.audio(5);
  s.text(5, 'reply to A');                                              // A's voice goes on: B waits for it
  assert.equal(s.sent.length, 1);
  s.played();                                                           // a gap after its text: its audio still arriving
  t.mock.timers.tick(GAP_MS - 1);
  s.audio(5);
  assert.equal(s.sent.length, 1);                                       // B was not sent into the gap
  s.played();
  t.mock.timers.tick(GAP_MS - 1);
  assert.equal(s.sent.length, 1);
  t.mock.timers.tick(1);                                                // back to listening for GAP_MS: played out
  assert.equal(s.sent.length, 2);
  const b = coach.inFlight.marks;
  s.audio(5);                                                           // (a last chunk of A's, after all)
  assert.deepEqual(replies, [a]);                                       // not B's first sound
  assert.equal(b.audio, undefined);
  s.audio(6);
  assert.deepEqual(replies, [a, b]);
  await coach.stop();
});

test("a late reply is not heard over the page's own cue; the voice comes back for the next reply", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const done = [], replies = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false });
  await coach.start({ onDone: (m, how) => done.push([m, how]), onReply: m => replies.push(m) });
  const s = session;
  const a = coach.send({ summary: 'A' });
  coach.release(a);
  s.audio(3);
  s.audio(3);
  assert.deepEqual(s.volumes, [0]);
  s.text(3, 'late reply to A');
  s.played();
  t.mock.timers.tick(QUIET_MS - 1);
  assert.deepEqual(done, []);
  t.mock.timers.tick(1);
  assert.deepEqual(done, [[a, 'replied']]);                             // played out (silently)
  coach.setVolume(0.5);                                                 // (asked for meanwhile: kept for the next reply)
  assert.deepEqual(s.volumes, [0]);
  const b = coach.send({ summary: 'B' });
  s.audio(4);
  assert.deepEqual(replies, [a, b]);
  assert.deepEqual(s.volumes, [0, 0.5]);                                // the next reply is heard
  assert.equal(s.interrupts, 0);                                        // (nothing of A was left to drop)
  await coach.stop();

  const text = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: true });   // text only: there is no voice to turn down
  await text.start();
  const m = text.send({ summary: 'A' });
  text.release(m);
  session.text(1, 'late');
  text.setVolume(0);
  assert.deepEqual(session.volumes, []);
  await text.stop();
});

test("with the agent's voice, the next message waits for the reply to play out: one sent over it would cut it off", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  await coach.start();
  const s = session;
  coach.send({ summary: 'A' });
  s.audio(1);
  s.text(1, 'Squats, set one.');
  assert.equal(coach.talking, true);
  assert.equal(coach.send({ summary: 'B' }), null);                     // A's voice still plays
  s.played();
  t.mock.timers.tick(GAP_MS);
  assert.deepEqual(s.sent.map(m => m.summary), ['A', 'B']);
  s.text(2, 'Knees out.');                                              // (live, after a tool: the text before the voice)
  assert.equal(coach.send({ summary: 'C' }), null);
  s.audio(2);
  t.mock.timers.tick(START_MS);                                         // its voice started: waited for to the end
  assert.equal(s.sent.length, 2);
  s.played();
  t.mock.timers.tick(GAP_MS);
  assert.deepEqual(s.sent.map(m => m.summary), ['A', 'B', 'C']);
  s.audio(3);
  s.text(3, 'Chest up.');
  assert.equal(coach.send({ summary: 'D' }), null);
  t.mock.timers.tick(TALK_MS);                                          // a voice that never says it stopped: not for ever
  s.played();
  assert.deepEqual(s.sent.map(m => m.summary), ['A', 'B', 'C', 'D']);
  s.text(4, 'Good.');                                                   // a text whose voice never comes: not for ever
  assert.equal(coach.send({ summary: 'E' }), null);
  t.mock.timers.tick(START_MS);
  assert.equal(s.sent.length, 5);

  const late = coach.inFlight.marks;                                    // a late reply, turned down, is not waited for:
  coach.release(late);
  s.audio(5);
  assert.deepEqual(s.volumes, [0]);
  coach.send({ summary: 'F' });                                         // (E is still in flight: F waits for its text)
  s.text(5, 'late reply to E');
  assert.equal(s.sent.length, 6);                                       // F goes over the silent voice...
  s.interrupt(6);                                                       // ... which the agent then stops: not the user
  assert.equal(coach.userBusy, false);
  await coach.stop();
});

test('an interruption that cuts off the reply in flight lets the next message go', async () => {
  const done = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false });
  await coach.start({ onDone: (m, how) => done.push([m, how]) });
  const s = session;
  const a = coach.send({ summary: 'A' });
  coach.send({ summary: 'B' });
  s.interrupt(2);                                                       // before A's reply began: not about A
  assert.equal(s.sent.length, 1);
  s.audio(4);
  s.interrupt(5);
  assert.deepEqual(done, [[a, 'cut']]);
  assert.equal(s.sent.length, 2);
  await coach.stop();
});

test('stop() while the session connects ends it as soon as it is up, and never keeps it alive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  hold = later();
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false });
  const started = coach.start();
  await new Promise(r => setImmediate(r));                             // (connecting)
  const stopped = coach.stop();
  session = null;
  hold.open(); hold = null;
  assert.equal(await started, null);
  await stopped;
  assert.equal(session.ended, 1);
  t.mock.timers.tick(60000);
  assert.equal(session.activity, 0);
});

test('an event sent while the session connects goes once it is up; a send that fails changes nothing', async () => {
  hold = later();
  const dispatched = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: true });
  const started = coach.start({ onDispatch: (marks, events) => dispatched.push(events.map(e => e.summary)) });
  assert.equal(coach.send({ summary: 'start' }), null);               // waits for the session (does not throw)
  assert.equal(coach.connected, false);
  const gone = { summary: 'spoken by the page meanwhile' };
  assert.equal(coach.send(gone), null);
  assert.equal(coach.withdraw(gone), true);                            // the caller spoke its own cue: it stays back
  assert.equal(coach.withdraw(gone), false);
  hold.open(); hold = null;
  await started;
  assert.equal(coach.connected, true);
  const s = session;
  assert.deepEqual(s.sent.map(m => m.summary), ['start']);
  assert.deepEqual(dispatched, [['start']]);
  s.text(1, "Let's go.");
  s.broken = true;
  assert.throws(() => coach.send({ summary: 'lost' }), /socket closed/);   // the caller speaks its own cue for it
  assert.equal(coach.inFlight, null);
  s.broken = false;
  assert.ok(coach.send({ summary: 'next' }));                          // the coach is not stuck
  assert.deepEqual(s.sent.map(m => m.summary), ['start', 'next']);
  await coach.stop();
});

test('the keep-alive runs only while the caller says so', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let awake = true;
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: true });
  await coach.start({ keepAlive: () => awake });
  t.mock.timers.tick(15000);
  assert.equal(session.activity, 1);
  awake = false;
  t.mock.timers.tick(30000);
  assert.equal(session.activity, 1);
  await coach.stop();
  awake = true;
  t.mock.timers.tick(30000);
  assert.equal(session.activity, 1);
});

test("duplex: the user's words are answered on their own, never as a tracker message's reply, and the next message waits for that answer", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const cues = [], said = [], heard = [], replies = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  await coach.start({ onCue: c => cues.push(c), onSaid: x => said.push(x), onUser: t => heard.push(t), onReply: m => replies.push(m) });
  const s = session;
  s.user(5, 'how many squats was that?');
  assert.deepEqual(heard, ['how many squats was that?']);
  assert.equal(coach.userBusy, true);
  assert.equal(coach.send({ summary: 'A' }), null);                     // waits: the user is being answered
  s.audio(5);                                                           // the answer begins: no message of the page's
  assert.deepEqual(replies, []);
  s.text(5, 'Eight so far.');
  assert.deepEqual(said, [{ text: 'Eight so far.', user: 'how many squats was that?' }]);
  assert.equal(cues.length, 0);
  assert.equal(coach.userBusy, false);
  assert.equal(s.sent.length, 0);                                       // the answer still plays: A waits for it
  s.played();
  t.mock.timers.tick(GAP_MS);
  assert.deepEqual(s.sent.map(m => m.summary), ['A']);                  // and now A goes
  const a = coach.inFlight.marks;
  s.audio(5);                                                           // more of the answer's voice: not A's first sound
  assert.equal(a.audio, undefined);
  s.audio(6);
  assert.deepEqual(replies, [a]);
  s.text(6, 'Knees out on the next one.');
  assert.equal(cues[0].marks, a);
  assert.equal(cues[0].user, null);
  s.text(9, 'Are you still there?');                                   // the agent speaking up on its own: shown
  assert.deepEqual(said.at(-1), { text: 'Are you still there?', user: null });
  assert.equal(cues.length, 1);
  await coach.stop();
});

test('duplex: words while a message is in flight get one reply for both: that message\'s, and the answer to the words', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const cues = [], said = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  await coach.start({ onCue: c => cues.push(c), onSaid: x => said.push(x) });
  const s = session;
  const a = coach.send({ summary: 'ask_exercise' });
  s.user(3, 'squats');                                                  // before the reply to A began
  assert.equal(coach.send({ summary: 'B' }), null);
  s.audio(3);
  s.text(3, 'Squats, got it.');
  assert.equal(cues[0].marks, a);                                       // A is answered, with the user's words
  assert.equal(cues[0].user, 'squats');
  assert.deepEqual(said, []);
  s.played();
  t.mock.timers.tick(GAP_MS);
  assert.deepEqual(s.sent.map(m => m.summary), ['ask_exercise', 'B']);   // nothing else holds B
  s.text(4, 'reply to B');
  assert.equal(cues[1].event.summary, 'B');
  await coach.stop();
});

test('duplex: a late reply that answers the user too is heard; words the agent stays quiet about hold the next message only briefly, and expire', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const said = [], cues = [], calls = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  await coach.start({ onSaid: x => said.push(x), onCue: c => cues.push(c),
    tools: { answer_set_end: ({ done }, how) => { calls.push([done, how]); return 'Done.'; } } });
  const s = session;
  const a = coach.send({ summary: 'A' });
  coach.release(a);                                                     // the page spoke its own cue for A
  s.user(2, 'what?');
  s.audio(2);                                                           // one reply for A and the words: heard
  assert.deepEqual(s.volumes, []);
  s.text(2, 'Eight reps, nice.');
  assert.equal(cues[0].user, 'what?');
  s.played();
  s.user(4, 'eight, nine, ten');                                        // counting out loud: the agent stays quiet
  assert.equal(coach.send({ summary: 'B' }), null);
  t.mock.timers.tick(USER_MS - 1);
  assert.equal(s.sent.length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(s.sent.map(m => m.summary), ['A', 'B']);
  const b = coach.inFlight.marks;
  coach.release(b);                                                     // the page spoke its own cue for B
  s.audio(5);                                                           // B's late reply: the words expired, it answers
  assert.deepEqual(s.volumes, [0]);                                     // B alone, and is not heard
  // a tool the agent calls in it (live: "the user said they are done" read as an answer) is not the user's answer
  assert.equal(await s.tool(5, 'answer_set_end', { done: true }), 'Done.');
  assert.deepEqual(calls, [[true, { byUser: false, words: null }]]);
  s.text(5, 'Set done, nice.');
  assert.equal(cues[1].marks, b);
  assert.equal(cues[1].user, null);

  s.user(9, 'ten');                                                     // words long before a message: the same
  t.mock.timers.tick(5 * 60000);
  const c = coach.send({ summary: 'C' });
  assert.ok(c);
  assert.equal(await s.tool(10, 'answer_set_end', { done: true }), 'Done.');
  assert.deepEqual(calls.at(-1), [true, { byUser: false, words: null }]);
  s.text(10, 'Set two, done.');
  assert.equal(cues[2].marks, c);
  assert.equal(cues[2].user, null);
  assert.deepEqual(said, []);
  await coach.stop();
});

test("duplex: a client tool runs the page's function, and the agent's words after it are the answer", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const said = [], calls = [], errors = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  await coach.start({
    onSaid: x => said.push(x), onError: m => errors.push(m),
    tools: {
      set_exercise: ({ exercise }, how) => { calls.push([exercise, how]); return `Counting ${exercise} now.`; },
      answer_set_end: async ({ done }, how) => { calls.push([done, how]); if (done == null) throw new Error('no answer'); },
    },
  });
  const s = session;
  s.user(4, "I'm doing squats");
  assert.equal(await s.tool(4, 'set_exercise', { exercise: 'squat' }), 'Counting squat now.');
  assert.deepEqual(calls, [['squat', { byUser: true, words: "I'm doing squats" }]]);
  assert.equal(coach.send({ summary: 'A' }), null);
  t.mock.timers.tick(USER_MS + 500);                                    // the tool ran: the answer is still coming
  assert.equal(s.sent.length, 0);
  s.audio(4);
  s.text(4, 'Squats, got it.');
  assert.deepEqual(said, [{ text: 'Squats, got it.', user: "I'm doing squats" }]);
  s.played();
  t.mock.timers.tick(GAP_MS);
  assert.deepEqual(s.sent.map(m => m.summary), ['A']);
  s.text(5, 'reply to A');

  s.user(7, 'done');                                                    // words first, then the tool, then more words
  s.text(7, 'Nice set.');
  assert.equal(await s.tool(7, 'answer_set_end', { done: true }), 'Done.');   // (nothing returned: the client needs a result)
  assert.equal(coach.send({ summary: 'B' }), null);
  s.text(7, 'Rest a minute.');
  s.audio(7); s.played();
  t.mock.timers.tick(GAP_MS);
  assert.deepEqual(said.slice(1).map(x => x.text), ['Nice set.', 'Rest a minute.']);
  assert.deepEqual(s.sent.map(m => m.summary), ['A', 'B']);
  // the agent calls a tool in its reply to a tracker message ("the user said they are done"): not the user's answer
  assert.equal(await s.tool(8, 'answer_set_end', { done: true }), 'Done.');
  assert.deepEqual(calls.at(-1), [true, { byUser: false, words: null }]);
  s.text(8, 'reply to B');
  s.audio(8); s.played();

  await assert.rejects(s.tool(9, 'answer_set_end', {}), /no answer/);   // the client tells the agent it failed
  assert.match(errors[0], /answer_set_end failed \(no answer\)/);
  await coach.stop();
});

test('duplex: the user talking over a cue holds the next message for their words; a transcript that is not the user is ignored', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const done = [], said = [], heard = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  await coach.start({ onDone: (m, how) => done.push([m, how]), onSaid: x => said.push(x), onUser: x => heard.push(x) });
  const s = session;
  const a = coach.send({ summary: 'A' });
  coach.send({ summary: 'B' });
  s.audio(2);
  s.interrupt(3);                                                       // the user talks over A's reply
  assert.deepEqual(done, [[a, 'cut']]);
  assert.equal(s.sent.length, 1);                                       // B waits for their words
  s.user(3, 'wait, how many?');
  s.audio(3);
  s.text(3, 'You were at eight.');
  assert.deepEqual(said.map(x => x.user), ['wait, how many?']);
  s.played();
  t.mock.timers.tick(GAP_MS);
  assert.deepEqual(s.sent.map(m => m.summary), ['A', 'B']);
  s.text(4, 'reply to B');
  s.user(5, '...');                                                     // a noise
  s.user(6, JSON.stringify(s.sent[1]));                                 // a message of the page's, echoed back
  assert.deepEqual(heard, ['wait, how many?']);
  assert.equal(coach.userBusy, false);

  const quiet = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false });   // not duplex: an interruption holds nothing
  await quiet.start();
  quiet.send({ summary: 'C' }); session.audio(1); session.interrupt(2);
  quiet.send({ summary: 'D' });
  assert.deepEqual(session.sent.map(m => m.summary), ['C', 'D']);
  await quiet.stop();
  await coach.stop();
});

test("duplex: a cue the page's own voice spoke, heard back through the microphone, is not the user; their short answers are", async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const heard = [];
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  await coach.start({ onUser: x => heard.push(x) });
  const s = session;
  coach.echo("That's 8 reps of Squat. Done with this set?");            // the engine's question, in the page's voice
  s.user(3, 'thats eight reps of squat done with this set');            // (transcribed: a number in words is one word off)
  s.user(4, "That's 8 reps of squat.");
  assert.deepEqual(heard, []);
  assert.equal(coach.userBusy, false);                                  // nothing holds the next message
  s.user(5, 'Done.');                                                   // the user's answer: words of the question too
  s.user(6, 'not yet, one more');
  assert.deepEqual(heard, ['Done.', 'not yet, one more']);
  t.mock.timers.tick(ECHO_MS);                                          // long after: the same words are the user's
  s.user(7, "That's 8 reps of squat.");
  assert.equal(heard.length, 3);
  await coach.stop();

  assert.equal(echoOf('Step back so I can see your whole body', 'Step back so I can see your whole body.'), true);
  assert.equal(echoOf("I'm doing squats", 'Squat. I\'m counting.'), false);
  assert.equal(echoOf('squats', 'Squat. I\'m counting.'), false);
  assert.equal(echoOf('Squat.', 'Squat.'), true);
  const plain = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false });   // not duplex: nothing to hear back
  plain.echo('Great form, keep it up.');
  assert.deepEqual(plain.echoes, []);
});

test('the silent microphone: one silent source for every session, and overlapping starts put getUserMedia back', async () => {
  let contexts = 0;
  globalThis.AudioContext = class {
    constructor() { contexts += 1; }
    createConstantSource() { return { offset: { value: 1 }, connect() {}, start() {} }; }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{ clone: () => ({ silent: true }) }] } }; }
  };
  globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } };
  const real = async constraints => ({ real: constraints });
  navigator.mediaDevices = { getUserMedia: real };
  const got = [];
  setup = async opts => {                                              // the client in voice mode asks twice
    if (opts.textOnly) return;
    got.push(await navigator.mediaDevices.getUserMedia({ audio: true }));
    got.push(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } }));
  };
  const first = later(), second = later();
  hold = first;
  const coaches = [new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false }), new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false })];
  const one = coaches[0].start();
  await new Promise(r => setImmediate(r));
  hold = second;
  const two = coaches[1].start();
  await new Promise(r => setImmediate(r));
  first.open();
  await one;
  assert.notEqual(navigator.mediaDevices.getUserMedia, real);          // the second start is still on its way
  assert.deepEqual(await navigator.mediaDevices.getUserMedia({ video: true, audio: false }), { real: { video: true, audio: false } });
  second.open(); hold = null;
  await two;
  assert.equal(navigator.mediaDevices.getUserMedia, real);
  assert.equal(got.length, 4);
  assert.ok(got.every(s => s.tracks?.[0]?.silent));
  assert.equal(contexts, 1);
  setup = async () => {};
  for (const c of coaches) await c.stop();
});

test('duplex: the real microphone with echo cancellation; refused, the session goes on muted with a silent input', async () => {
  const asked = [];
  let refuse = null;
  const real = async constraints => {
    asked.push(constraints);
    if (refuse) throw Object.assign(new Error('Permission denied'), { name: refuse });
    return { real: constraints };
  };
  navigator.mediaDevices = { getUserMedia: real };
  const got = [];
  setup = async opts => {                                              // the client in voice mode asks twice
    if (opts.textOnly) return;
    got.push(await navigator.mediaDevices.getUserMedia({ audio: true }));
    got.push(await navigator.mediaDevices.getUserMedia({ audio: { voiceIsolation: true, sampleRate: { ideal: 16000 } } }));
  };
  const coach = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  assert.equal(coach.mic, 'connecting');
  await coach.start();
  assert.deepEqual(asked, [
    { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
    { audio: { voiceIsolation: true, sampleRate: { ideal: 16000 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
  ]);
  assert.ok(got.every(x => x.real));
  assert.equal(navigator.mediaDevices.getUserMedia, real);             // put back
  assert.equal(coach.mic, 'on');
  assert.equal(session.micMuted, false);                               // the user is heard
  assert.equal(await coach.setMicMuted(true), 'muted');
  assert.equal(session.micMuted, true);
  assert.equal(await coach.setMicMuted(false), 'on');
  assert.equal(session.micMuted, false);
  assert.equal(asked.length, 2);                                       // (it was open all along: not asked again)
  await coach.stop();

  // muted by the user before the session: the microphone is not opened (nothing of it can go out); Unmute opens it
  asked.length = 0; got.length = 0;
  const muted = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true, muted: true });
  await muted.start();
  assert.equal(asked.length, 0);
  assert.ok(got.every(x => x.tracks?.[0]?.silent));
  assert.equal(muted.mic, 'muted');
  assert.equal(session.micMuted, true);
  assert.equal(await muted.setMicMuted(false), 'on');
  assert.deepEqual(asked, [{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }]);
  assert.ok(session.input.real);
  assert.equal(session.micMuted, false);
  assert.equal(await muted.setMicMuted(true), 'muted');
  assert.equal(await muted.setMicMuted(false), 'on');
  assert.equal(asked.length, 1);                                       // opened once
  await muted.stop();

  asked.length = 0; got.length = 0;
  refuse = 'NotAllowedError';                                          // the user said no (or the frame has no permission)
  const denied = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true });
  await denied.start();
  assert.equal(asked.length, 1);                                       // asked once, not again in the same start
  assert.ok(got.every(x => x.tracks?.[0]?.silent));
  assert.equal(denied.mic, 'refused');
  assert.equal(denied.micWhy, 'the microphone was not allowed');
  assert.equal(session.micMuted, true);
  assert.equal(await denied.setMicMuted(false), 'refused');            // there is nothing to unmute
  assert.equal(session.micMuted, true);
  assert.equal(denied.connected, true);                                // the session goes on
  await denied.stop();

  asked.length = 0;                                                    // started muted, then refused at Unmute
  const later = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: false, listen: true, muted: true });
  await later.start();
  assert.equal(asked.length, 0);
  assert.equal(await later.setMicMuted(false), 'refused');
  assert.equal(later.micWhy, 'the microphone was not allowed');
  assert.equal(session.micMuted, true);
  await later.stop();

  asked.length = 0;
  const text = new ElevenCoach({ agentId: 'agent_0123456789abcdefghijklmnopqr', textOnly: true, listen: true });   // text only: no microphone at all
  await text.start();
  assert.equal(text.mic, 'off');
  assert.equal(asked.length, 0);
  await text.stop();
  setup = async () => {};
});
