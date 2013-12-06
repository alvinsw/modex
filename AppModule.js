/*
 * A helper class for Express.js modular framework.
 * This class represent a module.
    Properties:
      name
      path
      parent
      modules
 */
'use strict';

var path = require('path');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;

var jsx = require('jsx');
var dirExists = jsx.fsx.sync.dirExists;

var utils = require('./utils');
var eachFileInDir = utils.eachFileInDir;
var joinUrl = utils.joinUrl;
var resolveBase = utils.resolveBase;
var defaultViews = require('./views');
var Controller = require('./components').Controller;
var Action = require('./components').Action;

var FLAG_INSTALLED = 0x1; // 01
var FLAG_ENABLED = 0x2;   // 10

var logger;

/** AppModule constructor */
var AppModule = module.exports = function AppModule(manager, options) {
  logger = manager.config.createLogger(module);
  var mod = this;
  Object.defineProperties(mod, {
    name       : {value:options.name, enumerable: true},
    path       : {value:options.path, enumerable: true}, //filepath
    parent     : {value:options.parent, enumerable: true, writable: true},
    manager    : {value:manager, enumerable: true},
    modules    : {value:{}, enumerable: true},
    _meta      : {value:{}, writable: true},
    _routePath : {value:undefined, writable: true},
    _id        : {value:undefined, writable: true},
    _modulesCount : {value:0, writable: true},
    _data      : {value:{}},
    _externalHandlers : {value:{}},
    _routes    : {value:{}},
    _routesMarker : { value : null, writable : true },
    _event     : {value:new EventEmitter()},
    _state     : {value:0x0, writable: true} // 0 = not installed, 1 = installed but disabled, 3 = installed and enabled
  });
    
  if (mod.parent) mod.parent.add(mod);
  // Load meta information to find main js file
  var meta = {};
  // First by reading package.json
  var fp = path.join(mod.path, 'package.json');
  try {
    if (fs.existsSync(fp)) meta = require(fp);
  } catch(err) {
    logger.warn('Cannot load the module description file: %s', fp);
  }
  if (!meta.route) meta.route = mod.name;
  mod._meta = meta;
  // if module has no parent, use the root config `_`
  if (!mod.parent) {
    meta = manager.config.modules._;
    if (typeof meta === 'object') mod._meta = jsx.object.merge(meta, mod._meta, true);
  }
  meta = manager.config.modules[mod.id];
  if (typeof meta === 'object') mod._meta = jsx.object.merge(meta, mod._meta, true);
  
  // If package.json is not found or does not contain "main", read index.js
  if (!mod._meta.main) {
    ['index.js', mod.name + '.js'].some(function(mname) {
      if (fs.existsSync(path.join(mod.path, mname))) {
        mod._meta.main = mname;
        return true;
      }
    });
  }
  var main;
  try {
    if (mod._meta.main) main = require(path.join(mod.path, mod._meta.main));
  } catch(err) {
    logger.error('Error loading module "%s". Cannot parse %s.', mod.path, mod._meta.main);
    logger.debug(err.stack);
  }
  if (main) {
    Object.defineProperty(mod, 'main', {value:main});
  } else {
    mod._state = FLAG_INSTALLED | FLAG_ENABLED;
  }
};

/** Create a new AppModule */
AppModule.create = function(manager, options) {
  return new AppModule(manager, options);
};

/** Initialize a new AppModule instance. This method must be called first before using the module. */
AppModule.init = function(mod, state) {
  var autoLoad = mod.getMeta('autoLoad');
  mod._state = state || 0;
  //run module constructor if exists
  if (typeof mod.main === 'function') {
    var mainobj = mod.main(mod);
    if (mainobj instanceof Object) mod.main = mainobj;
  }
  mod.main.models = mod.main.models || {};
  mod.main.views = mod.main.views || {};
  mod.main.controllers = mod.main.controllers || {};
  if (autoLoad.models      && dirExists(path.join(mod.path, 'models')))      mod.addModels('./models');
  if (autoLoad.views       && dirExists(path.join(mod.path, 'views')))       mod.addViews('./views');
  if (autoLoad.controllers && dirExists(path.join(mod.path, 'controllers'))) mod.addControllers('./controllers');
};

var proto = AppModule.prototype;

