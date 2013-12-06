'use strict';

//////////////////////////////////////////////////////////////////////////////
// Renderers

var js2xmlparser = require('js2xmlparser');
var viewHelper = require('./helper.view');
var isAbsolutePath = require('./utils').isAbsolutePath;
var noviewPath = './views/noview.ejs';

var renderers = module.exports = {};

['application/json', 'application/javascript', 'text/json', 'text/javascript', 'json'].forEach(function(label){ renderers[label] = jsonRenderer; });
['application/xml', 'application/xhtml+xml', 'text/xml', 'xml'].forEach(function(label){ renderers[label] = xmlRenderer; });
['text/html', 'html'].forEach(function(label){ renderers[label] = htmlRenderer; });
['text/plain', 'text'].forEach(function(label){ renderers[label] = textRenderer; });
['text/csv', 'csv'].forEach(function(label){ renderers[label] = csvRenderer; });


renderers['unknown'] = renderers['default'] = function(res) {
  res.send(406, 'Unsupported format: "' + res.req.format + '"');
};

function jsonRenderer(res, options) {
  var obj = {};
  if (options.data) {
    if (options.data.record) obj = options.data.record;
    else if (options.data.records) obj = options.data.records;
  } else if (options.json) {
    obj = options.json;
  } else {
    obj = options.message;
  }
  res.json(obj);
//  if (options.data.records.length === 1) res.json(options.data.records[0]);
//  else res.json(options.data.records);
};

/** 
 * Render an xml with either a view template or an automatic conversion from json object. 
 * Xml renderer does not support layout. 
 */
function xmlRenderer(res, options) {
  res.set('Content-Type', 'application/xml');
  var data = options.data || {};
  var viewName = options._view;
  if (viewName) {
    // set view helper;
    res.locals._ = viewHelper.getInstance(viewName);
    // find view full path
    var viewPath = viewName;
    if (!isAbsolutePath(viewPath)) {
      var controller = res.locals._action ? res.locals._action.controller : undefined;
      if (controller) viewPath = controller.resolveView(viewName);
    }
    res.render(viewPath, options);
  } else {
    // automatically convert json object to xml
    var xmlRoot = data.xmlRoot || 'object';
    var obj = data.records || data.record || {};
    res.send(js2xmlparser(xmlRoot, obj));
  }
};

function htmlRenderer(res, options, fn) {
  if (options._redirect) return res.redirect(options._redirect);
  
  var viewName = options._view;
  if (!viewName) {
    //render noview
    return res.render(noviewPath, options, fn);
  }
  
  var helperInstance = res.locals._ = viewHelper.getInstance(viewName);
  var layouts = options._layout;
  var callback = fn;
  var viewPath = viewName;
  var controller = res.locals._action ? res.locals._action.controller : undefined;
  if (!isAbsolutePath(viewPath)) {
    if (controller) viewPath = controller.resolveView(viewName);
  }
  if (layouts) {
    if (!Array.isArray(layouts)) layouts = [layouts];
    var defaultCallback = function(err, str) {
      if (err) return res.req.next(err);
      res.send(str);
    };
    var processLayout = function (layout) {
      var opt = Object.create(options);
      if (typeof layout === 'string' && layout.length > 0 && !isAbsolutePath(layout)) {
        if (controller) layout = controller.resolveView(layout);
      }
      var prevCallback = callback || defaultCallback;
      callback = function(err, str) {
        if (err) return res.req.next(err);
        if (typeof layout === 'function') {
          layout(str, res.render.bind(res), prevCallback);
        } else {
          helperInstance.setPartial('body', str);
          res.render(layout, opt, prevCallback);
        }
      };
    };
    for (var i=layouts.length; i--; ) processLayout(layouts[i]);
  }
  res.render(view, options, callback);
};


function textRenderer(res, options) {
  var text = options.text || '';
  res.set('Content-Type', 'text/plain');
  res.send(text);
}

function arrayToCsv(arr) {
  //RFC4180 states that CSV line break is CRLF
  return ('"' + arr.join('","') + '"\r\n'); 
}

function csvRenderer(res, options) {
  var data = options.data || {};
  var csv = '';
  if (data.fields) {
    //var fields = data.fields.map(function(field){return field.name;});
    csv += arrayToCsv(data.fields);
    var recarr;
    if (data.record) {
      recarr = [];
      data.fields.forEach(function(field){
        recarr.push(data.record[field.name]);
      });
      csv += arrayToCsv(recarr);
    } else if (data.records) {
      data.records.forEach(function(record){
        recarr = [];
        data.fields.forEach(function(field){
          recarr.push(record[field.name]);
        });
        csv += arrayToCsv(recarr);
      });
    }
  }
  res.set('Content-Type', 'text/csv');
  res.send(csv);
}


