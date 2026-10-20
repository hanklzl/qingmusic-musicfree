const fs = require('node:fs/promises');
const path = require('node:path');
const { parseConfig, compilePlugins } = require('./lib/converter.cjs');
async function main() {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  if (!args.includes('--base-url') || !args.includes('--out')) throw new Error('Usage: node build.cjs --source URL_OR_FILE --base-url HTTPS_DIRECTORY --out DIRECTORY');
  const source = args.includes('--source') ? value('--source') : 'https://13413.kstore.vip/QingMusic/music.json';
  let text;
  if (/^https:\/\//.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Config HTTP ' + response.status);
    text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('Config too large');
  } else text = await fs.readFile(source, 'utf8');
  const config = parseConfig(text);
  const adapters = Object.fromEntries(config.lines.filter(l => l.enabled !== false).map(l => [l.id, require('./adapters/' + l.id + '.cjs')]));
  const out = path.resolve(value('--out'));
  await fs.mkdir(out, { recursive: true });
  for (const legacy of [false, true]) {
    const suffix = legacy ? '.compat' : '';
    const compiled = compilePlugins(config, { baseUrl: value('--base-url'), adapters, legacy });
    for (const [name, script] of Object.entries(compiled.scripts)) await fs.writeFile(path.join(out, name), script);
    await fs.writeFile(path.join(out, 'plugins' + suffix + '.json'), JSON.stringify(compiled.manifest, null, 2) + '\n');
    if (args.includes('--raw-base-url')) {
      const raw = compilePlugins(config, { baseUrl: value('--raw-base-url'), adapters, legacy });
      await fs.writeFile(path.join(out, 'plugins' + suffix + '.raw.json'), JSON.stringify(raw.manifest, null, 2) + '\n');
    }
  }
  await fs.writeFile(path.join(out, 'qingmusic-config.json'), JSON.stringify(config, null, 2) + '\n');
  console.log(JSON.stringify({ countPerVariant: config.lines.filter(l => l.enabled !== false).length, variants: 2, out }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
