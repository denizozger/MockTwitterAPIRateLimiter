# Mock Twitter API Rate Limiter

This application mimics rate limit behaviour of Twitter API. Currently only search is supported.

# Requirements

- [Redis](http://redis.io/) for sessions

# Installation

``` bash
npm install
```

# Running

```bash
redis-server
node --harmony server.js
```

## An example request:

You need to pass a random oauthconsumer_key in Authorization header.

```bash
curl --get 'http://localhost:3000/1.1/search/tweets.json' --data 'q=deniz' --header 'Authorization: OAuth oauth_consumer_key="SoMekEy"'
```

Response HTTP 200 (in limit)
```
{
  "query": "deniz",
  "Authorization": "OAuth oauth_consumer_key=\"SoMekEy\"",
  "responseHeaders": {
    "X-Rate-Limit-Limit": 450,
    "X-Rate-Limit-Remaining": 449,
    "X-Rate-Limit-Reset": 1396580129
  }
}
```

Response headers are also set on HTTP response object as well.

Response HTTP 429 (exceeded limit)
```
{
  "errors": [
    {
      "code": 88,
      "message": "Rate limit exceeded"
    }
  ]
}
```

Response HTTP 400 (unauthorised)
```
{
  "errors": [
    {
      "message": "Bad Authentication data",
      "code": 215
    }
  ]
}
```

# Contribution

I needed to test only search endpoint with one app, so implemented only that. Feel free to create a pull request for other endpoints.