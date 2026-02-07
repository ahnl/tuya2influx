/**
 * Migrate sensor data from InfluxDB to QuestDB.
 * Run: node scripts/migrate-influx-to-questdb.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { InfluxDB } = require('@influxdata/influxdb-client');
const http = require('http');
const https = require('https');

const influxConfig = {
  url: process.env.INFLUXDB_URL || 'http://localhost:8086',
  token: process.env.INFLUXDB_TOKEN,
  org: process.env.INFLUXDB_ORG || 'default',
  bucket: process.env.INFLUXDB_BUCKET || 'tuya'
};

const questdbUrl = process.env.QUESTDB_URL || 'http://localhost:9000';

const BATCH_SIZE = 5000;

function escapeTag(val) {
  if (val == null || val === '') return '';
  return String(val).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/=/g, '\\=').replace(/ /g, '\\ ');
}

function buildILPLine(row) {
  const deviceId = row.device_id || '';
  const customName = row.custom_name != null ? row.custom_name : '';
  const tags = ['device_id=' + escapeTag(deviceId)];
  if (customName !== '') tags.push('custom_name=' + escapeTag(customName));
  const fields = [];
  if (row.temperature != null && row.temperature !== '') fields.push(`temperature=${Number(row.temperature)}`);
  if (row.humidity != null && row.humidity !== '') fields.push(`humidity=${Number(row.humidity)}`);
  if (row.battery != null && row.battery !== '') fields.push(`battery=${Number(row.battery)}`);
  if (fields.length === 0) return null;
  const tsMs = typeof row._time === 'string' ? new Date(row._time).getTime() : row._time;
  return `temp,${tags.join(',')} ${fields.join(',')} ${tsMs}\n`;
}

async function ensureQuestDBTable() {
  const sql = [
    'CREATE TABLE IF NOT EXISTS temp (',
    '  device_id SYMBOL,',
    '  custom_name SYMBOL,',
    '  temperature DOUBLE,',
    '  humidity DOUBLE,',
    '  battery DOUBLE,',
    '  timestamp TIMESTAMP',
    ') TIMESTAMP(timestamp) PARTITION BY DAY',
    'DEDUP UPSERT KEYS(timestamp, device_id);'
  ].join(' ');
  const u = new URL(questdbUrl);
  const isHttps = u.protocol === 'https:';
  const path = '/exec?query=' + encodeURIComponent(sql);
  await new Promise((resolve, reject) => {
    const options = { hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path, method: 'GET' };
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.end();
  });
}

async function writeILPBatch(lines) {
  if (lines.length === 0) return;
  const body = lines.join('');
  const u = new URL(questdbUrl);
  const isHttps = u.protocol === 'https:';
  await new Promise((resolve, reject) => {
    const options = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: '/write?precision=ms',
      method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(body, 'utf8') }
    };
    const req = (isHttps ? https : http).request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(new Error(`QuestDB HTTP ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body, 'utf8');
    req.end();
  });
}

async function main() {
  if (!influxConfig.token) {
    console.error('Set INFLUXDB_TOKEN in .env');
    process.exit(1);
  }

  const fluxQuery = `
    from(bucket: "${influxConfig.bucket}")
      |> range(start: 0)
      |> filter(fn: (r) => r["_measurement"] == "temp")
      |> pivot(rowKey: ["_time", "device_id", "custom_name"], columnKey: ["_field"], valueColumn: "_value")
  `;

  console.log('Querying InfluxDB...');
  const client = new InfluxDB({ url: influxConfig.url, token: influxConfig.token });
  const queryApi = client.getQueryApi(influxConfig.org);

  const rows = await new Promise((resolve, reject) => {
    const out = [];
    queryApi.queryRows(fluxQuery, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row);
        out.push(o);
      },
      error(reason) { reject(reason); },
      complete() { resolve(out); }
    });
  });

  console.log(`Read ${rows.length} rows from InfluxDB`);

  if (rows.length === 0) {
    console.log('Nothing to migrate.');
    process.exit(0);
  }

  console.log('Ensuring QuestDB temp table...');
  await ensureQuestDBTable();

  const lines = [];
  for (const row of rows) {
    const line = buildILPLine(row);
    if (line) lines.push(line);
  }

  console.log(`Writing ${lines.length} rows to QuestDB in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    const batch = lines.slice(i, i + BATCH_SIZE);
    await writeILPBatch(batch);
    console.log(`  ${Math.min(i + BATCH_SIZE, lines.length)} / ${lines.length}`);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
