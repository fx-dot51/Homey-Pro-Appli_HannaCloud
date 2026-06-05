'use strict';

const Homey = require('homey');
const HannaCloudClient = require('../../lib/HannaCloudClient');

const MIN_POLL_MINUTES = 5;
const DEFAULT_POLL_MINUTES = 60;
const STARTUP_DELAY_MS = 2000;

class PoolControllerDevice extends Homey.Device {

  async onInit() {
    this.log('Initialisation:', this.getName());
    this._client = new HannaCloudClient();
    this._pollTimer = null;

    // Premier relevé légèrement différé pour laisser l'app finir son démarrage
    this.homey.setTimeout(() => this._poll(), STARTUP_DELAY_MS);
    this._startPolling();
  }

  async onUninit() {
    this._stopPolling();
  }

  onDeleted() {
    this._stopPolling();
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('username') || changedKeys.includes('password')) {
      await this.setStoreValue('username', newSettings.username);
      await this.setStoreValue('password', newSettings.password);
      this._client = new HannaCloudClient();
    }
    if (changedKeys.includes('poll_interval')) {
      this._stopPolling();
      this._startPolling();
    }
    // Relève immédiatement avec les nouveaux réglages
    this.homey.setTimeout(() => this._poll(), 500);
  }

  // ─── Authentification ───────────────────────────────────────────────────────

  async _authenticate() {
    const { username, password } = this.getStore();
    if (!username || !password) {
      await this.setUnavailable('Identifiants manquants. Supprimez puis ré-ajoutez l\'appareil.');
      return false;
    }
    try {
      await this._client.authenticate(username, password);
      return true;
    } catch (err) {
      this.error('Authentification échouée:', err.message);
      await this.setUnavailable(err.message);
      return false;
    }
  }

  // ─── Polling ──────────────────────────────────────────────────────────────────

  _pollIntervalMs() {
    const minutes = Math.max(MIN_POLL_MINUTES, this.getSetting('poll_interval') || DEFAULT_POLL_MINUTES);
    return minutes * 60 * 1000;
  }

  _startPolling() {
    const ms = this._pollIntervalMs();
    this.log(`Relevé programmé toutes les ${ms / 60000} min.`);
    this._pollTimer = this.homey.setInterval(() => this._poll(), ms);
  }

  _stopPolling() {
    if (this._pollTimer) {
      this.homey.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _poll() {
    // Le token n'est rafraîchi que lorsqu'un relevé est nécessaire
    if (!this._client.isAuthenticated()) {
      if (!(await this._authenticate())) return;
    }

    try {
      const m = await this._client.getLastReading(this.getData().id);
      await this._updateCapabilities(m);
      await this.setAvailable();
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED' || err.message === 'NOT_AUTHENTICATED') {
        // Token invalidé côté serveur : on retente une authentification immédiate
        if (await this._authenticate()) {
          try {
            const m = await this._client.getLastReading(this.getData().id);
            await this._updateCapabilities(m);
            await this.setAvailable();
            return;
          } catch (retryErr) {
            this.error('Relevé après ré-auth échoué:', retryErr.message);
            await this.setUnavailable(retryErr.message);
          }
        }
      } else {
        this.error('Relevé échoué:', err.message);
        await this.setUnavailable(err.message);
      }
    }
  }

  async _updateCapabilities(m) {
    const map = {
      measure_ph: m.ph,
      measure_chlorine_orp: m.chlorineOrp,
      measure_temperature: m.waterTemperature,
      measure_temperature_air: m.airTemperature,
    };
    for (const [capability, value] of Object.entries(map)) {
      if (value !== null && this.hasCapability(capability)) {
        await this.setCapabilityValue(capability, value).catch(this.error);
      }
    }
  }

}

module.exports = PoolControllerDevice;
