// IMPORTANT NOTE:
// The client and server version are not the same.
// The server version doesn't really have a purpose yet, but the client version does.
// Whenever the client version changes, the client will INSTANTLY refresh to update.
const serverVersion = '0.0.1_build_0001';
const clientVersion = '0.0.1_build_0001';

// Clear tmp directory
var fs = require('fs');
var rimraf = require("rimraf");
rimraf("tmp/", function () {
  fs.mkdirSync('tmp');
  fs.mkdirSync('tmp/img');
});

const getAuthCode = require('@magisterjs/dynamic-authcode');

global.authCode = '';

fetchAuthCode();

setInterval(fetchAuthCode, (5 * 60 * 1000)); // Fetch authcode every 5 minutes.

var { default: magister, getSchools } = require('magister.js');

var schoolsByID = {};

var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var cookieParser = require('cookie-parser');
var crypto = require('crypto');
const openpgp = require('openpgp');

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

  ws.noPGP = false;

  ws.encSend = async function (msg) {
    if ((!ws.publicKey && ws.noPGP == false) || ws.readyState != 1) return setTimeout(function () { ws.encSend(msg); }, 100); // Try again after 100ms.
    if (ws.noPGP) return ws.send(msg);
    var message = await encrypt(msg, ws.publicKey);
    ws.send(message);
  }

  ws.send(publicKey);

  if (req.cookies) {
    if (typeof (req.cookies.schoolName) != 'undefined' && typeof (req.cookies.session) != 'undefined') {
      getSchools(req.cookies.schoolName).then(s => {
        if (s.length == 0) {
          ws.send('{"type":"loginRequired","content":"invalidSchool"}');
        } else {
          magister({
            school: s[0],
            token: req.cookies.session,
            authCode: global.authCode
          })
            .then((m) => {
              ws.encSend(`{"type":"fastlogin","content":"${req.cookies.schoolName}"}`);
              ws.session = m;
              ws.encSend(`{"type":"login_success","content":"${m.token}"}`);
            }, (err) => {
              // Login Failed
              ws.send('{"type":"loginRequired","content":"tokenExpired"}');
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
    if (msg == 'noPGP') return ws.noPGP = true;
    if (msg.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----')) {
      ws.publicKey = msg;

      // The server version and client version are NOT the same!
      // Please scroll to the beginning of the file for more information.
      var serverInfo = JSON.stringify({
        "serverVersion": serverVersion,
        "clientVersion": clientVersion
      });
      ws.send(JSON.stringify({
        "type": "serverInfo",
        "content": serverInfo
      }));

      return;
    }

    // Deny all messages if no public key is sent yet.
    if (!ws.publicKey && ws.noPGP != true) return;

    var message = msg;

    try {
      message = await decrypt(message, privateKey);
    } catch (e) {
      try {
        JSON.parse(message);
        // Message received is non-pgp but json-parsable, continue.
      } catch (e) {
        // Fail silently
      }
    }

    try {
      message = JSON.parse(message);
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
        authCode: global.authCode
      })
        .then((m) => {
          ws.session = m;
          ws.encSend(`{"type":"login_success","content":"${m.token}"}`);
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

      ws.encSend(JSON.stringify({ "type": "profileInfo", "content": JSON.stringify(profileInfo) }));

      ws.session.profileInfo.getProfilePicture().then(s => {
        var id = crypto.randomBytes(20).toString('hex');
        s.pipe(fs.createWriteStream('tmp/img/' + id + '.png'))
          .on('finish', function () {
            ws.encSend('{"type":"profilePicture","content":"/img/' + id + '.png"}');
          });
      });
    } else if (message.type == 'appointments') {
      try {
        var content = JSON.parse(message.content);
      } catch (e) {
        return ws.send('{"error":"invalid_json"}');
      }
      if (content.length != 2) return ws.encSend('{"error":"must_specify_two_dates"}');

      var date0 = new Date(content[0].split('-').reverse().join('-'));
      var date1 = new Date(content[1].split('-').reverse().join('-'));
      if (date0 == "Invalid Date" || date1 == "Invalid Date") return ws.encSend('{"error":"invalid_date"}');

      ws.session.appointments(date0, date1).then(a => {
        ws.encSend(JSON.stringify({ "type": "appointments", "content": JSON.stringify(a) }));
      });
    }
  });
});

var privateKey = '';
var publicKey = '';
var pgpOptions = {
  userIds: [{ "name": makeRandomString(10), "email": makeRandomString(5) + "@" + makeRandomString(10) + ".com" }],
  numBits: 2048,
  passphrase: makeRandomString(20)
};

console.log('Generating PGP keys, this can take a while!');
openpgp.generateKey(pgpOptions).then(async function (key) {
  privateKey = key.privateKeyArmored;
  publicKey = key.publicKeyArmored;

  console.log('Generated PGP keys.');
  app.listen(process.env.PORT || 80, function () {
    console.log('Listening on port ' + (process.env.PORT || 80) + '!');
  });

});


function makeRandomString(length) {
  var result = '';
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

async function encrypt(message, publickey) {
  const options = {
    message: openpgp.message.fromText(message),
    publicKeys: (await openpgp.key.readArmored(publickey)).keys
  }

  var ciphertext = await openpgp.encrypt(options);
  return ciphertext.data;
}

async function decrypt(message, privateKey) {
  const privKeyObj = (await openpgp.key.readArmored(privateKey.replace(/\r/, ''))).keys[0];
  await privKeyObj.decrypt(pgpOptions.passphrase);
  const options = {
    message: await openpgp.message.readArmored(message.replace(/\r/, '')),
    privateKeys: [privKeyObj]
  }

  var ciphertext = await openpgp.decrypt(options);
  return ciphertext.data;
}

async function fetchAuthCode() {
  global.authCode = await getAuthCode();
}