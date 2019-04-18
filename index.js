// Clear tmp directory
const fs = require('fs');
const path = require('path');

if (fs.existsSync('tmp')) {
  fs.readdir('tmp', (err, files) => {
    if (err) throw err;

    for (const file of files) {
      if (fs.lstatSync('tmp/' + file).isDirectory()) {
        fs.rmdir(path.join('tmp', file), () => { });
      } else {
        fs.unlink(path.join('tmp', file), () => { });
      }
    }
    setTimeout(function () {
      fs.mkdirSync('tmp/img');
    }, 100);
  });
}

const { default: magister, getSchools } = require('magister.js');

var schoolsByID = {};

var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var cookieParser = require('cookie-parser');

app.use(express.static('web/'));
app.use(express.static('tmp/'));
app.use(cookieParser());

app.get('/set_session', async function (req, res) {
  if (typeof (req.query.schoolname) == 'undefined' || typeof (req.query.session) == 'undefined') {
    res.send('?schoolname=<name>&session=<session id>');
  }
  res.cookie('schoolName', req.query.schoolname, { "maxAge": new Date(Date.now() + 86400000) });
  res.cookie('session', req.query.session, { "maxAge": new Date(Date.now() + 86400000) });
  res.send('OK');
});

app.ws('/magister', async function (ws, req) {

  if (req.cookies) {
    if (typeof (req.cookies.schoolName) != 'undefined' && typeof (req.cookies.session)) {
      getSchools(req.cookies.schoolName).then(s => {
        if (s.length == 0) {
          ws.send('{"type":"loginRequired","content":""}');
        } else {
          magister({
            school: s[0],
            token: req.cookies.session
          })
            .then((m) => {
              ws.send(`{"type":"fastlogin","content":"${req.cookies.schoolName}"}`);
              ws.session = m;
              ws.send(`{"type":"login_success","content":"${m.token}"}`);
            }, (err) => {
              // Login Failed
              ws.send('{"type":"loginRequired","content":""}');
            });
        }
      })
    } else {
      ws.send('{"type":"loginRequired","content":""}');
    }
  } else {
    ws.send('{"type":"loginRequired","content":""}');
  }

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

    if (message.type == 'getSchools') {
      getSchools(message.content).then((schools) => {
        ws.send(JSON.stringify({ "type": "schools", "content": JSON.stringify(schools.map(s => [s.name, s.id])) }));
        schools.forEach(s => {
          schoolsByID[s.id] = s;
        });
      });
      return;
    } else if (message.type == 'login') {
      try {
        var content = JSON.parse(message.content);
      } catch (e) {
        return ws.send('{"error":"invalid_json"}');
      }
      if (typeof (ws.session) != 'undefined') return ws.send('{"error":"already_logged_in"}');
      if (content.length != 3) return ws.send('{"error":"invalid_format"}');
      if (typeof (schoolsByID[content[0]]) == 'undefined') return ws.send('{"error":"invalid_school"}');
      magister({
        school: schoolsByID[content[0]],
        username: content[1],
        password: content[2],
      })
        .then((m) => {
          ws.session = m;
          ws.send(`{"type":"login_success","content":"${m.token}"}`);
        }, (err) => {
          ws.send(`{"error":"${err.toString()}"}`);
        });
      return;
    }

    if (typeof (ws.session) == 'undefined') return ws.send('{"error":"not_logged_in"}');

    // These functions are only available when you are logged in.

    if (message.type == 'profileInfo') {
      profileInfo = {};

      profileInfo.name = ws.session.profileInfo.getFullName();
      profileInfo.school = ws.session.school;

      ws.send(JSON.stringify({ "type": "profileInfo", "content": JSON.stringify(profileInfo) }));
    } else if (message.type == 'appointments') {
      try {
        var content = JSON.parse(message.content);
      } catch (e) {
        return ws.send('{"error":"invalid_json"}');
      }
      if (content.length != 2) return ws.send('{"error":"must_specify_two_dates"}');

      var date0 = new Date(content[0].split('-').reverse().join('-'));
      var date1 = new Date(content[1].split('-').reverse().join('-'));
      if (date0 == "Invalid Date" || date1 == "Invalid Date") return ws.send('{"error":"invalid_date"}');

      ws.session.appointments(date0, date1).then(a => {
        ws.send(JSON.stringify({ "type": "appointments", "content": JSON.stringify(a) }));
      });
    }
  });
});

app.listen(process.env.PORT || 80, function () {
  console.log('Listening on port 80!');
});