Object.defineProperties(proto, {
  id : { get : function() { return resolveId(this); }, enumerable : true },
  localRoutePath : { 
    get : function() { return this._meta.route; }, 
    set : function(val) { this._meta.route = val; }, 
    enumerable : true },
  fullRoutePath : { get : protoResolveAbsRoutePath, enumerable : true },
  routePath : { get : protoResolveAbsRoutePath, enumerable : true },
  methods : { get : function() { return this.main; }, enumerable : true },
  models : { get : function() { if (this.main) return this.main.models; }, enumerable : true },
  views : { get : function() { if (this.main) return this.main.views; }, enumerable : true },
  controllers : { get : function() { if (this.main) return this.main.controllers; }, enumerable : true },
//  app : { get : function() { return moduleManager.app; }, enumerable : true },
  modulesCount : { get : function() { return this._modulesCount; }, enumerable : true },
  isInstalled : { get : function() { return this._state & FLAG_INSTALLED; }, enumerable : true },
  isEnabled : { get : function() { return this._state & FLAG_ENABLED; }, enumerable : true },
  isGroup : { get : function() { return (null == this.main); }, enumerable : true },
  hasInstalledSubmodule : { get : function() { return hasInstalledSubmodule(this); }, enumerable : true },
  hasEnabledSubmodule : { get : function() { return hasEnabledSubmodule(this); }, enumerable : true }
});

/** 
 * Get or set meta data information of this module. This method sets the meta value only if it does not exist.
 */
proto.meta = function(name, value) {
  if (null == value) {
    return this.getMeta(name);
  } else {
    this.setMeta(name, value);
  }
};

proto.getMeta = function(name) {
  var ownMeta = this._meta[name];
  if (this.parent) {
    var parentMeta = this.parent.getMeta(name);
    if (null != parentMeta) {
      if (typeof ownMeta !== typeof parentMeta || null == ownMeta) return parentMeta;
    }
  }
  return ownMeta;
};

proto.setMeta = function(name, value) {
  this._meta[name] = value;
};

/** 
 * Get or set custom data of key-value pair, will recurse by searching the parents
 */
proto.data = function(name, value) {
  if (null == value) {
    return this.getData(name);
  } else {
    this.setData(name, value);
  }
};

proto.getData = function(name, recursive) {
  if (name in this._data) return this._data[name];
  if (recursive && this.parent) return this.parent.data(name);
};

proto.setData = function(name, value) {
  this._data[name] = value;
};

proto.getRoute = function(identifier) {
  return this._routes[identifier] || '';
};
proto.setRoute = function(identifier, route) {
  if (identifier) {
    if (identifier in this._routes) throw new Error('Duplicate action identifier');
    else this._routes[identifier] = route;
  }
};

proto.getDefaultView = function(viewName) {
  if (typeof viewName !== 'string') return;
  var type = this.getMeta('defaultViewType');
  return defaultViews[type][viewName];
};

/** Get a submodule */
proto.getModule = function(name) {
  if (typeof name === 'string') return this.modules[name];
};

/** Get a model */
proto.getModel = function(name) {
  if (typeof name !== 'string') name = '';
  return this.models[name];
};

/** Get a view */
proto.getView = function(name) {
  if (typeof name !== 'string') name = '';
  return this.views[name];
};

/** Get a controller */
proto.getController = function(name) {
  if (typeof name !== 'string') name = '';
  return this.controllers[name];
};

proto.getMethod = function(name) {
  if (typeof name !== 'string') name = '';
  return this.methods[name];
};

proto.add = function(submodule) {
  this.modules[submodule.name] = submodule;
  if (submodule.parent) {
    delete submodule.parent.modules[submodule.name];
  }
  submodule.parent = this;
  this._modsCount++;
};

var optionsCbSpecs = [['object', {}],['function', noop]];

proto.install = jsx.mapArgs(optionsCbSpecs, function(options, cb) {
  var mod = this;
  if (mod.isGroup || mod.isInstalled || !mod.parent.isInstalled) return cb();
  var installed = function(err) {
    if (!err) {
      changeState(mod, FLAG_INSTALLED, true);
      logger.debug("Module {%s} has been installed", mod.id);
    }
    cb(err);
  };
  if (typeof mod.main.install === 'function') {
    try {
      mod.main.install(options, installed);
    } catch (err) {
      logger.error("Failed executing install method in module %s", mod.id);
    }
  } else {
    installed();
  }
});

proto.installAll = jsx.mapArgs(optionsCbSpecs, function(options, cb) {
  var mod = this;
  mod.install(options, function(err) {
    if (err) return cb(err);
    if (mod._modulesCount === 0) return cb();
    var submodules = getSubmodSortedByPriority(mod);
    jsx.async.forEach(submodules, function(submod, done){ submod.installAll(options, done); }, cb);
  });
});

