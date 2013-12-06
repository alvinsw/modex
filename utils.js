'use strict';
var fs = require('fs');
var fsx = require('jsx').fsx;

/** Check if a given filepath is absolute or relative */
exports.isAbsolutePath = function isAbsolutePath(filepath) {
  return ('/' === filepath[0]) || (':' === filepath[1] && '\\' === filepath[2]);
};


exports.eachFileInDir = function eachFileInDir(dirpath, onVisit, recursive) {
  return fsx.sync.forEach(dirpath, function(file) {
    if (fs.statSync(file.path).isDirectory()) {
      if (recursive) eachFileInDir(file.path, onVisit, recursive);
    } else {
      onVisit(file.name, file.path);
    }
  });
}

exports.joinUrl = function() {
  var url = '';
  for (var i=0; i<arguments.length; ++i) {
    var part = arguments[i];
    if (part) {
      if (url.length > 0) {
        if (url[url.length-1] === '/') {
          if (part[0] === '/') part = part.slice(1);
        } else if (part[0] !== '/') {
          url += '/';
        }
      }
      url += part;
    }
  }
  return url;
};

/** 
 * Returns the resolved full route and base module in the order of absolute route, interface name or module name
 * @param {String}           [params.absroute]   An absolute base route path that will be prepended to the route. Ie: `params.absroute/route`
 * @param {String}           [params.interface]  Request to adds the controller to the specified interface, if exists.
 * @param {String|AppModule} [params.module]     Request to adds the controller to the specified module id, if exists. Default is the owner/current module.
 */
exports.resolveBase = function resolveBase(mod, params) {
  var routeBase = params.absroute;
  var modBase = mod;
  var success = true;
  if (!routeBase) {
    if (typeof params.interface === 'string') {
      modBase = mod.manager.getInterface(params.interface);
    } else if (params.module) {
      if (typeof params.module === 'string') {
        modBase = mod.manager.getModule(params.module);
      } else if (params.module instanceof AppModule) {
        modBase = params.module;
      }
    }
    if (!modBase) {
      success = false;
      //logger.warn('Module {%s} Cannot resolve interface `%s` or module `%s`', params.interface, params.module);
      modBase = mod;
    }
    routeBase = modBase.routePath;
  }
  return {route:routeBase, module:modBase, success:success};
}
