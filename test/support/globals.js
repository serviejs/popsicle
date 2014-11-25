if (typeof exports === 'object') {
  global.popsicle = require('../..');
  global.expect   = require('chai').expect;
  global.FormData = require('form-data');
} else {
  window.ES6Promise.polyfill();
}
