/*
 * A helper class for Express.js modular framework.
 * This class holds metadata information of a controller and action.
 */

'use strict';

var joinUrl = require('./utils').joinUrl;
var resolveBase = require('./utils').resolveBase;

/** Create a new Action */
var Action = module.exports = function(params) {
  this.name = this.actionName = params.name || '';
  this.label = params.label || capitalize(params.name) || '';
  this.route = params.route || '';
  this.method = params.method.toLowerCase() || 'get';
  this.controller = params.controller || {};
  if (Array.isArray(params.callbacks)) {
    this.callbacks = params.callbacks;
  } else {
    var pre = Array.isArray(params.pre) ? params.pre.filter(filterFunction) : [];
    var post = Array.isArray(params.post) ? params.post.filter(filterFunction) : [];
    this.callbacks = [].concat(pre, params.callback, post);
  }
};

Action.create = function(params) {
  return new Action(params);
};

Action.prototype.toString = function() {
  var arr = [this.controller.module.id];
  if (this.controller.controllerName) arr.push(this.controllerName);
  if (this.actionName) arr.push(this.actionName);
  return arr.join('.');
};


var Controller = module.exports = function(mod, controller, name, label) {
  var defaultMap = mod.manager.config.controllers.map;
  if (!controller._mountTo) controller._mountTo = {};
  name = name || controller.controllerName || '';
  var rname = name;
  if (name.length) {
    // filter name containing dot. For example, `user.backend` means `backend_base_route/user`
    var dotPos = name.indexOf('.');
    if (dotPos > -1) {
      controller._mountTo.interface = controller._mountTo.module = name.slice(name.indexOf('.')+1);
      rname = name.slice(0, name.indexOf('.'));
    }
  }
  label = label || controller.label || (rname.length ? capitalize(rname) : '');
  // Resolve route base path
  var base = resolveBase(mod, controller._mountTo);
  var route = joinUrl(base.route, (rname === 'index' ? '' : rname));
  var actions = [];
  // if actions array is undefined, the default is to use all the exported functions
  var actionNames;
  if (typeof controller.actions === 'string') {
    actionNames = controller.actions.split(/\s+/);
    if (actionNames[0] === '-') {
      var allActions = Object.keys(controller);
      actionNames = allActions.filter(function(a){ return actionNames.indexOf(a) < 0; });
    }
  } else if (Array.isArray(controller.actions)) {
    actionNames = controller.actions;
  } else {
    actionNames = Object.keys(controller);
  }
  actionNames.forEach(function(actionName){
    var actionfn = controller[actionName];
    if (actionName[0] === '_' || typeof actionfn !== 'function') return;
    var actionRoute = controller[actionName+'_absroute'];
    if (!actionRoute) {
      actionRoute = controller[actionName+'_route'];
      if (null == actionRoute) actionRoute = defaultMap[actionName].route;
      if (null == actionRoute) actionRoute = actionName || '';
      actionRoute = joinUrl(route, actionRoute);
    }
    var action = Action.create({
      name   : actionName,
      label  : controller[actionName + '_label'],
      route  : actionRoute,
      method : controller[actionName+'_method'] || defaultMap[actionName].method,
      pre    : controller[actionName+'_pre'],
      post   : controller[actionName+'_post'],
      callback : actionfn,
      controller : this
    });
    actions.push(action);
  });
  
  this.name = this.controllerName = name;
  this.label = label;
  this.module = mod; // module where the controller code is located
  this.baseModule = base.module; // module where the controller route is mounted to 
  this.route = route;
  this.actions = actions;
  this._viewPathCache = {};
  this._defaultMap = defaultMap;
};

Controller.create = function(mod, controller, name, label) {
  return new Controller(mod, controller, name, label);
};

/**
 * Return viewName if full path cannot be resolved.
 */
Controller.prototype.resolveView = function(viewName) {
  //resolve view
  //1. Check the view in the module that owns the controller (/path/to/module/views)
  //2. Check the view in the module where the controller is mounted
  //3. Use the app level default views path
  //4. Lookup the views provided by modex
  var controller = this;
  var viewPath = controller._viewPathCache[viewName];
  if (!viewPath) {
    viewPath = controller.module.resolveView(viewName, controller.controllerName, false);
    if (!viewPath) {
      viewPath = controller.baseModule.resolveView(viewName, controller.controllerName, true);
      if (!viewPath) viewPath = controller.module.getDefaultView(viewName) || viewName;
    }
    controller._viewPathCache[viewName] = viewPath;
  }
  return viewPath;
};

function filterFunction(obj) {
  return (typeof obj === 'function');
}

function capitalize(text) {
  return text[0].toUpperCase() + text.slice(1);
}