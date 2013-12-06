/**
 * Automatically listed all built in views
 */

'use strict';
var path = require('path');
var fsx = require('jsx').fsx;
var eachFileInDir = require('../utils').eachFileInDir;

var views = module.exports = {};

fsx.sync.forEachDir(__dirname, function(file) {
  var basename = file.name;
  var fullpath = file.path;
  views[basename] = {};
  eachFileInDir(fullpath, function(name, fp) {
    var namenoext = path.basename(name, path.extname(name));
    var rname1 = path.relative(fullpath, fp);
    var dirname = path.dirname(rname1);
    var rname2 = path.join(dirname, namenoext); //without ext
    if (namenoext === 'index') views[basename][dirname.replace('\\','/')] = fp;
    else views[basename][rname1.replace('\\','/')] = views[basename][rname2.replace('\\','/')] = fp;
  }, true);
});