'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');
//var async = require('async');
var express = require('express');
var jsx = require('jsx');
var configManager = require('./configManager');
var middleware = require('./middleware');
var AppModule = require('./AppModule');
var formatRenderers = require('./formatRenderers');


/** Create a new ModuleManager */
var ModuleManager = module.exports = function ModuleManager(options, instanceId) {
  instanceId = jsx.def(instanceId, 0, ['number','string']);
  var manager = this;
  var app = express();
  var config = ensureDefaults(configManager.load(options, app.get('env')));
  var logger = config.createLogger(module);
  var appRootPath = path.dirname(require.main.filename);
  
  /*  
    monkey patch: add response.resolve to provide adaptive response based on requested content type 
    and to look up the views provided in modules
    options: {
      data : {
        fields 
        record
        records
  */
  app.response.resolve = function(options, fn) {
    options = jsx.def(options, {}, ['object']);
    var res = this;
    var req = res.req;
    var controller = res.locals._action.controller || {};
    var format = req.format || controller.defaultFormat || 'html';
    var renderers = controller.renderers || config.renderers;
    var renderer = renderers[format] || config.renderers[format] || formatRenderers['default'];
    renderer(res, options, fn);
  };
  
  // setup express app
  app.locals._user = null;
  app.set('config', config);
  app.set('view engine', config.viewEngine);
  for (var key in config.viewEngines) app.engine(key, config.viewEngines[key]);
  if (config.behindProxy) app.enable('trust proxy');
  if (config.paths.views) app.set('views', path.resolve(appRootPath, config.paths.views));
  if (!path.exists(app.get('views'))) app.set('views', undefined);
  app.use(express.favicon());
  app.use(middleware.methodOverride(config.methodOverrideKey));
  app.use(middleware.formatResolver(formatRenderers));
  if (config.useMiddleware.cookie) app.use(express.cookieParser(config.cookieSecret));
  if (config.useMiddleware.session) app.use(express.session());
  app.use(middleware.localizeUser());

  var setupCustom = config.useMiddleware.custom;
  if (typeof setupCustom === 'function') setupCustom(app, express);
  
  app.use(app.router);
  var lessMiddleware = config.useMiddleware.less ? require('less-middleware') : undefined;
  // config.paths.publicDirs.forEach(function(p) {
    // var rpath = path.resolve(appRootPath, p);
    // if (jsx.fsx.sync.dirExists(rpath)) {
      // app.use(express.static(rpath));
    // }
  // });
  jsx.forEach(config.paths.assets, function(pathPairs, routeName) {
    jsx.forEach(pathPairs, function(privatePath, publicPath) {
      if (publicPath) publicPath = path.resolve(appRootPath, publicPath);
      if (privatePath) privatePath = path.resolve(appRootPath, privatePath);
      if (publicPath && jsx.fsx.sync.dirExists(publicPath)) {
        if (privatePath && jsx.fsx.sync.dirExists(privatePath)) {
          if (lessMiddleware) app.use(lessMiddleware({ src:privatePath, dest:publicPath }));
        }
        app.use(routeName, express.static(publicPath));
      }
    });
  });

  // setup modex object
  var moduleState = configManager.runtime('m'+instanceId);
  var modulesPath = path.resolve(appRootPath, config.paths.modules);
  Object.defineProperties(manager, {
    instanceId    : { value:instanceId },
    app           : { value:app },
    config        : { value:config },
    moduleState   : { value:moduleState, writable: true },
    server        : { value:{}, writable: true },
    logger        : { value:logger },
    middleware    : { value:{} },
    _modMap       : { value:
      {
        all : [], //indexed by load order
        byName : {}, //indexed by name
        byId : {} //indexed by id (namespaced name)
      } 
    },
    _rootModule : { value:{}, writable: true }
  });
  manager.middleware.parseBody = middleware.bodyParserNoMultipart();
  manager.middleware.parseBodyUpload = express.bodyParser({ keepExtensions: true, uploadDir: config.paths.tempUpload });
  
  // Load all the modules from file system
  // root module has no name
  manager._rootModule = loadModule(manager, '', modulesPath); 
  updateRelationship(manager._modMap.byId);
  
  // Initialize modules and set their state
  manager._modMap.all.forEach(function(mod) {
    var state = moduleState.get(mod.id);
    AppModule.init(mod, state);
  });
  
};

/** Create a new ModuleManager */
ModuleManager.create = function(options, instanceId) {
  return new ModuleManager(options, instanceId);
};

var proto = ModuleManager.prototype;

['install', 'uninstall', 'enable', 'disable'].forEach(function(methodName) {
  proto[methodName] = function(mods, cb) {
    var manager = this;
    var saveState = function() {
      manager.moduleState.save();
      if (typeof cb === 'function') cb();
    };
    if (mods && mods.length > 0) {
      jsx.async.forEach(mods, function(name, done){ 
        manager.getModule(name)[methodName](done); 
      }, saveState);
    } else {
      this._rootModule[methodName + 'All'](saveState);
    }
  };
});

