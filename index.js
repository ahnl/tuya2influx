const TuyaClient = require('./tuya-client');
const InfluxDBClient = require('./influxdb-client');
const QuestDBClient = require('./questdb-client');
const dotenv = require('dotenv');

dotenv.config();

const config = {
  clientId: process.env.TUYA_CLIENT_ID,
  clientSecret: process.env.TUYA_CLIENT_SECRET,
  baseUrl: process.env.TUYA_BASE_URL || 'openapi.tuyaeu.com',
  requestTimeout: process.env.TUYA_REQUEST_TIMEOUT ? parseInt(process.env.TUYA_REQUEST_TIMEOUT, 10) : undefined,
  deviceIds: process.env.TUYA_DEVICE_IDS ? process.env.TUYA_DEVICE_IDS.split(',').map(id => id.trim()) : []
};

const writeDb = (process.env.WRITE_DB || 'influxdb').toLowerCase().split(',').map(s => s.trim());
const influxConfig = {
  url: process.env.INFLUXDB_URL || 'http://localhost:8086',
  token: process.env.INFLUXDB_TOKEN,
  org: process.env.INFLUXDB_ORG || 'default',
  bucket: process.env.INFLUXDB_BUCKET || 'tuya'
};
const questdbConfig = {
  url: process.env.QUESTDB_URL || 'http://localhost:9000'
};

if (!config.clientId || !config.clientSecret) {
  console.error('Error: TUYA_CLIENT_ID and TUYA_CLIENT_SECRET must be set in .env file');
  process.exit(1);
}

if (!config.deviceIds || config.deviceIds.length === 0) {
  console.error('Error: TUYA_DEVICE_IDS must be set in .env file (comma-separated list)');
  process.exit(1);
}

if (writeDb.includes('influxdb') && !influxConfig.token) {
  console.error('Error: INFLUXDB_TOKEN must be set when WRITE_DB includes influxdb');
  process.exit(1);
}

async function main() {
  console.log('Initializing Tuya Cloud API client...');
  console.log(`Client ID: ${config.clientId}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Device IDs: ${config.deviceIds.join(', ')}\n`);

  const client = new TuyaClient(config);
  const influxClient = writeDb.includes('influxdb') ? new InfluxDBClient(influxConfig) : null;
  const questdbClient = writeDb.includes('questdb') ? new QuestDBClient(questdbConfig) : null;

  try {
    console.log('Authenticating...');
    await client.authenticate();
    console.log('Authentication successful\n');

    const batch = await client.getDeviceBatch(config.deviceIds);
    const deviceNames = {};
    if (Array.isArray(batch)) {
      batch.forEach((d) => {
        deviceNames[d.id] = d.custom_name != null ? d.custom_name : '';
      });
    }

    console.log('Fetching device data...\n');
    const results = await client.fetchMultipleDevices(config.deviceIds);

    const summary = results.map((r) =>
      r.success
        ? { deviceId: r.deviceId, success: true, ...r.data }
        : { deviceId: r.deviceId, success: false, error: r.error }
    );
    console.log(JSON.stringify(summary, null, 2));

    if (influxClient) {
      const writeResults = await influxClient.writeMultipleDevices(results, deviceNames);
      console.log('InfluxDB write results:', writeResults);
    }

    if (questdbClient) {
      const writeResults = await questdbClient.writeMultipleDevices(results, deviceNames);
      console.log('QuestDB write results:', writeResults);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
