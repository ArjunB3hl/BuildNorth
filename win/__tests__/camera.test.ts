import {
  countedWorkout,
  countMessage,
  NOTHING_COUNTED,
  poseMessage,
  poseUrl,
  saveTarget,
  sessionFromWorkout,
  trustedPoseUrl,
} from '../src/lib/pose-coach';

describe('camera page bridge', () => {
  it('loads only the local camera page, told it is in the Windows app', () => {
    expect(poseUrl('dark')).toBe(
      'http://127.0.0.1:8765/web/index.html?embed=1&parent=windows-app&theme=dark',
    );
  });

  it('takes messages only from the local camera page', () => {
    const ready = JSON.stringify({ type: 'pose-coach/ready', version: '1' });
    expect(poseMessage({ url: poseUrl('light'), data: ready })).toEqual({ type: 'pose-coach/ready', version: '1' });
    for (const url of [
      'https://example.com/web/index.html',
      'http://127.0.0.1:8766/web/index.html',
      'http://localhost:8765/web/index.html',
      'http://127.0.0.1:8765/web/eval.html',
      'http://127.0.0.1:8765.evil.example/web/index.html',
      'http://127.0.0.1:8765@evil.example/web/index.html',
      'file:///C:/web/index.html',
      'about:blank',
      undefined,
    ])
      expect(poseMessage({ url, data: ready })).toBeNull();
    expect(trustedPoseUrl('http://127.0.0.1:8765/web/index.html#x')).toBe(true);
  });

  it('ignores anything that isn’t a pose-coach message', () => {
    const url = poseUrl('light');
    for (const data of ['not json', '{"type":"other/ready"}', '{"no":"type"}', 'null', 'x'.repeat(200_001)])
      expect(poseMessage({ url, data })).toBeNull();
  });

  it('saves what was counted as a session, as the website does', () => {
    const now = '2026-10-29T10:10:00.000Z';
    let c = NOTHING_COUNTED;
    const set = { exercise: 'squat', label: 'Squat', set: 1, reps: 8, partials: 1, faults: {}, perSide: {} };
    c = countMessage(c, { type: 'pose-coach/state', running: true, startedAt: '2026-10-29T10:00:00.000Z' }, now).counted;
    c = countMessage(c, { type: 'pose-coach/set', ...set }, now).counted;
    const workout = countedWorkout(c, now);
    expect(workout?.sets).toHaveLength(1);
    const session = sessionFromWorkout(workout!, { localDate: '2026-10-29' });
    expect(session).toMatchObject({
      routineName: 'Camera workout',
      localDate: '2026-10-29',
      entries: [{ name: 'Squat', sets: [{ reps: 8, completed: true }], skipped: false }],
    });
    expect(session.notes).toContain('1 partial rep not counted');
  });
});

describe('where a camera workout is saved', () => {
  it('says plainly when it is the local test backend, never the live Calendar', () => {
    expect(saveTarget('account', 'http://127.0.0.1:8000', 'dev-token')).toMatch(
      /local test backend at http:\/\/127\.0\.0\.1:8000 \(fictional test user\), not your live Rhythm Calendar/,
    );
    expect(saveTarget('account', 'http://localhost:8000', '')).toMatch(/local test backend/);
    expect(saveTarget('account', 'https://buildnorth.onrender.com', '')).toBe(
      'Saves to your Rhythm account’s Calendar (https://buildnorth.onrender.com).',
    );
    expect(saveTarget('demo')).toMatch(/demo Calendar only/);
  });
});
