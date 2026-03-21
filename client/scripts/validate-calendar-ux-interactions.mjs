import fs from 'fs';
import path from 'path';

const forbiddenPatterns = [
  { re: /window\.prompt\s*\(/, name: 'window.prompt' },
  { re: /window\.confirm\s*\(/, name: 'window.confirm' },
  { re: /\balert\s*\(/, name: 'alert(' },
  { re: /\bconfirm\s*\(/, name: 'confirm(' },
  { re: /\bprompt\s*\(/, name: 'prompt(' }
];

const calendarDir = path.resolve('src/pages/ops/calendar');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ success: false, batch: 'calendar-interactions', message }, null, 2));
  process.exit(1);
}

const files = walk(calendarDir).filter((f) => f.endsWith('.js') || f.endsWith('.jsx'));
let any = false;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const fp of forbiddenPatterns) {
    if (fp.re.test(content)) {
      any = true;
      fail(`Forbidden interaction "${fp.name}" found in ${path.relative(process.cwd(), file)}`);
    }
  }
}

if (!any) {
  console.log(JSON.stringify({ success: true, batch: 'calendar-interactions', filesChecked: files.length }, null, 2));
}

