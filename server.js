#!/usr/bin/env node --harmony
'use strict';
const
	express = require('express'),
	app = express(),
  redis = require('redis'),
  // open a TCP socket to redis server
  redisClient = require('redis').createClient(), 
  // a class to instantiate a Redis-based backing store for sessions
  RedisStore = require('connect-redis')(express),
  async = require('async'),
  log = require('npmlog');

// middleware to log all http requests
app.use(express.logger('dev'));
// middleware to parse incoming cookies from the client
app.use(express.cookieParser());

// use express' static middleware to serve static files
// if express can't find a route, it'll fall back to these directories
app.use(express.static(__dirname + '/static'));
app.use(express.static(__dirname + '/bower_components'));

redisClient
.on('ready', function() { log.info('Redis', 'ready'); })
.on('error', function(err) { log.error('Redis', err.message); });

// Application constants
const fifteenMinutesInSeconds = 900;
const searchLimitPerApp = 450;
// const searchLimitPerUser = 180;

/**
 * Authentication middleware
 */
const authed = function(req, res, next) {
  if (isRequestAuthenticated(req)) {
    return next();
  } else if (redisClient.ready) {
    res.json(400, {
      'errors' : [{
          'message' : 'Bad Authentication data',
          'code' : 215
      }]
    });
  } else {
    res.json(503, {
      error: 'service_unavailable',
      reason: 'authentication_unavailable'
    });
  }
};

function isRequestAuthenticated(req) {
  var authorizationHeader = req.header('Authorization');
  return authorizationHeader && authorizationHeader.indexOf('OAuth oauth_consumer_key') >= 0;
}

/**
 * Rate limit middleware
 */
const rateLimited = function(req, res, middlewareNext) {
  var consumerKey = req.header('Authorization').substring(25,50);
  var now = Math.round(new Date().getTime() / 1000);

  async.waterfall([

      function getLimitWindowForThisConsumer(next) { 
        redisClient.hgetall(consumerKey, next);
      },
      
      function rejectIfLimitIsExceeded(limitWindow, next) {
        
        if (limitWindow && limitWindow.end > now) {

          if (limitWindow.limitRemaining <= 0) {
            populateRateLimitResponseHeaders(res, limitWindow);
            res.json(429, {
              'errors': [
                {
                  'code': 88,
                  'message': 'Rate limit exceeded'
                }
              ]
            });
            return middlewareNext();
          } else {
            limitWindow.limitRemaining = limitWindow.limitRemaining - 1;
          }    

        } else {
          var limitWindow = {
            start : now,
            end : now + fifteenMinutesInSeconds,
            limitRemaining : searchLimitPerApp - 1
          };
        }

        populateRateLimitResponseHeaders(res, limitWindow);

        next(null, limitWindow);
      },

      function saveTheUpdatedLimit(limitWindow, next) {
        redisClient.hmset(consumerKey, 
          'start', limitWindow.start, 
          'end', limitWindow.end,
          'limitRemaining', limitWindow.limitRemaining
        , next);
      }

    ], function(err, res, body) {
      if (err) { 
        throw err; 
      } 

      return middlewareNext();
  });
}

function populateRateLimitResponseHeaders(res, limitWindow) {
  if (res && limitWindow) {
    log.info('WebApp', 'Limit start: ' + new Date(limitWindow.start * 1000));
    log.info('WebApp', 'Limit end: ' + new Date(limitWindow.end * 1000));
    log.info('WebApp', 'Limit remaining: ' + limitWindow.limitRemaining);

    res.setHeader('X-Rate-Limit-Limit', 450);
    res.setHeader('X-Rate-Limit-Remaining', limitWindow.limitRemaining);
    res.setHeader('X-Rate-Limit-Reset', limitWindow.end);
  }
}

/**
 * Public endpoints
 */

app.get('/1.1/search/tweets.json', [authed, rateLimited], function(req, res) {

	var authorizationHeader = req.header('Authorization');

  var body = {};
  body.query = req.query.q;
  body.Authorization = authorizationHeader;
  body.responseHeaders = {};
  body.responseHeaders['X-Rate-Limit-Limit'] = res.getHeader('X-Rate-Limit-Limit');
  body.responseHeaders['X-Rate-Limit-Remaining'] = res.getHeader('X-Rate-Limit-Remaining');
  body.responseHeaders['X-Rate-Limit-Reset'] = res.getHeader('X-Rate-Limit-Reset');

	res.json(200, body);
});

app.listen(3000, function(){
	log.info('WebApp', 'ready');
});