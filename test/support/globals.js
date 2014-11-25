if (typeof exports === 'object') {
  if (!global.Promise) {
    require('es6-promise').polyfill();
  }

  global.popsicle = require('../..');
  global.expect   = require('chai').expect;
  global.FormData = require('form-data');
} else {
  window.ES6Promise.polyfill();
}
