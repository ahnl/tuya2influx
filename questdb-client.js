const http = require('http');
const https = require('https');

function escapeTag(val) {
  return String(val).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/=/g, '\\=').replace(/ /g, '\\ ');
}

const TEMP_TABLE_SQL = [
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

class QuestDBClient {
  constructor(config) {
    this.config = config;
    this.url = config.url || 'http://localhost:9000';
    this._tableEnsured = false;
  }

  async ensureTempTable() {
    if (this._tableEnsured) return;
    const u = new URL(this.url);
    const isHttps = u.protocol === 'https:';
    const path = '/exec?query=' + encodeURIComponent(TEMP_TABLE_SQL);

    await new Promise((resolve, reject) => {
      const options = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path,
        method: 'GET'
      };
      const req = (isHttps ? https : http).request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          this._tableEnsured = true;
          resolve();
        });
      });
      req.on('error', (err) => reject(err));
      req.end();
    });
  }

  buildLine(deviceId, data, customName) {
    const tags = ['device_id=' + escapeTag(deviceId)];
    if (customName != null && customName !== '') {
      tags.push('custom_name=' + escapeTag(customName));
    }
    const fields = [];
    if (data.temperature !== null) fields.push(`temperature=${data.temperature}`);
    if (data.humidity !== null) fields.push(`humidity=${data.humidity}`);
    if (data.battery !== null) fields.push(`battery=${data.battery}`);
    if (fields.length === 0) return null;
    const tsMs = data.timestamp;
    return `temp,${tags.join(',')} ${fields.join(',')} ${tsMs}\n`;
  }

  async writeSensorData(deviceId, data, customName) {
    if (!data.timestamp) {
      console.log(`  Skipping ${deviceId}: no timestamp`);
      return { written: false, reason: 'no_timestamp' };
    }

    const line = this.buildLine(deviceId, data, customName);
    if (!line) return { written: false, reason: 'no_fields' };

    const u = new URL(this.url);
    const isHttps = u.protocol === 'https:';
    const body = line;

    return new Promise((resolve, reject) => {
      const options = {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: '/write?precision=ms',
        method: 'POST',
        headers: {
          'Content-Length': Buffer.byteLength(body, 'utf8')
        }
      };

      const req = (isHttps ? https : http).request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ written: true });
          } else {
            resolve({ written: false, reason: 'error', error: `HTTP ${res.statusCode}: ${data}` });
          }
        });
      });

      req.on('error', (err) => resolve({ written: false, reason: 'error', error: err.message }));
      req.write(body, 'utf8');
      req.end();
    });
  }

  async writeMultipleDevices(results, deviceNames) {
    await this.ensureTempTable();

    const writePromises = [];
    const names = deviceNames || {};

    for (const result of results) {
      if (result.success && result.data) {
        const customName = names[result.deviceId];
        writePromises.push(
          this.writeSensorData(result.deviceId, result.data, customName)
            .then(status => ({ deviceId: result.deviceId, ...status }))
            .catch(error => ({
              deviceId: result.deviceId,
              written: false,
              reason: 'error',
              error: error.message
            }))
        );
      }
    }

    return Promise.all(writePromises);
  }
}

module.exports = QuestDBClient;
