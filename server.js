#!/usr/bin/env node --harmony
'use strict';
const redisClient = process.env.REDISTOGO_URL ? 
        require('redis-url').connect(process.env.REDISTOGO_URL) : 
        require('redis').createClient();
const
  express = require('express'),
  app = express(),
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

log.level = 'info';

// Application constants and variables
const fifteenMinutesInSeconds = 900;
const searchLimitPerApp = 450;
// const searchLimitPerUser = 180;
const randomTweet = require('./tweet.json');
const totalTweetCount = 1000;
var allTweets = [];

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
  var consumerKey = getConsumerKeyFromRequest(req);
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
        log.error(err); 
      } 

      return middlewareNext();
  });
}

function populateRateLimitResponseHeaders(res, limitWindow) {
  if (res && limitWindow) {
    log.verbose('WebApp', 'Limit start: %j', new Date(limitWindow.start * 1000));
    log.verbose('WebApp', 'Limit end: %j', new Date(limitWindow.end * 1000));
    log.verbose('WebApp', 'Limit remaining: %j', limitWindow.limitRemaining);

    res.setHeader('X-Rate-Limit-Limit', searchLimitPerApp);
    res.setHeader('X-Rate-Limit-Remaining', limitWindow.limitRemaining);
    res.setHeader('X-Rate-Limit-Reset', limitWindow.end);
  }
}

function getConsumerKeyFromRequest(req) {
  return req.header('Authorization').substring(25,50);
}

function getCurrentLimitWindow(req, callback) {
  var consumerKey = getConsumerKeyFromRequest(req);

  redisClient.hgetall(consumerKey, function(err, limitWindow) {
    if (err) {
      log.error(err);
      callback(err, null);
    } else {
      if (!limitWindow) {
        var now = Math.round(new Date().getTime() / 1000);

        limitWindow = {
          start : now,
          end : now + fifteenMinutesInSeconds,
          limitRemaining : searchLimitPerApp - 1
        }
      } 

      callback(null, limitWindow);      
    }
  });  
}

function generateTweets(count) {
  for (var i = 0; count && i < count; i++) {
    allTweets.push(getRandomTweet());
  }
}

function getRandomTweet() {
  var newRandomTweet = getClone(randomTweet);
  newRandomTweet.text = (Math.random() + 1).toString(36);
  return newRandomTweet;
}

function getClone(obj){
    if (obj == null || typeof(obj) != 'object') {
      return obj;
    }

    var temp = new obj.constructor(); 
    
    for(var key in obj) {
      temp[key] = getClone(obj[key]);
    }
        
    return temp;
}

/**
 * Public endpoints
 */

app.get('/1.1/search/tweets.json', [authed, rateLimited], function(req, res) {

  var authorizationHeader = req.header('Authorization');

  var body = {};

  body.helpers = {};
  body.helpers.Authorization = authorizationHeader;
  body.helpers.limitResetAtUtc = new Date(res.getHeader('X-Rate-Limit-Reset') * 1000);

  body.statuses = allTweets;

  body['search_metadata'] = {
    "max_id": 250126199840518145,
    "since_id": 24012619984051000,
    "refresh_url": "?since_id=250126199840518145&q=%23test&result_type=mixed&include_entities=1",
    "next_results": "?max_id=249279667666817023&q=%23test&count=4&include_entities=1&result_type=mixed",
    "count": totalTweetCount,
    "completed_in": 0.035,
    "since_id_str": "24012619984051000",
    "query": "%23test",
    "max_id_str": "250126199840518145"
  };

  body.responseHeaders = {};
  body.responseHeaders['X-Rate-Limit-Limit'] = res.getHeader('X-Rate-Limit-Limit');
  body.responseHeaders['X-Rate-Limit-Remaining'] = res.getHeader('X-Rate-Limit-Remaining');
  body.responseHeaders['X-Rate-Limit-Reset'] = res.getHeader('X-Rate-Limit-Reset');

  res.json(200, body)
});

app.get('/1.1/application/rate_limit_status.json', [authed], function(req, res) {

  getCurrentLimitWindow(req, function (err, limitWindow) {

    var body = {};
  
    body.resources = {};
    body.resources.search = {};
    body.resources.search['/search/tweets'] = {};
    body.resources.search['/search/tweets'].remaining = limitWindow.limitRemaining;
    body.resources.search['/search/tweets'].reset = limitWindow.end;
    body.resources.search['/search/tweets'].limit = searchLimitPerApp;

    res.json(200, body); 

  });
});

app.listen(process.env.PORT || 3000, function() {
  log.info('WebApp', 'Populating ' + totalTweetCount + ' tweets..');

  generateTweets(totalTweetCount);

  log.info('WebApp', 'Ready');
});