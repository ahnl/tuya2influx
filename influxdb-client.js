const { InfluxDB, Point } = require('@influxdata/influxdb-client');

class InfluxDBClient {
  constructor(config) {
    this.url = config.url;
    this.token = config.token;
    this.org = config.org;
    this.bucket = config.bucket;
    
    this.client = new InfluxDB({ url: this.url, token: this.token });
    this.writeApi = this.client.getWriteApi(this.org, this.bucket, 'ns');
  }

  async writeSensorData(deviceId, data, customName) {
    if (!data.timestamp) {
      console.log(`  Skipping ${deviceId}: no timestamp`);
      return { written: false, reason: 'no_timestamp' };
    }

    const point = new Point('temp')
      .tag('device_id', deviceId)
      .timestamp(data.timestamp * 1000000);

    if (customName != null && customName !== '') {
      point.tag('custom_name', String(customName));
    }

    if (data.temperature !== null) {
      point.floatField('temperature', data.temperature);
    }
    if (data.humidity !== null) {
      point.floatField('humidity', data.humidity);
    }
    if (data.battery !== null) {
      point.floatField('battery', data.battery);
    }

    this.writeApi.writePoint(point);

    return { written: true };
  }

  async writeMultipleDevices(results, deviceNames) {
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

    const writeResults = await Promise.all(writePromises);

    try {
      await this.writeApi.close();
    } catch (error) {
      console.error('Error flushing InfluxDB writes:', error.message);
    }

    return writeResults;
  }
}

module.exports = InfluxDBClient;