proto.start = function(cb) {
  var manager = this;
  var config = manager.config;
  function run(runtimeConfig) {
    // Initialise loaded modules
    manager._rootModule.enableAll();   
    manager.moduleState = runtimeConfig;
    manager.server = http.createServer(manager.app);
    manager.server.listen(config.port, function() {
      manager.logger.info('%s version %s listening on port %d in %s mode', config.appName, config.appVersion, config.port, manager.app.get('env'));
      if (typeof cb === 'function') process.nextTick(cb);
    });
  }
  function onSyncState(modId, state) {
    manager.getModuleById(modId).syncState(state);
  }
  require('./clustering')(manager.instanceId, manager.logger, config.workerProcesses, run, onSyncState);
};

proto.debug = function() {
  jsx.algorithm.dfsTree(this._rootModule, 
    function(mod) {
      var installed = mod.isInstalled ? 'yes' : 'no';
      var enabled = mod.isEnabled ? 'yes' : 'no';
      console.log('{%s} installed: %s, enabled: %s', mod.id, installed, enabled);
    },
    function(mod) { return mod.modules; });
};

//proto.notifyStateChange = function(modId, state) {};

proto.getModule = function(nameOrId) {
  return this.getModuleById(nameOrId) || this.getModuleByName(nameOrId);
};

proto.getModuleById = function(name) {
  return this._modMap.byId[name];
};

proto.getModuleByName = function(name) {
  return this._modMap.byName[name];
};

/** Get module by interface name */
proto.getInterface = function(name) {
  return this.getModule(this.config.interfaces[name]);
};

// helper functions


function loadModule(manager, name, abspath, parentMod) {
  var modMap = manager._modMap;
  try {
    if (!fs.statSync(abspath).isDirectory()) return;
  } catch (err) {
    manager.logger.error('Error loading module "%s". Invalid path: %s.', name, abspath);
  }
  var mod = AppModule.create(manager, {name:name, path:abspath, parent:parentMod});
  modMap.all.push(mod);
  var files;
  // Check if it is a valid module
  if (mod.main) {
    if (!(mod.name in modMap.byName)) modMap.byName[mod.name] = mod;
    if (!(mod.id in modMap.byId)) modMap.byId[mod.id] = mod;
    
    // Automatically load submodules from directories under the `modules` subdirectory
    var smpath = path.join(mod.path, 'modules');
    files = [];
    try { files = fs.readdirSync(smpath); } catch(err) {}
    files.forEach(function(submod){
      loadModule(manager, submod, path.join(smpath, submod), mod);
    });
    
    // Automatically load submodules defined in package.json
    var submodules = mod.meta('submodules');
    if (Array.isArray(submodules)) {
      submodules.forEach(function(submod){
        loadModule(manager, path.basename(submod), path.join(mod.path, submod), mod);
      });
    }
  } else {
    // not a module, must be a module namespace/grouping
    // load each subdir directly as submodules
    files = fs.readdirSync(mod.path);
    files.forEach(function(submod){
      loadModule(manager, submod, path.join(mod.path, submod), mod);
    });
  }
  
  return mod;
}



function customMiddleware(app, express) {
  if (app.get('env') === 'development') {
    app.use(express.logger('dev'));
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  } else if (app.get('env') === 'production') {
    app.enable('view cache');
    app.use(express.logger('tiny'));
    app.use(express.errorHandler());
  }
}

function ensureDefaults(config) {
  // template engines
  var ejs_locals = require('ejs-locals');
  var html_view_engine = require('./html_view_engine');
  var pjson = require('./package.json');
  
  config = config || {};
  var defaults = {
    appName : pjson.name,
    appVersion : pjson.version,
    port : 3000,
    host : 'localhost',
    workerProcesses : 1,
    logLevel : 'debug',
    cookieSecret : 'dEfAuLtC00kiEsECret',
    behindProxy : false,
    viewCache : false,
    viewEngine : 'ejs',
    viewEngines : { 'ejs': ejs_locals, 'html': html_view_engine },
    interfaces : {},
    modules : { 
      _ : {
        defaultViewType : 'basic', 
        publicDirs : ['public', 'statics'], 
        autoLoad : { models : 'models', controllers : 'controllers' , views : 'views'},
        autoMount : true
      }
    },
    paths : { 
      modules : 'modules', 
      tempUpload : undefined,
      publicDirs : ['public', 'statics'], 
      assets : { '/public' : { 'assets/public' : 'assets/private'} } },
    createLogger : jsx.createLogger,
    useMiddleware : {
      less : true,
      cookie : true,
      session : true,
      custom : customMiddleware
    },
    renderers : formatRenderers,
    controllers : {
      map: {
        'index'   : {method:'get',   route:''},
        'list'    : {method:'get',   route:''},
        'create'  : {method:'post',  route:''},
        'new'     : {method:'get',   route:';new'},
        'show'    : {method:'get',   route:'/:id'},
        'update'  : {method:'put',   route:'/:id'},
        'delete'  : {method:'delete',route:'/:id'},
        'destroy' : {method:'delete',route:'/:id'},
        'edit'    : {method:'get',   route:'/:id;edit'}
      }
    },
    methodOverrideKey : '_method'
  };
  jsx.object.mergeDefaults(defaults, config);
  return config;
}

// fix parent-child relationship
function updateRelationship(mapById) {
  for (var key in mapById) {
    var m = mapById[key];
    var parentName = m.meta('parent');
    if (parentName) {
      var parent = mapById[parentName];
      if (parent) {
        parent.add(m);
        mapById[m.id] = m;
        delete mapById[key];
      }
    }
  }
}