proto.uninstall = jsx.mapArgs(optionsCbSpecs, function(options, cb) {
  var mod = this;
  if (mod.isGroup || !mod.isInstalled || mod.hasInstalledSubmodule) return cb();
  var uninstalled = function(err) {
    if (!err) {
      changeState(mod, FLAG_INSTALLED, false);
      logger.debug("Module {%s} has been uninstalled", mod.id);
    }
    cb(err);
  };
  mod.disableAll(function(err){
    if (err) return cb(err);
    if (typeof mod.main.uninstall === 'function') {
      try {
         mod.main.uninstall(options, uninstalled);
      } catch (err) {
        logger.error("Failed executing uninstall method in module %s", mod.id);
      }
    } else {
      uninstalled();
    }
  });
});

proto.uninstallAll = jsx.mapArgs(optionsCbSpecs, function(options, cb) {
  var mod = this;
  var submodules = getSubmodSortedByPriority(mod).reverse();
  jsx.async.forEach(submodules, function(submod, done){ submod.uninstallAll(options, done); }, function(err){
    if (err) return cb(err);
    mod.uninstall(options, cb);
  });
});

proto.enable = function(cb) {
  var mod = this;
  if (!mod.isGroup && mod.isInstalled && mod.parent.isEnabled) {
    if (!mod.isEnabled) changeState(mod, FLAG_ENABLED, true);
    mountModule(mod);
  }
  if (typeof cb === 'function') process.nextTick(cb); 
};

proto.enableAll = function(cb) {
  cb = cb || noop;
  var mod = this;
  mod.enable(function(){
    if (mod._modulesCount === 0) return cb();
    var submodules = getSubmodSortedByPriority(mod);
    jsx.async.forEach(submodules, function(submod, done){ submod.enableAll(done); }, cb);
  });
};

proto.disable = function(cb) {
  var mod = this;
  if (!mod.isGroup && !mod.hasEnabledSubmodule) {
    unmountModule(mod);
    if (mod.isEnabled) changeState(mod, FLAG_ENABLED, false);
  }
  if (typeof cb === 'function') process.nextTick(cb); 
};

proto.disableAll = function(cb) {
  cb = cb || noop;
  var mod = this;
  var submodules = getSubmodSortedByPriority(mod).reverse();
  jsx.async.forEach(submodules, function(submod, done){ submod.disableAll(done); }, function(){
    mod.disable(cb);
  });
};

/** Sync installed/uninstalled/enabled/disabled state between cluster workers */
proto.syncState = function(state) {
  //this._state = (this._state & ~FLAG_INSTALLED) | (state & FLAG_INSTALLED);
  var isEnabledNew = stateEnabled(state);
  var isEnabledOld = this.isEnabled;
  this._state = state;
  if (isEnabledNew !== isEnabledOld) {
    if (isEnabledNew) this.enable();
    else this.disable();
  }
};

/** Search for a path to a view given the name in the current module and its parents */
proto.resolveView = function(viewName, controllerName, checkParent) {
  var mod = this;
  if (!mod.isEnabled && !mod.isGroup) return;
  var viewEngine = mod.getMeta('viewEngine') || mod.manager.app.get('view engine');
  var viewPath;
  if (controllerName) {
    var cpvname = controllerName + '/' + viewName;
    viewPath = mod.main.views[cpvname] || mod.main.views[cpvname + '.' + viewEngine];
  }
  if (!viewPath) viewPath = mod.main.views[viewName] || mod.main.views[viewName + '.' + viewEngine];
  
  if (!viewPath && checkParent) {
    if (mod.parent) {
      viewPath = mod.parent.resolveView(viewName, controllerName, checkParent);
    } else {
      //lookup the app level views
      var appViews = mod.manager.app.get('views');
      if (appViews) {
        viewPath = path.join(appViews, viewName + '.' + viewEngine);
        if (path.exists(viewPath)) return viewPath;
        viewPath = path.join(appViews, viewName, 'index' + '.' + viewEngine);
        if (path.exists(viewPath)) return viewPath;
      }
    }
  }
  
  return viewPath;
};

proto.routePathTo = function routePathTo(relativeRoute) {
  // replace multiple slashes (//) with a single one
  return (this.routePath + relativeRoute).replace(/^\/+/, '/');
};

