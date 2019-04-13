var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
 
app.use(express.static('web/'));
 
app.ws('/magister', function(ws, req) {
  ws.on('message', function(msg) {
    console.log(msg);
  });
});
 
app.listen(80, function(){
    console.log('Listening on port 80!');
});