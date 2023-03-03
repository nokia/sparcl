/*
var amqp = require('amqplib/callback_api');

// send
amqp.connect('amqp://localhost', function(error0, connection) {
    if (error0) {
        throw error0;
    }
    connection.createChannel(function(error1, channel) {
        if (error1) {
            throw error1;
        }

        var queue = 'hello';
        var msg = 'Hello World!';

        channel.assertQueue(queue, {
            durable: false
        });
        channel.sendToQueue(queue, Buffer.from(msg));

        console.log(" [x] Sent %s", msg);
    });
    setTimeout(function() {
        connection.close();
        process.exit(0);
    }, 500);
});


// receive
amqp.connect('amqp://localhost', function(error0, connection) {
    if (error0) {
        throw error0;
    }
    connection.createChannel(function(error1, channel) {
        if (error1) {
            throw error1;
        }

        var queue = 'hello';

        channel.assertQueue(queue, {
            durable: false
        });

        console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", queue);

        channel.consume(queue, function(msg) {
            console.log(" [x] Received %s", msg.content.toString());
        }, {
            noAck: true
        });
    });
});

// TODO: remove these from the git history
/*
const config = require('./cfg/config.json');
const rmquser = config.user;
const rmqpassword = config.password;
const hostname = config.hostname;
const rmqport = config.rmqport;
const robot1_queue = config.robot1_queue;
const robot2_queue = config.robot2_queue;
*/
const rmquser = "rmquser";
const rmqpassword = "rmqpassword";
const hostname = "camloc.xyz";
//const rmqport = 5672; // deafult on localhost
//const rmqport = 15674; // WebSockets Web-STOMP (ws://)
const rmqport = 15673; // Secure WebSockets Web-STOMP (wss://)
const robot1_queue = "/amq/queue/robot1_queue";
const robot2_queue = "/amq/queue/robot2_queue";
const phone2_queue = "/exchange/esoptron/phone2_queue";

const waypoint_queue = "/amq/queue/waypoint_queue";
const chair_reservation_queue = "/amq/queue/chair_reservation_queue";
const chair_reservation_queue = "/exchange/esoptron/chair_reservation_queue"; // "/amq/queue/chair_reservation_queue";

let throttleCounter1 = 0;
let throttleCounter2 = 0;
let robot1Color = [1.0, 1.0, 0.0];
let robot2Color = [0.0, 1.0, 0.0];

let updateFunction = undefined;
let client = null;

let stomp = undefined
export function connectWithReceiveCallback(onReceiveCallback) {
    updateFunction = onReceiveCallback;

  // Stomp.js boilerplate
  import('stompjs').then(stompModule => {
    stomp = stompModule.default;

    client = stomp.client('wss://' + hostname + ':' + rmqport + '/ws');
    client.debug = null; // don't want verbose logs

    var on_connect = function (x) {
        console.log('RMQ connection successful!');
        client.subscribe(robot1_queue, function (d) {
            const data = JSON.parse(d.body);
            const robot1GeoPose = data.GeoPose;
            const agentName = data.ProducerName;
            const timestamp = data.Timestamp;

            throttleCounter1 = throttleCounter1 + 1;
            if (throttleCounter1 > 2) {  // TODO: now turtned off. it was 10
                throttleCounter1 = 0;
                if (updateFunction) {
                    const data = {
                        'agent_geopose_updated': {
                            'agent_id': agentName,
                            'geopose': robot1GeoPose,
                            'color': robot1Color,
                            'timestamp': timestamp
                        }
                    };
                    updateFunction(data);
                }
            }
        });

        client.subscribe(robot2_queue, function (d) {
            const data = JSON.parse(d.body);
            const robot2GeoPose = data.GeoPose;
            const agentName = data.ProducerName;
            const timestamp = data.Timestamp;
            throttleCounter2 = throttleCounter2 + 1;
            if (throttleCounter2 > 2) { // TODO: now turtned off. it was 10
                throttleCounter2 = 0;
                if (updateFunction) {
                    const data = {
                        'agent_geopose_updated': {
                            'agent_id': agentName,
                            'geopose': robot2GeoPose,
                            'color': robot2Color,
                            'timestamp': timestamp
                        }
                    };
                    updateFunction(data);
                }
            }
        });

        client.subscribe(waypoint_queue, function (d) {
            const msg = JSON.parse(d.body);
            console.log(msg);
            let waypointGeoPose = msg.geopose || null;
            if (waypointGeoPose == null) {
                return;
            }
            let agent_id = msg.agent_id || "unknown"; // target agent
            let creator_id = msg.creator || "unknown";
            let timestamp = msg.timestamp || 0;
            const data = {
                'waypoint_set': {
                    'agent_id': agent_id,
                    'creator_id': creator_id,
                    'geopose': waypointGeoPose,
                    'color': [1.0, 1.0, 0.0],
                    'timestamp': timestamp
                }
            };
            updateFunction(data);
        });

        client.subscribe(chair_reservation_queue, function (d) {
            const msg = JSON.parse(d.body);
            console.log(msg);
            const data = {
                'reservation_status_changed': {
                    'chair_id': msg.chair_id,
                    'reserved': msg.reserved
                }
            };
            updateFunction(data);
        });
    };

    var on_error = function () {
        console.log('error');
    };

    client.connect(rmquser, rmqpassword, on_connect, on_error, '/');
    });
}


export function send(data) {
    client.send(phone2_queue, {}, JSON.stringify(data));
}