/**
 * Mount any route handler in this module to itself or to another module with the route: [module|interface|absolute_route]/route
 * @param {Object}            params                Named parameters
 * @param {String}            params.route          The relative route.
 * @param {Function[]}        params.callbacks      The callbacks to handle HTTP response.
 * @param {Object|String}    [params.to]            Specify a module name or either one these, resolved in order of: route | interface | module
 * @param {String}           [params.to.absroute]   An absolute base route path that will be prepended to the route. Ie: `params.absroute/route`
 * @param {String}           [params.to.interface]  Request to adds the controller to the specified interface, if exists.
 * @param {String|AppModule} [params.to.module]     Request to adds the controller to the specified module id, if exists. Default is the owner/current module.
 * @param {String}           [params.method='GET']  The HTTP method to be handled.
 * @param {String}           [params.name]          If specified, the route path will be accessible with the given name in the url view helper.
 * @param {String}           [params.label]         If specified, the parent module will be notified that the handler has been added.
 */
proto.mount = function mount(params) {
  var mod = this;
  var action = params.action;
  if (!action) {
    var base;
    if (params.to) {
      if (typeof params.to === 'string') params.to = { interface:params.to, module:params.to };
      base = resolveBase(mod, params.to);
    } else {
      base = {route:mod.routePath, module:mod};
    }
    var route = joinUrl(base.route, params.route) || '/'; //if route is an empty string, mount as root
    action = createAction(mod, base.module, params.name, params.label, params.method, route, params.callbacks);
  }
  //mod._event.emit('mount', route, params.label);
  //if (params.label) base.module.registerResource(mod, params.label, route);
  //if (params.actionName) base.module._namedRoutes[params.actionName] = route;
  logger.debug('Module {%s} mountTo: %s %s', mod.id, action.method, action.route);
  mountToRoute(action);
  return action.route;
};

/**
 * Mount the controller to the route: module_base_route/controller_name
 * @param {Object} controller  The controller object or path to the js file, relative to the module dir.
 * @param {String}|Object} params :
 * @param {String} params.name Name of the controller, will be used in the routing path.
                               Use string 'index' to mount the controller as the default module handler.
 * Specify either one these, resolved in order of: route | interface | module
 * @param {String} params.interface Request to adds the controller to the specified interface, if exists.
 * @param {String} params.module    Request to adds the controller to the specified module (namespaced), if exists. Default will mount the controller to the parent module.
 * @param {String} params.absroute  An absolute base route path to mount the controller to, instead of the module base route. Ie: baseRoute/name
 */
proto.mountController = function mountController(controller, params) {
  var mod = this;
  if (null == controller) {
    logger.error('Module {%s} mountController() : controller is not specified', mod.namespace);
    return;
  }
  params = params || {}; //if undefined, set as object
  if (typeof params === 'string') params = {name:params}; //if string, use as name
  else throw new TypeError('params must be a String or an Object');

  controller._mountTo = controller._mountTo || {};
  controller._mountTo.absroute = params.absroute || controller._mountTo.absroute;
  controller._mountTo.interface = params.interface || controller._mountTo.interface;
  controller._mountTo.module = params.module || controller._mountTo.module;
  
  controller = Controller.create(mod, controller, params.name, params.label);
  var baseMod = controller.baseModule;
  
  // Notify the module that this controller is mounted to (baseModule)
  baseMod._event.emit('mount', {controller:controller});
  
  // Add actions to express route
  controller.actions.forEach(function(action) {
    if (action.callbacks.length > 0) baseMod.mount({action:action});
  });
  
};

// Create anonymous action
function createAction(mod, baseMod, name, label, method, route, callbacks) {
  //attach action to a generic anonymous controller
  var controller = mod._tempController[baseMod.id];
  if (!controller) {
    controller = mod._tempController[baseMod.id] = Controller.create(mod, {_mountTo:{module:baseMod}}, '', '');
  }
  var action = Action.create({
    name : name,
    label : label,
    route : route,
    method : method,
    controller : controller,
    callbacks : callbacks
  });
  controller.actions.push(action);
  return action;
}

proto.mountControllers = function() {
  for (var key in this.controllers) this.mountController(this.controllers[key]);
};

/**
 * Load the model to be made available to self and other modules.
 * @param {String|Object} model The model object or path to the js file, relative to the module dir.
 * @param {String|Object} [params] If string, same as params.name.
 * @param {String} [params.name] Name of the model. If omitted, the model.modelName property will be used.
 */
