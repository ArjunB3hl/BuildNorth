// The coach as an ElevenLabs agent (the Agents platform): the agent's LLM writes each cue and its voice speaks it, in
// place of Claude over MCP plus the page's own voice. The page sends each coaching event as a user message (the same
// JSON Claude gets from wait_for_event). The agent is public but only answers pages on this machine (its allowlist), so
// no key is needed here.
//
// One message is in flight at a time: the agent answers several quick user messages with one reply, so events that come
// while a reply is on its way wait, and go together as one message ("give one cue for the most important"). The next
// message goes when the reply's text arrives, when an interruption cut the reply off, or CAP_MS after it went; with the
// agent's voice, never while it is speaking (it stops mid-sentence for a message that comes while its voice plays, and
// a reply's text arrives while the voice still has seconds to go, or just before it starts; a pause in its sound
// shorter than GAP_MS is not its end). Replies
// are told from each other by the agent's event ids (one id per reply, growing): a reply that began before a message
// went out is never that message's reply. So at the cap, if nothing of the reply has come yet, the next message waits
// a little longer (until the agent has said nothing for GRACE_MS, or that reply's text came): a reply that begins
// meanwhile is the late one's. Only a reply later still is taken as the next message's.
//
// Duplex (`listen`, with the agent's voice): the user talks to the agent through the microphone, and the agent answers
// their words on its own, with no message of the page's to answer. The user's words come with an event id too (their
// transcript), and the reply to them carries that id or a later one. So the first reply from that id on that no
// message in flight can claim is the answer to the user's words: shown (onSaid), never a tracker message's reply. A
// reply the message in flight can claim answers both (the agent saw the message and the words together). Words that
// no reply has begun to answer within USER_MS were not meant for the agent (counting out loud): they expire, so a later
// reply, to a tracker message, never answers them. While the user is talking or being answered, the next message waits
// (USER_MS for an answer to begin, then until its text has come and played out), so that a cue neither cuts the answer
// off nor takes it. The agent acts on the user's words through the page's client tools (`tools`): what a tool returns
// goes back to the agent, which then says a few words. A tool call carries the id of the reply it is part of, so the
// tool is told whether it answers the user's words (`byUser`): the agent also calls them on its own, reading a tracker
// event ("the user said they are done") as the user's answer. A cue the page's own voice speaks can come back through
// the microphone (echo): the page says what it speaks (echo()), and a transcript that repeats it is not the user.
//
//   const coach = new ElevenCoach({ agentId, llm: 'gemini-2.5-flash', textOnly: false, listen: true, muted: false })
//   await coach.start({ onCue: ({ text, marks, user }) => ..., onDispatch: (marks, events) => ..., onReply: marks => ...,
//                       onDone: (marks, how) => ..., onError, onDisconnect, keepAlive: () => true,
//                       onUser: text => ..., onSaid: ({ text, user }) => ...,
//                       tools: { set_exercise: async ({ exercise }, { byUser, words }) => 'Counting squats now.' } })
//                          // onReply: the reply started (its voice, or in text-only mode its text): with a voice, the
//                          // text comes later than the sound. onDone: that message is finished with: 'replied' (its
//                          // text came and its voice has played out), 'cut' (an interruption cut it off) or 'cap' (no
//                          // reply in CAP_MS). keepAlive: while it says so, the agent is kept from speaking up in a rest.
//                          // onUser: the user's words (duplex). onSaid: what the agent said that answers no message of
//                          // the page's (the user's words, or on its own); `user` on it and on onCue: the user's words
//                          // that reply answers
//   coach.send(event)      // marks: t0 (sent), firstText, text (whole reply), audio (first audio), on performance.now();
//                          // null when the event waits (for the reply in flight, the user's words being answered, or for
//                          // the session to connect: coach.connected): onDispatch says when it goes
//   coach.release(marks)   // the caller gave up waiting for that reply (it spoke its own cue): with the agent's voice the
//                          // reply, if it still comes, is not heard; the next message still waits for it (up to the
//                          // cap, as above)
//   coach.withdraw(event)  // the caller gave up on an event that still waits (it spoke its own cue): it does not go
//   coach.mic              // duplex: 'connecting', 'on', 'muted' (the user's toggle) or 'refused' (coach.micWhy says
//                          // why: the session goes on without it); 'off' without duplex
//   await coach.setMicMuted(m)   // the user's mute toggle: the new coach.mic. A session started muted (`muted`) never
//                          // opened the microphone; unmuting opens it (the browser may ask)
//   coach.echo(text)       // duplex: the page's own voice is saying this (an engine cue): not the user, if it is heard
//   coach.userBusy         // the user is talking, or being answered: the caller's own cue would talk over it
//   coach.talking          // with the agent's voice: a reply is still playing, or about to (the next message waits)
//   await coach.stop()     // also while start() is connecting: the session then ends as soon as it is up; what still
//                          // waits is dropped
const DIR = '/web/vendor/elevenlabs-client-1.27.0';
let loading = null;

