var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
 
app.use(express.static('web/'));
 
app.ws('/magister', function(ws, req) {
  ws.on('message', function(msg) {
    try {
      var message = JSON.parse(msg);
    } catch (e) {
      return ws.send('Error: message must be JSON!');
    }

    if(typeof(message['type']) == 'undefined'){
      return ws.send('Error: type is not specified.');
    }else if(typeof(message['message']) == 'undefined'){
      return ws.send('Error: message is not specified.');
    }
  });
});
 
app.listen(80, function(){
  console.log('Listening on port 80!');
});