proto.addModel = function addModel(model, params) {
  var mod = this;
  params = params || {};
  var name = (typeof params === 'string') ? params : params.name ;
  model = addObject(mod, model, mod.models, 'model', name);
  if (model) {
    logger.debug('Module {%s} Add model: `%s`', mod.id, model.modelName);
  }
};


/** Load all models from a directory. Non recursive */
proto.addModels = function addModels(pathToDir) {
  var mod = this;
  if (mod.isGroup || !mod.models) return;
  var basePath = path.resolve(mod.path, pathToDir);
  eachFileInDir(basePath, function(name, fullpath) {
    try {
       mod.addModel(fullpath); 
    } catch (err) {
      logger.error('Module {%s} Error loading model at %s', mod.id, fullpath);
      logger.error(err);
    }
  });
};

/**
 * Add a controller to the module
 * @param {String|Object}  controller    The controller object or path to the js file, relative to the module dir.
 * @param {Object}         params
 * @param {String}        [params.name]  Name of the controller, will be used in the routing path. If not specified, the name of the js file will be used. 
 *                                       Use string '/' or 'default' or 'index' to mount the controller as the default module handler.
 * Specify either one these, resolved in order of: route | interface | module
 * @param {String}        [params.absroute]     An absolute base route path to mount the controller to, instead of the module base route. Ie: baseRoute/name
 * @param {String}        [params.interface] Add the controller to the specified interface, if exists.
 * @param {String}        [params.module]    Add the controller to the specified module id, if exists. Default will mount the controller to the parent module.
 * @param {String}        [params.handler]   A handler in the specified interface/module
 * @param {String}        [params.layout]    Absolute or relative path to layout template file.
 */
proto.addController = function addController(controller, params) {
  var mod = this;
  if (typeof params === 'string') params = {name:params};
  else params = params || {};
  var name = params.name;
  if (params.name === '/' || params.name === 'default') name = 'index';
  controller = addObject(mod, controller, mod.controllers, 'controller', name);
  if (controller) {
    logger.debug('Module {%s} Add controller: `%s`', mod.id, controller.controllerName);
  }
  
  controller._mountTo = {absroute:params.absroute, interface:params.interface, module:params.module};
  
  //if (typeof controller._init === 'function') controller._init(mod, moduleManager);
  //logger.debug('{%s} load and init controller `%s`', mod.namespace, name);
};

/** Load all js files from a directory. Non recursive */
proto.addControllers = function addControllers(pathToDir, params) {
  var mod = this;
  if (mod.isGroup || !mod.models) return;
  var basePath = path.resolve(mod.path, pathToDir);
  eachFileInDir(basePath, function(name, fullpath) {
    try {
      mod.addController(fullpath, params);
    } catch (err) {
      logger.error('Module {%s} Error loading controller at %s', mod.id, fullpath);
      logger.error(err);
    }
  });
};

proto.addDefaultController = function addDefaultController(pathOrController) {
  this.addController(pathOrController, {name:'index'});
};

proto.addView = function addView(pathToTemplate, name) {
  var mod = this;
  var fullpath = path.resolve(mod.path, pathToTemplate);
  if (!name) name = path.basename(pathToTemplate);
  mod.views[name] = fullpath;
};

proto.addViews = function addViews(pathToDir) {
  var mod = this;
  if (mod.isGroup || !mod.models) return;
  var basePath = path.resolve(mod.path, pathToDir);
  eachFileInDir(basePath, function(name, fp) {
    try {
      mod.addView(fp, path.relative(basePath, fp));
    } catch (err) {
      logger.error('Module {%s} Error loading views: %s', this.id, pathToDir);
      logger.error(err);
    }
  }, true);
};


proto.on = function(event, callback) {
  if (typeof callback === 'function') this._event.addListener(event, callback);
};

proto.onInstall = function(installerCallback) {
  if (typeof installerCallback === 'function') this._event.addListener('install', installerCallback);
};

proto.onUninstall = function(uninstallerCallback) {
  if (typeof uninstallerCallback === 'function') this._event.addListener('uninstall', uninstallerCallback);
};

proto.onInit = function(initializerCallback) {
  if (typeof initializerCallback === 'function') this._event.addListener('init', initializerCallback);
};

proto.onMount = function(callback) {
  if (typeof callback === 'function') this._event.addListener('mount', callback);
};

/////////////////////////////////////////////////////////////////////////////////////////
// private apis


function noop(){}

function stateEnabled(state) {
  return state & FLAG_ENABLED;
}

function changeState(mod, stateFlag, isSet) {
  mod._state = isSet ? (mod._state | stateFlag) : (mod._state & ~stateFlag);
  mod.manager.moduleState.set(mod.id, mod._state);
}

