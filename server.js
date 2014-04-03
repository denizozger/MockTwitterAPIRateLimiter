#!/usr/bin/env node --harmony
'use strict';
const
	express = require('express'),
	app = express();

// middleware to log all http requests
app.use(express.logger('dev'));
// middleware to parse incoming cookies from the client
app.use(express.cookieParser());

// use express' static middleware to serve static files
// if express can't find a route, it'll fall back to these directories
app.use(express.static(__dirname + '/static'));
app.use(express.static(__dirname + '/bower_components'));

/**
 * Public endpoints
 */

app.get('/api/:name', function(req, res) {
	res.json(200, { "hello": req.params.name });
});

app.listen(3000, function(){
	console.log("ready captain.");
});