/** The ElevenLabs browser client (one vendored file, window.ElevenLabsClient), loaded on first use. */
export function loadClient() {
  loading ??= new Promise((resolve, reject) => {
    if (window.ElevenLabsClient) return resolve(window.ElevenLabsClient);
    const s = document.createElement('script');
    s.src = `${DIR}/lib.iife.js`;
    s.onload = () => resolve(window.ElevenLabsClient);
    s.onerror = () => { loading = null; reject(new Error('could not load the ElevenLabs client')); };
    document.head.append(s);
  });
  return loading;
}

/** One silent input for every session (a voice-mode session asks for audio twice, and an AudioContext lives until it is
 * closed): each request gets its own copy of the track, since the client stops the tracks it was given. */
let silence = null;
function silentStream() {
  if (!silence) {
    const ctx = new AudioContext();
    const source = ctx.createConstantSource();
    source.offset.value = 0;
    const out = ctx.createMediaStreamDestination();
    source.connect(out);
    source.start();
    silence = out.stream;
  }
  return new MediaStream(silence.getAudioTracks().map(t => t.clone()));
}

/** The microphone for duplex: the agent's own voice comes out of the same speakers, so it must not hear itself. */
export const VOICE_INPUT = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** Why the microphone could not be opened, in plain words (the session goes on without it). */
export function micWhy(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'the microphone was not allowed';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotSupportedError') return 'no microphone was found';
  if (name === 'NotReadableError' || name === 'AbortError') return 'the microphone could not be opened (in use elsewhere?)';
  return `the microphone could not be opened (${e?.message || e})`;
}

/**
 * The client asks for a microphone in voice mode. While it starts, an audio-only request gets either a silent input
 * (no duplex: the user sees no microphone prompt) or, for a session that listens, the real microphone with echo
 * cancellation, noise suppression and gain control on; if that is refused (or there is none), a silent input, so the
 * session goes on with the chips and buttons. Camera requests are untouched. Starts may overlap (a coach replaced
 * while it connects): the patch stays until the last of them is done, and gives the microphone while any of them
 * listens (a session that does not listen keeps it muted).
 */
let patched = null;            // {starts, listening, refused, restore}
async function withMic(listen, run) {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return { result: await run(), refused: null };
  if (!patched) {
    const own = Object.hasOwn(md, 'getUserMedia'), before = md.getUserMedia, real = before.bind(md);
    const p = { starts: 0, listening: 0, refused: null, restore: () => { if (own) md.getUserMedia = before; else delete md.getUserMedia; } };
    md.getUserMedia = async constraints => {
      if (!constraints?.audio || constraints?.video) return real(constraints);
      if (!p.listening || p.refused) return silentStream();          // (refused once: not asked again in this start)
      const asked = typeof constraints.audio === 'object' ? constraints.audio : {};
      try { return await real({ audio: { ...asked, ...VOICE_INPUT } }); } catch (e) {
        p.refused = micWhy(e);
        return silentStream();
      }
    };
    patched = p;
  }
  const p = patched;
  p.starts += 1;
  if (listen) p.listening += 1;
  try {
    const result = await run();
    return { result, refused: listen ? p.refused : null };
  } finally {
    if (listen) p.listening -= 1;
    if (--p.starts === 0) { p.restore(); if (patched === p) patched = null; }
  }
}

