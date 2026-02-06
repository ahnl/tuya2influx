const TuyaClient = require('./tuya-client');
const InfluxDBClient = require('./influxdb-client');
const dotenv = require('dotenv');

dotenv.config();

const config = {
  clientId: process.env.TUYA_CLIENT_ID,
  clientSecret: process.env.TUYA_CLIENT_SECRET,
  baseUrl: process.env.TUYA_BASE_URL || 'openapi.tuyaeu.com',
  requestTimeout: process.env.TUYA_REQUEST_TIMEOUT ? parseInt(process.env.TUYA_REQUEST_TIMEOUT, 10) : undefined,
  deviceIds: process.env.TUYA_DEVICE_IDS ? process.env.TUYA_DEVICE_IDS.split(',').map(id => id.trim()) : []
};

const influxConfig = {
  url: process.env.INFLUXDB_URL || 'http://localhost:8086',
  token: process.env.INFLUXDB_TOKEN,
  org: process.env.INFLUXDB_ORG || 'default',
  bucket: process.env.INFLUXDB_BUCKET || 'tuya'
};

if (!config.clientId || !config.clientSecret) {
  console.error('Error: TUYA_CLIENT_ID and TUYA_CLIENT_SECRET must be set in .env file');
  process.exit(1);
}

if (!config.deviceIds || config.deviceIds.length === 0) {
  console.error('Error: TUYA_DEVICE_IDS must be set in .env file (comma-separated list)');
  process.exit(1);
}

if (!influxConfig.token) {
  console.error('Error: INFLUXDB_TOKEN must be set in .env file');
  process.exit(1);
}

async function main() {
  console.log('Initializing Tuya Cloud API client...');
  console.log(`Client ID: ${config.clientId}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Device IDs: ${config.deviceIds.join(', ')}\n`);

  const client = new TuyaClient(config);
  const influxClient = new InfluxDBClient(influxConfig);

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

    const output = {
      timestamp: new Date().toISOString(),
      devices: results.map(result => ({
        deviceId: result.deviceId,
        success: result.success,
        ...(result.success ? {
          temperature: result.data.temperature,
          humidity: result.data.humidity,
          battery: result.data.battery,
          timestamp: result.data.timestamp
        } : {
          error: result.error
        })
      }))
    };

    console.log(JSON.stringify(output, null, 2));

    console.log('\nWriting to InfluxDB...');
    const writeResults = await influxClient.writeMultipleDevices(results, deviceNames);

    console.log('\nInfluxDB Write Results:');
    writeResults.forEach(result => {
      if (result.written) {
        console.log(`  ${result.deviceId}: written`);
      } else {
        console.log(`  ${result.deviceId}: ${result.reason}${result.error ? ` (${result.error})` : ''}`);
      }
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
