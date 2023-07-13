const dgram = require('dgram');
const nmea = require('nmea-0183');
const geolib = require('geolib');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { find } = require('geo-tz');
const { Telnet } = require('telnet-client');
const server = dgram.createSocket('udp4');

require('dotenv').config();

dayjs.extend(utc);
dayjs.extend(timezone);

dayjs.tz.setDefault('America/New_York');

const ALLOWED_DEVIATION_IN_METERS = 160934; // 100 miles
const COORDINATES_EXPIRATION = 1; // 1 day

const LUTRON_SERVERS = [{ ip: process.env.LUTRON_IP, port: 23, user: process.env.LUTRON_USER, user: process.env.LUTRON_PASSWORD }];
const LUTRON_SYNC_TIMEOUT = 10000;

syncedLatitude = 0;
syncedLongitude = 0;
lastSynced = dayjs().subtract(COORDINATES_EXPIRATION, 'day');

function validateRecord(GPGGAObject) {
    if (GPGGAObject.valid == "A") {
        return true;
    }

    return false;
}

function hasDeviated(currentLatitude, currentLongitude, allowedDevianceInMeters) {
    var distanceInMeters = geolib.getDistance(
        { latitude: syncedLatitude, longitude: syncedLongitude },
        { latitude: currentLatitude, longitude: currentLongitude }
    );

    if (distanceInMeters > allowedDevianceInMeters) {
        return true;
    }

    return false;
}

function hasCoordinatesExpired() {
    if (dayjs().subtract(COORDINATES_EXPIRATION, 'day').isAfter(lastSynced)) {
        return true;
    }

    return false;
}

function syncLutron(ipAddress, port, login, password, commands) {
    var client = new Telnet();
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
    var synced = false;
    var checkCurrentCommand = '';

    return new Promise((resolve) => {
        client.connect(options).catch((err) => {
            console.log(err);
        });
    
        client.on('failedlogin', function () {
            console.log(`Lutron (${ipAddress}): failed login.`);
        });
    
        client.on('connect', function () {
            console.log(`Lutron (${ipAddress}): logging in.`);
        });
    
        client.on('ready', function () {
            console.log(`Lutron (${ipAddress}): logged in.`);
    
            client.send(commands.shift());
        });
    
        client.on('data', data => {
            if (commands.length > 0) {
                client.send(commands.shift());
            } else {
                client.end();
                synced = true;
                resolve(true);
            }
        });
    
        client.on('timeout', function () {
            console.log(`Lutron (${ipAddress}): timeout.`);
        });
    
        client.on('close', function () {
            console.log(`Lutron (${ipAddress}): closed.`);
        });

        setTimeout(() => {
            if (!synced) {
                client.end();
                resolve(false);
            }
        }, LUTRON_SYNC_TIMEOUT);
    });
}

server.on('listening', function () {
    var address = server.address();
    console.log('UDP Server listening on ' + address.address + ":" + address.port);
});

server.on('message', function (message, remote) {
    var GPGGAObject = nmea.parse(message.toString());

    if (validateRecord(GPGGAObject)) {
        var currentLatitude = parseFloat(GPGGAObject.latitude).toFixed(1);
        var currentLongitude = parseFloat(GPGGAObject.longitude).toFixed(1);
        var currentTimezones = find(currentLatitude, currentLongitude);
        var utcOffset = dayjs().tz(currentTimezones[0]).startOf('year').utcOffset() / 60;

        console.log('Location: ', currentLatitude, currentLongitude, ' Timezone: ', currentTimezones[0]);

        // console.log(JSON.stringify(GPGGAObject, null, 2));

        if (hasDeviated(currentLatitude, currentLongitude, ALLOWED_DEVIATION_IN_METERS) || hasCoordinatesExpired()) {
            console.log('Detected deviation.');

            var commands = [
                `#SYSTEM,4,${currentLatitude},${currentLongitude}\r`,
                `#SYSTEM,5,${utcOffset}\r`,
                `#SYSTEM,2,${dayjs().tz(currentTimezones[0]).format('MM/DD/YYYY')}\r`,
                `#SYSTEM,1,${dayjs().tz(currentTimezones[0]).format('HH:mm:ss')}\r`];

            Promise.all(LUTRON_SERVERS.map(server => syncLutron(server.ip, server.port, server.user, server.password, commands)))
                .then(syncValues => {
                    if (syncValues.every(v => v === true)) {
                        syncedLatitude = currentLatitude;
                        syncedLongitude = currentLongitude;
                        lastSynced = dayjs();
                        console.log('Synced new coordinates with Lutron.');
                    } else {
                        console.log('Synced failed with Lutron.');
                    }
                });
        }
    }
});

// Replace with your port and IP.
server.bind(23232);