/** Keeps the agent from speaking up on its own in a rest between sets (its turn timeout is at most 30 s). */
const ACTIVITY_MS = 15000;
/** The longest a message waits for its reply before the next one goes: a reply that never comes cannot hold the coach. */
export const CAP_MS = 10000;
/** After the cap, how long the agent must say nothing before the next message goes, when nothing of the late reply has
 * come: a reply that begins within it is the late message's, not the next one's (about the page's fallback time). */
export const GRACE_MS = 3000;
/** With the agent's voice, a reply has played out once the client has been back to listening this long (a gap inside a
 * reply, while its audio is still arriving, is far shorter). */
export const QUIET_MS = 1500;
/** With the agent's voice, how long the client must stay back in listening mode, while a reply is still playing, before
 * the next message goes: a shorter gap is its playback running dry while its audio still arrives (after a client tool,
 * its text comes before its voice), and a message sent into that gap would cut the rest of the reply off. */
export const GAP_MS = 500;
/** Duplex: how long the next message waits for an answer to the user's words to begin (the agent answers in well under a
 * second; it stays quiet for words not meant for it, such as counting out loud, and then the cues must not wait long). */
export const USER_MS = 2000;
/** With the agent's voice, the longest the next message waits for a reply to play out (a workout summary takes ~10 s). */
export const TALK_MS = 15000;
/** ... and for its voice to start, when its text came first (live, after a client tool: 0.17 s). */
export const START_MS = 1000;
/** Duplex: how long a cue that the page's own voice spoke can still come back through the microphone as "the user". */
export const ECHO_MS = 20000;
const hasWords = text => /[\p{L}\p{N}]/u.test(text || '');
const wordsOf = text => (text || '').toLowerCase().replace(/['’]/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * A transcript that repeats (most of) a cue the page's voice said: the microphone heard the speaker. Three words or
 * more: at least 80% of them are the cue's. Fewer: only the whole cue, word for word, since the user's own short
 * answers ("done", "squats") are often words of the question that was just asked.
 */
export function echoOf(transcript, cue) {
  const w = wordsOf(transcript), c = wordsOf(cue);
  if (!w.length || !c.length) return false;
  if (w.length < 3) return w.join(' ') === c.join(' ');
  const set = new Set(c);
  return w.filter(x => set.has(x)).length >= 0.8 * w.length;
}

export class ElevenCoach {
  constructor({ agentId, llm = null, textOnly = false, listen = false, muted = false }) {
    Object.assign(this, { agentId, llm, textOnly, listen: listen && !textOnly });
    // a message: {marks, event, events, after (the last reply id seen when it went), replyId (its reply's, once one
    // came), late, text, done, user (the user's words its reply answers too)}; an answer to the user's words alone has
    // own: true (and no event)
    this.inFlight = null;          // the message whose reply is on its way (its text has not come)
    this.playing = null;           // with the agent's voice: the last reply whose text came, while its voice may still play
    this.givenUp = null;           // the last message given up on (cut off, or no reply in CAP_MS): its reply may still come
    this.held = null;              // ... and while it is still due (GRACE_MS after the cap), the next message waits for it
    this.byId = new Map();         // the agent's event ids -> the message they answer
    this.lastId = 0;               // the last reply id seen
    this.waiting = [];             // events that came meanwhile, sent together when the reply in flight ends
    this.said = null;              // duplex: the user's last words {id, text, at, answered}
    this.userHold = false;         // ... the next message waits: the user is talking or being answered
    this.tooling = false;          // ... a client tool ran: the agent's words after it are still the answer
    this.talking = false;          // with the agent's voice: a reply whose text came is still playing, or about to
    this.toolTurn = null;          // the reply the client tool call being run is part of
    this.sentText = new Set();     // the messages sent (a transcript that repeats one is not the user's words)
    this.conversation = null;
    this.mode = 'listening';       // the client's: 'speaking' while the agent's voice plays
    this.volume = 1;               // the agent's voice level asked for (setVolume)
    this.applied = 1;              // ... and the one set on the client
    this.hushed = null;            // the late reply whose voice is turned down (the caller spoke its own cue)
    this.micRefused = null;        // duplex: why the microphone could not be opened
    this.userMuted = !!muted;      // duplex: the user's mute toggle (muted at the start: the microphone is not opened)
    this.micOpen = false;          // ... the session's input is the real microphone (else a silent one)
    this.echoes = [];              // ... the cues the page's own voice spoke in the last ECHO_MS {text, timer}
    this.tools = {};
    this.stopped = false;
    for (const k of ['onCue', 'onDispatch', 'onReply', 'onDone', 'onError', 'onUser', 'onSaid']) this[k] = () => {};
  }

  start({ onCue, onDispatch, onReply, onDone, onError, onUser, onSaid, tools, onDisconnect = () => {}, keepAlive = () => true } = {}) {
    for (const [k, f] of Object.entries({ onCue, onDispatch, onReply, onDone, onError, onUser, onSaid })) if (f) this[k] = f;
    if (tools) this.tools = tools;
    this.started ??= this.connect(onDisconnect, keepAlive);
    return this.started;
  }

  async connect(onDisconnect, keepAlive) {
    const { Conversation } = await loadClient();
    if (this.stopped) return null;
    const clientTools = Object.fromEntries(Object.entries(this.tools).map(([name, run]) => [name, params => this.tool(name, run, params)]));
    // muted by the user: the session starts with a silent input, so the microphone is not even opened and nothing of it
    // goes out (the client streams its input from the moment it is set up, before a mute could be applied)
    const hear = this.listen && !this.userMuted;
    const { result: conversation, refused } = await withMic(hear, () => Conversation.startSession({
      agentId: this.agentId,
      textOnly: this.textOnly,
      // WebSocket, voice too: a WebRTC connection carries no Origin header, and the agent only answers this machine's pages
      connectionType: 'websocket',
      ...(this.llm ? { overrides: { agent: { prompt: { llm: this.llm } } } } : {}),
      libsampleratePath: `${DIR}/libsamplerate.worklet.js`,
      clientTools,
      onConnect: ({ conversationId }) => { this.conversationId = conversationId; },
      // every event as it arrives, before the client plays an audio chunk: only here does a chunk carry its reply's id
      onIncomingEvent: ev => this.incoming(ev),
      onAgentChatResponsePart: part => { const m = this.owner(part?.event_id, 'text'); if (m) m.marks.firstText ??= performance.now(); },
      onMessage: ({ source, message, event_id: id }) => {
        if (source === 'ai') this.reply(id, message);
        else if (source === 'user') this.heard(id, message);
      },
      onInterruption: ({ event_id: id }) => this.interrupted(id),
      onModeChange: ({ mode }) => {
        if (this.stopped) return;
        this.mode = mode;
        clearTimeout(this.gapTimer);                           // (its voice goes on: that was a gap)
        if (mode === 'speaking' && !this.hushed) this.talk();
        // what waited for the voice goes; while a reply plays, once the client has stayed back in listening GAP_MS
        if (mode === 'listening') { if (this.talking) this.gapTimer = setTimeout(() => this.quiet(), GAP_MS); else this.quiet(); }
        this.waitQuiet();
      },
      onError: (message, context) => this.onError(String(message), context),
      onDisconnect: details => { this.clearTimers(); onDisconnect(details); },
    }));
    if (this.stopped) { await conversation.endSession(); return null; }     // stopped while it connected
    this.conversation = conversation;
    this.micRefused = refused;
    this.micOpen = hear && !refused;
    this.applyMic();
    this.apply(this.volume);
    this.activity = setInterval(() => { if (keepAlive()) this.conversation?.sendUserActivity(); }, ACTIVITY_MS);
    this.next();                                                            // what was sent while it connected
    return this.conversationId;
  }

  /** The session is up (until stop()): before that, what is sent waits for it. */
  get connected() { return !!this.conversation; }

  get mic() {
    if (!this.listen) return 'off';
    if (!this.conversation) return 'connecting';
    return this.micRefused ? 'refused' : this.userMuted ? 'muted' : 'on';
  }

  get micWhy() { return this.micRefused; }

  /**
   * The user's mute toggle: resolves to the new coach.mic. A session that started muted has a silent input: unmuting
   * opens the microphone now (the browser may ask; the client asks for it with echo cancellation, noise suppression and
   * gain control on, as at the start), and if that is refused the session goes on without it ('refused').
   */
  async setMicMuted(muted) {
    this.userMuted = !!muted;
    const conversation = this.conversation;
    if (!this.userMuted && this.listen && conversation && !this.micOpen && !this.micRefused) {
      try {
        await conversation.changeInputDevice({});
        this.micOpen = true;
      } catch (e) { this.micRefused = micWhy(e); }
      if (this.conversation !== conversation) return this.mic;              // (stopped meanwhile)
    }
    this.applyMic();
    return this.mic;
  }

  /** A voice session hears the user only in duplex, with a microphone, while the user has not muted it. */
  applyMic() {
    if (this.textOnly || !this.conversation) return;
    this.conversation.setMicMuted(!this.listen || !!this.micRefused || this.userMuted);
  }

  get userBusy() { return this.userHold; }

  /** Nothing holds the next message: no reply on its way or due, the user not being answered, the agent not talking. */
  get free() {
    return !this.inFlight && !this.held && !this.userHold && !this.talking && !!this.conversation
      && (this.textOnly || this.mode !== 'speaking' || !!this.hushed);     // (a late reply turned down: nobody hears it)
  }

  send(event) {
    if (!this.free) { this.waiting.push(event); return null; }
    const marks = this.dispatch([...this.waiting, event]);                // (nothing waits unless a send failed)
    this.waiting = [];
    return marks;
  }

  /** An event that still waits does not go after all (the caller spoke its own cue for it): true if it was waiting. */
  withdraw(event) {
    const i = this.waiting.indexOf(event);
    if (i < 0) return false;
    this.waiting.splice(i, 1);
    return true;
  }

  /** One message for the agent: an event, or the events that came meanwhile. If it cannot go, it throws and nothing changed. */
  dispatch(events) {
    const message = events.length === 1 ? events[0] : {
      summary: `${events.length} things happened while you were answering. Give one short cue for the most important ` +
        'one, and skip what is no longer useful.',
      events,
    };
    const text = JSON.stringify(message);
    this.conversation.sendUserMessage(text);
    this.sentText.add(text);
    if (this.sentText.size > 20) this.sentText.delete(this.sentText.values().next().value);
    const marks = { t0: performance.now() };
    // (sent over the agent's voice, which it then stops: that interruption is not the user talking)
    this.inFlight = { marks, event: message, events, after: this.lastId, late: false, text: null, done: false,
      overVoice: !this.textOnly && this.mode === 'speaking' };
    this.capTimer = setTimeout(() => this.giveUp('cap'), CAP_MS);
    this.onDispatch(marks, events);
    return marks;
  }

  /** What waited goes, as one message, once nothing is in flight. */
  next() {
    if (!this.free || this.stopped || !this.waiting.length) return;
    try { this.dispatch(this.waiting); this.waiting = []; } catch (e) { this.onError(`could not send to the agent (${e.message})`); }
  }

  release(marks) {
    const m = [this.inFlight, this.playing, this.givenUp].find(x => x?.marks === marks);
    if (m && m.marks.audio == null) m.late = true;                          // (one already heard stays heard)
  }

  /**
   * The message an agent event answers (its text, or a chunk of its voice), by its event id: a reply keeps one id and
   * ids grow, so a reply that began before the message in flight went out answers an earlier message. (Without an id:
   * the message in flight.) In duplex, the first reply from the user's words on answers them: as well as the message in
   * flight if that can claim it, else on its own (an answer, never an earlier message's late reply).
   */
  owner(id, kind) {
    const known = id != null && this.byId.get(id);
    if (known) return known;
    const open = m => !!m && (kind === 'audio' ? m.marks.audio == null : m.text == null);
    const f = this.inFlight;
    const s = this.said && !this.said.answered && id != null && id >= this.said.id ? this.said : null;
    let m = null;
    if (open(f) && (id == null || id > f.after)) m = f;
    else if (s) m = { marks: { t0: s.at }, own: true, late: false, text: null, done: false };
    // began before it went: an earlier message's (and if none is waiting for its reply, the ids are not what we thought)
    else if (id != null) m = [this.playing, this.givenUp].find(open) ?? (open(f) ? f : null);
    if (s && m) {
      s.answered = true;
      m.user = s.text;
      // an answer of its own holds the next message until its text; one that a message claimed, that message does
      if (m.own) this.waitUser(CAP_MS); else this.releaseUser();
    }
    if (m && id != null) { this.byId.set(id, m); m.replyId ??= id; if (kind === 'audio') m.audioId ??= id; }
    return m;
  }

  /** Every event from the agent, in order: the last reply id seen, and each chunk of its voice before it plays. A reply
   * newer than the message held for keeps the hold up while it comes (it is that message's: see giveUp). */
  incoming(ev) {
    if (this.stopped) return;
    const id = ev?.audio_event?.event_id ?? ev?.agent_response_event?.event_id ?? ev?.text_response_part?.event_id;
    if (Number.isFinite(id)) {
      this.lastId = Math.max(this.lastId, id);
      if (this.held && id > this.held.after) this.waitGrace();
    }
    if (ev?.type === 'audio' && ev.audio_event?.audio_base_64) this.audio(ev.audio_event.event_id);
    // (before the client runs the tool: which reply it is part of, so the tool knows if it answers the user's words)
    if (ev?.type === 'client_tool_call') this.toolTurn = this.owner(ev.client_tool_call?.event_id, 'text');
  }

  /** A chunk of the agent's voice, before the client plays it: a reply's first starts it (onReply). A late reply is not
   * heard (the caller spoke its own cue for it), unless it answers the user: the voice stays down until a reply to be
   * heard starts. */
  audio(id) {
    if (this.stopped) return;
    clearTimeout(this.quietTimer);
    clearTimeout(this.gapTimer);
    const m = this.owner(id, 'audio');
    if (m?.marks.audio != null) { if (!this.hushed) this.talk(); return; }
    // The greeting and other replies without a tracker message still own the speaker. Hold new prompts through
    // gaps in their audio too, even when their transcript has not arrived yet.
    if (m?.late && !m.user) this.hush(m); else { this.unhush(); this.talk(); }
    if (!m) return;
    m.marks.audio = performance.now();
    if (this.playing && this.playing !== m) { this.finish(this.playing); this.playing = null; }   // a newer reply
    if (!m.own) this.onReply(m.marks);
  }

  /** The agent's text for a reply: the cue. The message in flight ends there, and what waited goes. */
  reply(id, text) {
    if (this.stopped) return;
    const m = this.owner(id, 'text');
    const after = this.tooling;                                           // words after a client tool ran: the answer's
    this.tooling = false;
    // with the agent's voice, its text comes while the voice still plays, or just before it starts: the next message
    // waits until it has played out (not for a late reply's, turned down: nobody hears it)
    if (!this.textOnly && !this.hushed && !(m?.late && !m.user)) {
      if (this.mode === 'speaking') this.talk();
      else if (m && m.marks.audio == null) this.talk(START_MS);
    }
    if (!m || m.text != null) {
      // the agent spoke on its own, or more of a reply (its words after a tool): shown all the same
      this.onSaid({ text, user: m?.user ?? null });
      if (after) this.releaseUser();
      return;
    }
    m.text = text;
    m.marks.text = performance.now();
    m.marks.firstText ??= m.marks.text;
    if (m.own) {                                                          // the answer to the user's words
      this.onSaid({ text, user: m.user });
      this.releaseUser();
      return;
    }
    if (this.textOnly) this.onReply(m.marks);
    this.onCue({ text, event: m.event, marks: m.marks, user: m.user ?? null });
    if (after) this.releaseUser();
    if (m !== this.inFlight) { if (m === this.held) this.unhold(); return; }   // a reply given up on, come after all
    clearTimeout(this.capTimer);
    this.inFlight = null;
    if (this.textOnly) this.finish(m);
    else {
      if (this.playing && this.playing !== m) this.finish(this.playing);
      this.playing = m;
      this.waitQuiet();                                                    // (its voice may have played out already)
    }
    this.next();
  }

  /**
   * Duplex: the user's words (their final transcript). The agent answers them on its own; the next message waits for
   * that answer to begin (USER_MS) and then for its text. Words no reply has begun to answer by then were not meant
   * for the agent (it stays quiet for counting out loud): they expire, so that a later reply, to a message of the
   * page's, is not taken for their answer (nor a client tool it calls for the user's, nor its late voice for one to be
   * heard). A transcript that only repeats a message the page sent or a cue its voice just spoke, or has no words
   * ("..." for a noise), is not the user speaking.
   */
  heard(id, text) {
    if (this.stopped) return;
    if (!hasWords(text) || this.sentText.has(text) || this.isEcho(text)) return;
    const said = this.said = { id: Number.isFinite(id) ? id : this.lastId + 1, text, at: performance.now(), answered: false };
    clearTimeout(this.saidTimer);
    this.saidTimer = setTimeout(() => { if (this.said === said && !said.answered) this.said = null; }, USER_MS);
    this.onUser(text);
    this.waitUser(USER_MS);
  }

  /** Duplex: the page's own voice speaks `text` (an engine cue). Its sound can reach the microphone, the Mac's voice
   * above all (it plays outside the browser, where echo cancellation cannot take it out): what comes back is not the
   * user's words. */
  echo(text) {
    if (!this.listen || !hasWords(text)) return;
    const e = { text, timer: setTimeout(() => { this.echoes = this.echoes.filter(x => x !== e); }, ECHO_MS) };
    this.echoes.push(e);
  }

  isEcho(text) { return this.echoes.some(e => echoOf(text, e.text)); }

  /** The agent calls a client tool, and says a few words once it has the result: `byUser`, whether that reply answers the
   * user's words (else the agent acts on its own). */
  async tool(name, run, params) {
    const turn = this.toolTurn;
    this.toolTurn = null;
    this.tooling = true;
    if (this.listen) this.waitUser(CAP_MS);
    try {
      const out = await run(params ?? {}, { byUser: !!turn?.user, words: turn?.user ?? null });
      return out == null ? 'Done.' : String(out);
    } catch (e) {
      this.onError(`the client tool ${name} failed (${e?.message || e})`);
      throw e;
    }
  }

  talk(ms = TALK_MS) {
    this.talking = true;
    clearTimeout(this.talkTimer);
    this.talkTimer = setTimeout(() => this.quiet(), ms);
  }

  /** The agent's voice has stopped (the client is back to listening), or will not come: what waits can go. */
  quiet() {
    clearTimeout(this.talkTimer); clearTimeout(this.gapTimer);
    this.talking = false;
    this.next();
  }

  waitUser(ms) {
    this.userHold = true;
    clearTimeout(this.userTimer);
    this.userTimer = setTimeout(() => this.releaseUser(), ms);
  }

  releaseUser() {
    clearTimeout(this.userTimer);
    if (!this.userHold) return;
    this.userHold = false;
    this.next();
  }

  /** The agent was interrupted: the client drops the audio of every reply from before `id`. In duplex that is the user
   * talking over it (unless a message of the page's went over its voice): their words come next, and the next message
   * waits for them. */
  interrupted(id) {
    const cut = m => m?.audioId != null && m.audioId < id;
    if (cut(this.playing)) { this.finish(this.playing, 'cut'); this.playing = null; }
    if (this.listen && !(this.inFlight?.overVoice && this.inFlight.replyId == null)) this.waitUser(USER_MS);
    if (cut(this.inFlight)) this.giveUp('cut');                            // its text will not come
    if (cut(this.held)) this.unhold();
    this.quiet();                                // an explicit interruption ended playback; this is not an audio gap
  }

  /**
   * No reply to the message in flight is coming (cut off, or none in CAP_MS): the next message goes. If nothing of its
   * reply has come (no id is known to be its), a reply that begins soon is still its own, late: the next message waits
   * until the agent has said nothing new for GRACE_MS, or until that reply's text came, so that it does not take it.
   */
  giveUp(how) {
    const m = this.inFlight;
    if (!m) return;
    clearTimeout(this.capTimer);
    this.inFlight = null;
    this.givenUp = m;
    this.finish(m, how);
    if (m.replyId == null) { this.held = m; this.waitGrace(); } else this.next();
  }

  waitGrace() {
    clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => this.unhold(), GRACE_MS);
  }

  unhold() {
    clearTimeout(this.graceTimer);
    this.held = null;
    this.next();
  }

  /** A message is finished with (an answer of the user's words is no message of the caller's: nothing to say). */
  finish(m, how = 'replied') {
    if (m.done) return;
    m.done = true;
    if (!m.own) this.onDone(m.marks, how);
  }

  /** With the agent's voice: once it has been back to listening for QUIET_MS, what played has played out. */
  waitQuiet() {
    clearTimeout(this.quietTimer);
    if (this.textOnly || this.mode !== 'listening') return;
    this.quietTimer = setTimeout(() => {
      if (this.playing?.marks.audio != null) { this.finish(this.playing); this.playing = null; }
    }, QUIET_MS);
  }

  /** A late reply is not heard: the caller spoke its own cue for that event, and two voices would talk over each other. */
  hush(m) { this.hushed = m; this.apply(0); }

  /**
   * A reply to be heard starts: the voice comes back up, and what is left of a hushed reply still playing is dropped
   * first (this one would play after it, and the volume is one for both). The client's own interrupt(), as on an
   * interruption: the next chunk it plays clears what it had queued.
   */
  unhush() {
    if (!this.hushed) return;
    if (this.mode === 'speaking') this.conversation?.output?.interrupt?.();
    this.hushed = null;
    this.apply(this.volume);
  }

  apply(volume) {
    if (this.textOnly || !this.conversation || this.applied === volume) return;
    this.applied = volume;
    this.conversation.setVolume({ volume });
  }

  /** The agent's voice level, 0-1 (0 for benchmarks: the audio still arrives and is timed). */
  setVolume(volume) {
    this.volume = volume;
    if (!this.hushed) this.apply(volume);
  }

  clearTimers() {
    clearInterval(this.activity); clearTimeout(this.capTimer); clearTimeout(this.quietTimer); clearTimeout(this.graceTimer);
    clearTimeout(this.userTimer); clearTimeout(this.talkTimer); clearTimeout(this.gapTimer); clearTimeout(this.saidTimer);
    for (const e of this.echoes) clearTimeout(e.timer);
    this.echoes = [];
  }

  async stop() {
    this.stopped = true;
    this.setVolume(0);                            // silence playback immediately, even if closing the socket takes time
    this.clearTimers();
    await this.started?.catch(() => {});                                   // a session still connecting ends once it is up
    const conversation = this.conversation;
    this.conversation = null;
    await conversation?.endSession();
  }
}
