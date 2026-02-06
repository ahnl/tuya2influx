const crypto = require('crypto');
const https = require('https');

class TuyaClient {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = config.baseUrl || 'openapi.tuyaeu.com';
    this.requestTimeout = config.requestTimeout ?? 30000;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  static get EMPTY_BODY_SHA256() {
    return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  }

  generateSign(str) {
    return crypto
      .createHmac('sha256', this.clientSecret)
      .update(str, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  getTimestamp() {
    return Date.now().toString();
  }

  generateNonce() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  buildStringToSign(method, pathWithQuery, body = null) {
    const contentSha256 = body
      ? crypto.createHash('sha256').update(body, 'utf8').digest('hex')
      : TuyaClient.EMPTY_BODY_SHA256;
    const optionalKey = '';
    return `${method}\n${contentSha256}\n${optionalKey}\n${pathWithQuery}`;
  }

  async makeRequest(method, path, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'mode': 'cors',
          ...headers
        }
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          clearTimeout(timeoutId);
          try {
            const parsed = JSON.parse(data);
            if (parsed.success === false) {
              reject(new Error(parsed.msg || 'API request failed'));
            } else {
              resolve(parsed);
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      const timeoutId = setTimeout(() => {
        req.destroy(new Error(`Request timed out after ${this.requestTimeout}ms`));
      }, this.requestTimeout);

      req.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  async authenticate() {
    const t = this.getTimestamp();
    const nonce = this.generateNonce();
    const pathWithQuery = '/v1.0/token?grant_type=1';
    const stringToSign = this.buildStringToSign('GET', pathWithQuery, null);
    const str = this.clientId + t + nonce + stringToSign;
    const sign = this.generateSign(str);

    const headers = {
      'client_id': this.clientId,
      'sign_method': 'HMAC-SHA256',
      't': t,
      'nonce': nonce,
      'sign': sign
    };

    try {
      const response = await this.makeRequest('GET', pathWithQuery, headers);

      if (response.success && response.result) {
        this.accessToken = response.result.access_token;
        const expireTime = response.result.expire_time || 7200;
        this.tokenExpiry = Date.now() + (expireTime * 1000);
        return this.accessToken;
      } else {
        throw new Error(response.msg || 'Authentication failed');
      }
    } catch (error) {
      throw new Error(`Authentication error: ${error.message}`);
    }
  }

  async ensureAuthenticated() {
    if (!this.accessToken || !this.tokenExpiry || Date.now() >= this.tokenExpiry - 60000) {
      await this.authenticate();
    }
  }

  async getDeviceProperties(deviceId) {
    await this.ensureAuthenticated();

    const t = this.getTimestamp();
    const nonce = this.generateNonce();
    const pathWithQuery = `/v2.0/cloud/thing/${deviceId}/shadow/properties`;
    const stringToSign = this.buildStringToSign('GET', pathWithQuery, null);
    const str = this.clientId + this.accessToken + t + nonce + stringToSign;
    const sign = this.generateSign(str);

    const headers = {
      'client_id': this.clientId,
      'access_token': this.accessToken,
      'sign_method': 'HMAC-SHA256',
      't': t,
      'nonce': nonce,
      'sign': sign
    };

    try {
      const response = await this.makeRequest('GET', pathWithQuery, headers);
      return response.result;
    } catch (error) {
      throw new Error(`Failed to get device properties for ${deviceId}: ${error.message}`);
    }
  }

  async getDeviceBatch(deviceIds) {
    await this.ensureAuthenticated();

    const t = this.getTimestamp();
    const nonce = this.generateNonce();
    const deviceIdsParam = deviceIds.join(',');
    const pathWithQuery = `/v2.0/cloud/thing/batch?device_ids=${deviceIdsParam}`;
    const stringToSign = this.buildStringToSign('GET', pathWithQuery, null);
    const str = this.clientId + this.accessToken + t + nonce + stringToSign;
    const sign = this.generateSign(str);

    const headers = {
      'client_id': this.clientId,
      'access_token': this.accessToken,
      'sign_method': 'HMAC-SHA256',
      't': t,
      'nonce': nonce,
      'sign': sign
    };

    try {
      const response = await this.makeRequest('GET', pathWithQuery, headers);
      return response.result || [];
    } catch (error) {
      throw new Error(`Failed to get device batch: ${error.message}`);
    }
  }

  parseSensorData(properties) {
    const data = {
      temperature: null,
      humidity: null,
      battery: null,
      timestamp: null
    };

    if (!properties || !properties.properties) {
      return data;
    }

    let latestTime = null;

    properties.properties.forEach(prop => {
      if (prop.time != null && (latestTime == null || prop.time > latestTime)) {
        latestTime = prop.time;
      }
      switch (prop.code) {
        case 'temp_current':
          data.temperature = prop.value / 10;
          break;
        case 'humidity_value':
          data.humidity = prop.value;
          break;
        case 'battery_state':
          if (typeof prop.value === 'string') {
            const batteryMap = {
              'high': 100,
              'medium': 50,
              'low': 20,
              'very_low': 10
            };
            data.battery = batteryMap[prop.value.toLowerCase()] || null;
          } else {
            data.battery = prop.value;
          }
          break;
      }
    });

    data.timestamp = latestTime != null ? latestTime : null;
    return data;
  }

  async fetchMultipleDevices(deviceIds) {
    const results = [];

    for (const deviceId of deviceIds) {
      try {
        const properties = await this.getDeviceProperties(deviceId);
        const sensorData = this.parseSensorData(properties);
        
        results.push({
          deviceId,
          success: true,
          data: sensorData,
          raw: properties
        });
      } catch (error) {
        results.push({
          deviceId,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }
}

module.exports = TuyaClient;
