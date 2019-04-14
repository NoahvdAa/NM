const { default: magister, getSchools } = require('magister.js');

var schoolsByID = {};

var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);

app.use(express.static('web/'));

app.ws('/magister', async function (ws, req) {
  ws.on('message', async function (msg) {
    try {
      message = JSON.parse(msg);
    } catch (e) {
      return ws.send('{"error":"msg_must_be_json"}');
    }

    if (typeof (message.type) == 'undefined') {
      return ws.send('{"error":"type_not_specified"}');
    } else if (typeof (message.content) == 'undefined') {
      return ws.send('{"error":"content_not_specified"}');
    }

    if(message.type == 'getSchools'){
      getSchools(message.content).then((schools) => {
        ws.send(JSON.stringify(schools.map(s => [s.name, s.id])));
        schools.forEach(s=>{
          schoolsByID[s.id] = s;
        });
      });
      return;
    }else if(message.type == 'login'){
      var content = JSON.parse(message.content);
      if(content.length != 3) return ws.send('{"error":"invalid_format"}');
      if(typeof(schoolsByID[content[0]]) == 'undefined') return ws.send('{"error":"invalid_school"}');
      magister({
        school: schoolsByID[content[0]],
        username: content[1],
        password: content[2],
      })
      .then((m) => {
        ws.session = m;
        ws.send(`{"type":"login_success"}`);
      }, (err) => {
        ws.send(`{"error":"${err.toString()}"}`);
      });
      return;
    }

    if(typeof(ws.session) == 'undefined') return ws.send('{"error":"not_logged_in"}');

    // These functions are only available when you are logged in.
  });
});

app.listen(80, function () {
  console.log('Listening on port 80!');
});