/** 
 * Resolve id by prepending namepace generated by recursively concatenating parents' name.
 * If the module has no parent and no name, it will return an empty string.
 */
function resolveId(mod) {
  if (null == mod) return '';
  if (null == mod._id) {
    mod._id = resolveId(mod.parent);
    if (mod._id.length > 0) mod._id += '.';
    mod._id += mod.name;
  }
  return mod._id;
}


/** Calculates the absolute route path of a module */
function resolveAbsRoutePath(mod) {
  if (!mod._routePath) {
    var parentPath = '';
    var relPath = mod.getMeta('route') || '';
    if (!relPath || relPath[0] !== '/') {
      parentPath = '/';
      if (mod.parent) {
        parentPath = resolveAbsRoutePath(mod.parent);
        if (parentPath[parentPath.length-1] !== '/') parentPath = parentPath + '/';
      }
    }
    mod._routePath = parentPath + relPath;
  }
  return mod._routePath;
}
function protoResolveAbsRoutePath() { return resolveAbsRoutePath(this); }



function hasInstalledSubmodule(mod) {
  for (var key in mod.modules) {
    if (mod.modules[key].isInstalled) return true;
  }
  return false;
}


function hasEnabledSubmodule(mod) {
  for (var key in mod.modules) {
    if (mod.modules[key].isEnabled) return true;
  }
  return false;
}


/** Mount routes defined by modules */
function mountModule(mod) {
  if (!mod.main && mod._routesMarker) return;
  var autoMount = mod.getMeta('autoMount');
  var marker = mod._routesMarker = {};
  var routes = mod.manager.app.routes;
  jsx.forEach(routes, function(val, key) {
    marker[key] = {start:val.length, count:0};
  });
  
  if (typeof mod.main.init === 'function') mod.main.init(mod);
  if (autoMount) mod.mountControllers();
  
  jsx.forEach(routes, function(val, key) {
    if (!(key in marker)) marker[key] = {start:0, count:0};
    marker[key].count = val.length - marker[key].start;
  });
}

function unmountModule(mod) {
  if (!mod._routesMarker) return;
  var routes = mod.manager.app.routes;
  jsx.forEach(mod._routesMarker, function(marker, key) {
    if (marker.count > 0) routes[key].splice(marker.start, marker.count);
  });
  delete mod._routesMarker;
}

function getSubmodSortedByPriority(mod) {
  var priorities = [];
  var noprio = [];
  for (var key in mod.modules) {
    var subm = mod.modules[key];
    var index = subm.getMeta('priority');
    if (null == index) {
      noprio.push(subm);
    } else {
      if (!priorities[index]) priorities[index] = [];
      priorities[index].push(subm);
    }
  }
  priorities.push(noprio);
  return jsx.array.flatten(priorities);
}

function mountToRoute(action) {
  var attachAction = function(req, res, next) {
    res.locals._action = action;
    next();
  };
  var mod = action.controller.module;
  var baseMod = action.controller.baseModule;
  var identifier = action.toString();
  try {
    mod.manager.app[action.method](action.route, attachAction, action.callbacks);
    mod.setRoute(identifier, action.route);
    mod._event.emit('mount', {action:action});
    if (mod !== baseMod) {
      baseMod.setRoute(identifier, action.route);
      baseMod._event.emit('mount', {action:action});
    }
    logger.debug('mounted route: [%s] %s %s', action.name, action.method, action.route);
  } catch (e) {
    logger.error(e);
  }
}

function addObject(mod, objectOrPath, container, label, name) {
  if (mod.isGroup || !container) return;
  var obj, tempobj, filepath='';
  if (typeof objectOrPath === 'string') {
    filepath = objectOrPath;
    // Resolve path and load object
    filepath = path.resolve(mod.path, filepath);
    obj = require(filepath);
  } else if (!(obj instanceof Object)) {
    throw new TypeError('Module {%s} Cannot add %s. Argument must be an object or a string.', mod.id, label);
  }
  if (typeof obj === 'function') tempobj = obj(mod);
  if (tempobj instanceof Object) obj = tempobj;
  
  // Automatic naming based on name property and filename
  name = name || obj[label+'Name'];
  if (!name) {
    if (filepath) name = path.basename(filepath, '.js');
    else throw new Error('Module {%s} The %s name must be specified.', mod.id, label);
  }
  
  obj[label+'Name'] = name;
  container[name] = obj;
  return obj;
}
