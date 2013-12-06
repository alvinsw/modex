'use strict';

/**
 * Additional middleware needed by modex
 */
var express = require('express');
var parseUrlencoded = express.urlencoded();
var parseJson = express.json();

/** 
 * Override the method property of request using the value of the following with the same order:
 * - Query parameter: methodKey
 * - HTTP header: x-http-method-override
 */
exports.methodOverride = function methodOverride(methodKey) {
  return function(req, res, next) {
    req.originalMethod = req.originalMethod || req.method;
    if (req.query && methodKey in req.query) {
      req.method = req.query[methodKey].toUpperCase();
    } else if (req.headers['x-http-method-override']) {
      req.method = req.headers['x-http-method-override'].toUpperCase();
    }
    next();
  };
};

/**
 * Attach middleware to detect request for various response format (such as html, json), and put it in request.format
 */
exports.formatResolver = function formatResolver(supportedFormats){
  supportedFormats = supportedFormats || {};
  
  return function (req, res, next) {
    var format = req.query.format;
    if (!format) {
      // infer format from .format at the end of url
      var result = req.path.match(/\/.+\.(\w+)\/?$/);
      if (result) format = result[1];
    }
    if (format) { // format is explicitly specified in the query string
      if (format in supportedFormats) req.format = format;
      else req.format = 'unknown';
    } else { 
      // no format is specified, use the http "accept" header
      if (req.accepted.length > 0) {
        req.accepted.some(function(token) {
          if (token.value in supportedFormats) {
            req.format = token.value;
            return true;
          }
        });
        if (!req.format) {
          if (req.accepts('html')) req.format = 'html';
          else req.format = 'unknown';
        }
      }
    }
    next();
  };
};

/**
 * Make session user information available in the view
 */
exports.localizeUser = function localizeUser(){
  return function(req, res, next){
    if (req.session.user) res.locals._user = req.session.user;
    next();
  };
};

/**
 * Parse HTTP request body without support for multipart or file upload
 */
exports.bodyParserNoMultipart = function bodyParserNoMultipart() {
  return function (req, res, next){
    parseJson(req, res, function(err){
      if (err) return next(err);
      parseUrlencoded(req, res, next);
    });
  };
}
