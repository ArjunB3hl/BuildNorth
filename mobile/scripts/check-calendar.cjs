/** Exercise local date/month logic in Toronto, including DST. No Expo runtime required. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
process.env.TZ = 'America/Toronto';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-calendar-'));
try {
  for (const name of ['dates', 'calendar']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', `${name}.ts`), 'utf8');
    fs.writeFileSync(path.join(temp, `${name}.js`), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  }
  const { monthDays, changeMonth, entryInstant } = require(path.join(temp, 'calendar.js'));
  assert.equal(monthDays('2026-10-25')[0], '2026-09-28');
  assert.equal(monthDays('2026-10-25').length, 42);
  assert.equal(new Set(monthDays('2026-03-15')).size, 42);
  assert.equal(changeMonth('2026-12-31', 1), '2027-01-01');
  assert.equal(changeMonth('2026-01-31', -1), '2025-12-01');
  assert.equal(entryInstant('2026-03-08', '03:30'), '2026-03-08T07:30:00.000Z');
  assert.throws(() => entryInstant('2026-03-08', '02:30'), /does not exist/);
  assert.throws(() => entryInstant('2026-02-30', '12:00'), /does not exist/);
  assert.throws(() => entryInstant('2026-10-20', '24:00'), /24-hour/);
  assert.throws(() => entryInstant('2099-01-01', '12:00'), /past/);
  console.log('Calendar: 10 date, month-boundary, DST and validation checks passed.');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
