'use strict';

const fetch = require('node-fetch');
const crypto = require('crypto');

// Clé AES publique du front-end HannaCloud (identique à la lib hanna-cloud sur PyPI,
// utilisée par l'intégration Home Assistant officielle).
const ENCRYPTION_KEY = 'MzJmODBmMDU0ZTAyNDFjYWM0YTVhOGQxY2ZlZTkwMDM=';
const BASE_URL = 'https://www.hannacloud.com/api';
const REQUEST_TIMEOUT_MS = 15000;
const LOGIN_RETRIES = 3;
const IV_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Client pour l'API GraphQL de HannaCloud.
 * Gère l'authentification chiffrée AES, la récupération des appareils
 * et la lecture des dernières mesures.
 */
class HannaCloudClient {

  constructor() {
    this._token = null;
    this._tokenExpiry = 0;
    this._email = null;
    this._password = null;
    this._key = Buffer.from(ENCRYPTION_KEY, 'base64');
  }

  // ─── Chiffrement AES-256-CBC ────────────────────────────────────────────────

  _encrypt(plaintext) {
    let iv = '';
    for (let i = 0; i < 16; i++) {
      iv += IV_CHARS[Math.floor(Math.random() * IV_CHARS.length)];
    }
    const data = Buffer.from(plaintext, 'utf8');
    const padLen = 16 - (data.length % 16);
    const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
    const cipher = crypto.createCipheriv('aes-256-cbc', this._key, Buffer.from(iv, 'utf8'));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return `${iv}:${encrypted.toString('hex')}`;
  }

  // ─── Requête HTTP avec timeout ──────────────────────────────────────────────

  async _fetch(endpoint, authHeader, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`${BASE_URL}/${endpoint}`, {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'content-type': 'application/json',
          'authorization': authHeader,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Authentification ────────────────────────────────────────────────────────

  async authenticate(email, password) {
    this._email = (email || '').trim();
    this._password = (password || '').trim();

    if (!this._email || !this._password) {
      throw new Error('Email et mot de passe requis.');
    }

    const body = JSON.stringify({
      operationName: 'Login',
      variables: {
        email: this._encrypt(this._email),
        password: this._encrypt(this._password),
        userLanguage: 'English',
        source: 'web',
      },
      query: 'query Login($email: String!, $password: String!, $userLanguage: String!, $source: String) {\n  login(\n    email: $email\n    password: $password\n    language: $userLanguage\n    source: $source\n  ) {\n    token\n    tokenType\n    __typename\n  }\n}',
    });

    let lastError = 'erreur inconnue';
    for (let attempt = 1; attempt <= LOGIN_RETRIES; attempt++) {
      let response;
      try {
        response = await this._fetch('auth', 'Bearer None', body);
      } catch (err) {
        lastError = err.name === 'AbortError' ? 'délai dépassé' : err.message;
        await this._delay(1000);
        continue;
      }

      const json = await response.json().catch(() => ({}));
      const login = json?.data?.login;

      if (login) {
        const tokens = Array.isArray(login) ? login : [login];
        const accessToken = tokens.find(t => t?.tokenType === 'accessToken') || tokens[0];
        if (accessToken?.token) {
          this._setToken(accessToken.token);
          return this._token;
        }
      }

      lastError = json?.errors?.[0]?.message || 'réponse invalide';
      if (lastError === 'invalidUsernameOrPassword') break; // inutile de réessayer
      await this._delay(1000);
    }

    throw new Error(this._friendlyError(lastError));
  }

  _setToken(token) {
    this._token = token;
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      this._tokenExpiry = payload.exp * 1000;
    } catch (e) {
      this._tokenExpiry = Date.now() + (170 * 60 * 1000); // repli : 2h50
    }
  }

  _friendlyError(msg) {
    if (msg === 'invalidUsernameOrPassword') return 'Email ou mot de passe incorrect.';
    if (msg === 'délai dépassé') return 'HannaCloud ne répond pas (délai dépassé).';
    return `Connexion échouée : ${msg}`;
  }

  isAuthenticated() {
    return !!this._token && Date.now() < this._tokenExpiry;
  }

  // ─── Requête GraphQL authentifiée ────────────────────────────────────────────

  async _request(body) {
    if (!this._token) throw new Error('NOT_AUTHENTICATED');

    let response;
    try {
      response = await this._fetch('graphql', `Bearer ${this._token}`, JSON.stringify(body));
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'Délai dépassé' : err.message);
    }

    if (response.status === 401 || response.status === 403) throw new Error('TOKEN_EXPIRED');
    if (!response.ok) {
      throw new Error(`Erreur API ${response.status}`);
    }

    const json = await response.json().catch(() => ({}));
    if (json.errors) {
      const msg = json.errors[0]?.message || 'Erreur GraphQL';
      if (/token|auth|jwt/i.test(msg)) throw new Error('TOKEN_EXPIRED');
      throw new Error(msg);
    }
    return json.data || {};
  }

  // ─── Liste des appareils ─────────────────────────────────────────────────────

  async getDevices() {
    const data = await this._request({
      operationName: 'Devices',
      variables: { modelGroups: ['BL12x', 'BL13x', 'BL13xs'], deviceLogs: true },
      query: 'query Devices($modelGroups: [String!], $deviceLogs: Boolean!) {\n  devices(modelGroups: $modelGroups, deviceLogs: $deviceLogs) {\n    _id\n    DID\n    DM\n    DINFO {\n      deviceName\n      __typename\n    }\n    deviceName\n    __typename\n  }\n}',
    });

    return (data.devices || []).map(d => ({
      id: d.DID,
      name: d.DINFO?.deviceName || d.deviceName || d.DID,
      model: d.DM || 'BL132',
      serial: d.DID,
    }));
  }

  // ─── Dernière mesure ─────────────────────────────────────────────────────────

  async getLastReading(deviceId) {
    const data = await this._request({
      operationName: 'GetLastDeviceReading',
      variables: { deviceIds: [deviceId] },
      query: 'query GetLastDeviceReading($deviceIds: [String!]) {\n  lastDeviceReadings(deviceIds: $deviceIds) {\n    DID\n    DT\n    messages\n    __typename\n  }\n}',
    });

    const reading = (data.lastDeviceReadings || [])[0];
    if (!reading) throw new Error(`Aucune mesure disponible pour ${deviceId}`);
    return this._parseMeasurements(reading);
  }

  _parseMeasurements(reading) {
    const raw = reading?.messages?.parameters || [];
    const params = {};
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item && item.name) params[item.name] = item.value;
      }
    } else if (typeof raw === 'object') {
      Object.assign(params, raw);
    }

    return {
      ph:               this._val(params, ['ph', 'pH', 'PH']),
      chlorineOrp:      this._val(params, ['orp', 'ORP', 'cl', 'CL']),
      waterTemperature: this._val(params, ['temp', 'WT', 'wt', 'T1']),
      airTemperature:   this._val(params, ['airTemp', 'AT', 'at', 'T2']),
      timestamp:        reading?.DT || null,
    };
  }

  _val(params, keys) {
    for (const key of keys) {
      const raw = params[key];
      if (raw !== undefined && raw !== null && raw !== '') {
        const v = parseFloat(raw);
        if (!isNaN(v)) return v;
      }
    }
    return null;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = HannaCloudClient;
