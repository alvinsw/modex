'use strict';

var fs = require('fs');
var path = require('path');
var ModuleManager = require('./ModuleManager');

var instances = [];

var modex = function(options) {
  var instance = ModuleManager.create(options, instances.length);
  //var instance = {start:function(){console.log('starting')}};
  instances.push(instance);
  return instance;
}

/** Get the Manager instance with the specified id. If no id specified, get the last created instance */
modex.getInstance = function(id) {
  if (instances.length > 0) return instances[instances.length-1];
}

modex.middleware  = ModuleManager.prototype.middleware  = require('./middleware');
modex.models      = ModuleManager.prototype.models      = requireAllJsFilesInDir('./models');
modex.views       = ModuleManager.prototype.views       = require('./views');
modex.controllers = ModuleManager.prototype.controllers = requireAllJsFilesInDir('./controllers');
modex.helper      = ModuleManager.prototype.helper = {
  model : require('./helper.model'),
  view : require('./helper.view'),
  controller : require('./helper.controller')
};

function requireAllJsFilesInDir(dirPath) {
  var c = {};
  var absDirPath = path.resolve(__dirname, dirPath)
  var files = fs.readdirSync(absDirPath);
  files.forEach(function(fname) {
    var fp = path.join(absDirPath, fname);
    if (fs.statSync(fp).isDirectory()) {
      c[fname] = requireAllJsFilesInDir(dirPath + '/' + fname);
    } else {
      var ext = path.extname(fname);
      if (ext === '.js') {
        c[path.basename(fname, ext)] = require(dirPath + '/' + fname);
      }
    }
  });
  return c;
}

module.exports = modex;