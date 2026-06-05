'use strict';

const Homey = require('homey');

class HannaCloudApp extends Homey.App {

  async onInit() {
    this.log('Hanna Cloud Pool — démarrage.');
    this._registerFlowConditions();
  }

  _registerFlowConditions() {
    this.homey.flow.getConditionCard('ph_in_range')
      .registerRunListener(({ device, min_ph, max_ph }) => {
        const ph = device.getCapabilityValue('measure_ph');
        return ph !== null && ph >= min_ph && ph <= max_ph;
      });

    this.homey.flow.getConditionCard('orp_in_range')
      .registerRunListener(({ device, min_orp, max_orp }) => {
        const orp = device.getCapabilityValue('measure_chlorine_orp');
        return orp !== null && orp >= min_orp && orp <= max_orp;
      });
  }

}

module.exports = HannaCloudApp;
