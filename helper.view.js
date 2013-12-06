'use strict';


/** 
 * Get the mounted URL for a module, controller, action and static assets 
 * type : 'module', 'controller', 'action', or 'static'
 * name : name of the entity
 * params : Array of string or number to replace the parameters in the route
 *          For example: with params ['1','2'], /:site/user/:id/changePassword 
            will become /1/user/2/changePassword
 */
helper.url = function(type, name, params) {
  helper.url[type](name, params);
}
helper.url.action = 