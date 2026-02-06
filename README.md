# Tuya2Influx

A Node.js script to pull temperature, humidity, and battery sensor readings from Tuya Cloud API and insert them into InfluxDB2.

## Supported devices

- Tuya TH02 Wi-Fi (001TH02T1-3S)
    - [can be ordered from China for approx €2.80 per piece (AliExpress)](https://s.click.aliexpress.com/e/_EG7KQjK)

- *Please add your tested unit*

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Get Tuya Cloud API Credentials

1. Go to [Tuya Developer Platform](https://developer.tuya.com/)
2. Create a cloud project
3. Get your `client_id` and `client_secret` from the project settings
4. Go to Devices tab → Link App Account → Add App Account → Tuya App Account Authorization
5. Scan the QR code on your mobile app to authorize your account
6. Get your device IDs from the device list in your project

### 3. Create .env File

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
TUYA_CLIENT_ID=your_client_id_here
TUYA_CLIENT_SECRET=your_client_secret_here
TUYA_BASE_URL=openapi.tuyaeu.com
TUYA_DEVICE_IDS=bfffe0efc198e011a33pd3,device_id_2,device_id_3

# InfluxDB Configuration
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=your_influxdb_token_here
INFLUXDB_ORG=default
INFLUXDB_BUCKET=tuya
```

**Note:** Use the appropriate base URL for your region:
- `openapi.tuyaeu.com` - Europe
- `openapi.tuyaus.com` - Americas
- `openapi.tuyacn.com` - China

### 4. Run the Script

```bash
npm start
```

The script will:
1. Authenticate with Tuya Cloud API
2. Fetch `custom_name` for your devices
3. Fetch sensor data from devices
4. Write data to InfluxDB2

This script is suitable for use in a cron job to periodically collect sensor data and write it to InfluxDB2. You do not need to worry about duplicate data as InfluxDB2 will not insert a duplicate reading if it already exists.

## Scheduling with Cron

To run this script periodically, add a cron job:

```bash
crontab -e
```

Add a line to run every 5 minutes:
```
*/5 * * * * cd /path/to/tuya2influx && /usr/bin/node index.js >> /var/log/tuya2influx.log 2>&1
```

Or every hour (Tuya TH02 has 1 hour interval for data):
```
0 * * * * cd /path/to/tuya2influx && /usr/bin/node index.js >> /var/log/tuya2influx.log 2>&1
```

## Data Points

The script extracts the following data points from Tuya devices:

- **Temperature** (`temp_current`): Temperature
- **Humidity** (`humidity_value`): Humidity percentage
- **Battery** (`battery_state`): Battery level (enum: high/medium/low mapped to percentages, or numeric value)

## References

- [Tuya Cloud API Documentation](https://developer.tuya.com/en/docs/cloud/)