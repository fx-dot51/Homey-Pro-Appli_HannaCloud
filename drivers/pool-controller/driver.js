'use strict';

const Homey = require('homey');
const HannaCloudClient = require('../../lib/HannaCloudClient');

class PoolControllerDriver extends Homey.Driver {

  async onInit() {
    this.log('Driver Pool Controller prêt.');
  }

  async onPair(session) {
    let client = null;
    let credentials = null;

    session.setHandler('login', async ({ username, password }) => {
      client = new HannaCloudClient();
      await client.authenticate(username, password); // lève une erreur lisible si échec
      credentials = { username: username.trim(), password: password.trim() };
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!client) throw new Error('Authentification requise.');

      const devices = await client.getDevices();
      if (devices.length === 0) {
        throw new Error('Aucun contrôleur trouvé sur ce compte HannaCloud.');
      }

      return devices.map(d => ({
        name: d.name,
        data: { id: d.id },
        store: {
          username: credentials.username,
          password: credentials.password,
          model: d.model,
          serial: d.serial,
        },
      }));
    });
  }

}

module.exports = PoolControllerDriver;
