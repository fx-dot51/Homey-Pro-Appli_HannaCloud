# Hanna Cloud Pool — Homey Pro

Monitor your Hanna Instruments pool controller (BL122 / BL132) in Homey Pro.
Retrieves pH, chlorine (ORP), water temperature and air temperature from your
HannaCloud account at a configurable interval.

## Capabilities
- `measure_ph` — pH (0–14)
- `measure_chlorine_orp` — ORP in mV
- `measure_temperature` — water temperature (°C)
- `measure_temperature_air` — air temperature (°C)

## Architecture
- `lib/HannaCloudClient.js` — GraphQL client (AES-encrypted login, polling)
- `drivers/pool-controller/driver.js` — pairing (email + password)
- `drivers/pool-controller/device.js` — polling & capability updates
- `app.js` — Flow condition cards (pH / ORP in range)

## Development
```bash
npm install
homey app run --remote(for debugging)
homey app install (install on homey)
```

## Notes
The HannaCloud API is not officially documented. Endpoints and the AES key are
derived from the public `hanna-cloud` PyPI library used by the Home Assistant
integration. If the API changes, update `BASE_URL` / `ENCRYPTION_KEY` in
`lib/HannaCloudClient.js`.

## License
MIT
