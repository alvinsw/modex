'use strict';

var fs = require('fs');
var cache = {};

module.exports = function(filename, options, callback) {
  if (filename in cache) {
    callback(null, cache[filename]);
  } else {
    fs.readFile(filename, 'UTF8', function (err, data) {
      cache[filename] = data;
      callback(err, data);
    });
  }
}