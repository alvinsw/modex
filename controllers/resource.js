/**
 * A basic controller to manage a resource/entity.
 * Default actions:
 *  - GET : list  show  new  edit  confirmDelete
 *  - POST: create, modify
 *  - PUT : update, multiUpdate
 *  - DELETE : delete  multiDelete
 * Options:
 *   name : String : Name of the controller (Optional)
 *   model : Object - A moongose model or any other types of model that provide compatible interface. (Required)
 *   actions : String - Specify default handlers. Use '-' prefix to specify exclusion list.
 *     Eg: 'list show' will only include list and show. '- new delete' will exclude both new and delete. Default will include all default handlers. (Optional)
 *   defaultFormat: String - A choice of the following: 'json', 'html', 'xml'. Default is 'html'. (Optional)
 *   allowedFormats : [String] - Allowed view types that can be rendered. Eg: ['html']. Default is none. (Optional)
 */

'use strict';

var resource = module.exports = function(mod, options) {

  var parseBody = mod.manager.middleware.parseBody;
  
  var c = mod.createController(options);
  c.addAction
  
  return c;
};  

var proto = resource.prototype;


var baseController = require('./controllers/base');

function createController(base, options) {
  var mod = this;
  if (null == options) {
    options = base;
    base = baseController;
  }
  if (null == base) base = baseController;
  if (typeof base === 'string') {
    base = mod.manager.controllers[base];
    
  }
}