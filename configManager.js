'use strict';
/**
 * Resolve configuration by searching for common config paths:
 * [app_dir]/config.js
 * [app_dir]/config/[env].js
 * [app_dir]/config/index.js
 * [app_dir]/config/default.js
 */
var path = require('path');
var jsx = require('jsx');
var appRootDir = path.dirname(require.main.filename);
var runtimeInstances = {};

exports.load = function(options, env) {
  var configPaths = ['config.js', 'config/' + env + '.js', 'config/index.js', 'config/default.js'];
  var config;
  if (typeof options === 'string' && options.length > 0) {
    try {
      var filename = path.join(appRootDir, options);
      config = require(filename);
    } catch(err) {
      console.error('Cannot find or parse config file: %s', filename);
    }
  } else {
    config = options;
  }
  if (!config) {
    configPaths.some(function(val) {
      try {
        config = require(path.join(appRootDir, val))
      } catch(err) {}
      return true;
    });
  }
  return config;
};

exports.runtime = function(id) {
  id = id || '';
  var runtime = runtimeInstances[id];
  if (!runtime) {
    runtime = {};
    id = id ? ('.' + id) : '';
    var filename = 'runtime' + id + '.json';
    runtime.filepath = path.join(appRootDir, filename);
    try {
      runtime.config = jsx.fsx.sync.readJson(runtime.filepath);
    } catch(err) {}
    runtime.config = runtime.config || {};
    runtime.isModified = false;
    runtime.get = function(key) {
      return runtime.config[key];
    };
    runtime.set = function(key, value) {
      runtime.isModified = true;
      runtime.config[key] = value;
    };
    runtime.save = function(force) {
      if (runtime.isModified || force) {
        jsx.fsx.sync.writeJson(runtime.filepath, runtime.config);
      }
    };
    runtime.forEach = function(onEachItem) {
      jsx.forEach(runtime.config, onEachItem);
    };
  }
  return runtime;
}

