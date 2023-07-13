const Telnet = require('telnet-client')

var login = 'lutron';
var password = 'lutron';
var heartbeatInterval = 10000;
var client;
var heartbeat;
var reconnectTimeout;
var doNotReconnect;
var retrying;

/* Catch Connect Client Messages */

process.on("message", (data) => {
  processCommand(data);
});

function sendResponse(response) {
  log(response);
  //process.send() only exists if the app is started as a child process
  if (typeof process.send === 'function') {
    process.send(response);
  }
}

/* Create Device Commands */

function processCommand(command) {
  switch (command) {
    case 'connect\n':
      connect();
      break;
    case 'close\n':
      close();
      break;
    default:
      sendToSocket(command);
      break;
  }
}

/* Parse Device Responses */

function parseResponse(response) {
  log('Parsing response ' + response);  
  responseArray = response.toString().split('\r\n');
  for (var i = 0; i < responseArray.length; i++) {
    if (responseArray[i] != 'QNET> ' && responseArray[i].length > 0 && isAlive === true) {
      sendResponse(responseArray[i]);
    }
  }
  isAlive = true;
}

/* Socket Functions */

async function sendToSocket(message) {
  if (client) {
    log('Sending to socket: ' + message);
    client.send(message + '\r', (error, data) => {
      // if (error) {
      //   log("sendToSocket result error: ", error)
      // }
      // if (data) {
      //   log("sendToSocket result data: ", data)
      // }
    });
  } else {
    log('Cannot send to undefined socket.');
  }
}

var connect = async (ipAddress, port) => {
  client = new Telnet();
  if (port && ipAddress) {
    log('Connecting with ip address: ' + ipAddress + ' and port: ' + port + ' and login: ' + login);
    var options = {
      debug: true,
      host: ipAddress,
      port: port,
      negotiationMandatory: true,
      timeout: 0,
      loginPrompt: 'login: ',
      passwordPrompt: 'password: ',
      username: login + '\r',
      password: password + '\r',
      shellPrompt: 'QNET>',
    };
    client.connect(options).catch((err) => {
      errorEventHandler(err);
    });

    client.on('failedlogin', function () {
      failedLoginEventHandler();
    });

    client.on('connect', function () {
      log('logging in');
    });

    client.on('ready', function () {
      log('logged in');
      connectEventHandler();
    });

    client.on('data', data => {
      parseResponse(data);
    });

    client.on('timeout', function () {
      timeoutEventHandler();
    });

    client.on('close', function () {
      closeEventHandler();
    });

  } else {
    log('Cannot connect with ip address: ' + ipAddress + ' and port: ' + port);
  }
}

var close = async () => {
  if (client) {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    doNotReconnect = true;
    client.end();
  } else {
    log('Cannot close. Socket undefined. ');
  }
}

/* Socket Event Handlers */

function connectEventHandler() {
  log('Socket connected.');
  sendResponse('catch-service-connected');
  retrying = false;
  clearInterval(reconnectTimeout);
  startHearbeat();
}

function startHearbeat() {
  isAlive = true;
  heartbeat = setInterval(checkHeartbeat, heartbeatInterval);
}

function checkHeartbeat() {
  if (isAlive === true) {
    isAlive = false;
    sendToSocket('gettime');
    return;
  }
  log('Heartbeat timed out.');
  doNotReconnect = false;
  client.destroy();
}

function failedLoginEventHandler() {
  sendResponse('catch-service-login-failed');
  log('Failed Login.');
  doNotReconnect = true;
  client.destroy();
}

function timeoutEventHandler() {
  log('Socket timeout event.');
  doNotReconnect = false;
  client.destroy();
}

function errorEventHandler(err) {
  log('Socket error: ' + err);
  doNotReconnect = false;
  client.destroy();
}

function closeEventHandler() {
  if (heartbeat) {
    clearInterval(heartbeat);
  }
  if (reconnectTimeout) {
    clearInterval(reconnectTimeout);
  }
  sendResponse('catch-service-disconnected');
  log('Socket closed.');
  if (!retrying && !doNotReconnect) {
    retrying = true;
    log('Reconnecting...');
  }
  if (!doNotReconnect) {
    reconnectTimeout = setTimeout(connect.bind(this), 10000);
  }
}

exports.connect = connect;
exports.close = close;