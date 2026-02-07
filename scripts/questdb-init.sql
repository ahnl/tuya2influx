CREATE TABLE IF NOT EXISTS temp (
  device_id SYMBOL,
  custom_name SYMBOL,
  temperature DOUBLE,
  humidity DOUBLE,
  battery DOUBLE,
  timestamp TIMESTAMP
) TIMESTAMP(timestamp) PARTITION BY DAY
DEDUP UPSERT KEYS(timestamp, device_id);
