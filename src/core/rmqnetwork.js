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

// localhost
//const hostname = "127.0.0.1";
//const rmqport = 5672; // deafult on localhost
// Gabor's server
//const hostname = "camloc.xyz";
//const rmqport = 15674; // WebSockets Web-STOMP (ws://)
//const rmqport = 15673; // Secure WebSockets Web-STOMP (wss://)
// office server
const hostname = "nloc.duckdns.org";
const rmqport = "8024"; // Secure WebSockets Web-STOMP (wss://)

const rmq_topic_geopose_update = "/exchange/esoptron/geopose_update.#";
const waypoint_topic = "/exchange/esoptron/waypoint"; //"/amq/queue/waypoint_queue";
const chair_reservation_topic = "/exchange/esoptron/chair_reservation"; // "/amq/queue/chair_reservation_queue";

let throttleCounter1 = 0;
let throttleCounter2 = 0;
let robot1Color = [1.0, 1.0, 0.0];
let robot2Color = [0.0, 1.0, 0.0];

let stomp = undefined;
let rmqClient = null;
let updateFunction = undefined;
export function connectWithReceiveCallback(onReceiveCallback) {
    updateFunction = onReceiveCallback;

    // We use STOMP.js for RabbitMQ connection
    // See https://www.rabbitmq.com/stomp.html
    import('stompjs').then(stompModule => {
        stomp = stompModule.default;
        rmqClient = stomp.client('wss://' + hostname + ':' + rmqport + '/ws');
        rmqClient.debug = function(str) {
            // for debugging, we can print all received messages to the console (or even to a separate HTML view)
            //console.log(str + "\n");
        };

        let on_connect = function (x) {
            console.log('RMQ connection successful!');

            // now we subscribe to topics
            // Note: Stomp subscribe for a destination of the form /exchange/<name>[/<pattern>] does 3 things:
            // 1. creates an exclusive, auto-delete queue on <name> exchange;
            // 2. if <pattern> is supplied, binds the queue to <name> exchange using <pattern>; and
            // 3. registers a subscription against the queue, for the current STOMP session.

            rmqClient.subscribe(rmq_topic_geopose_update, function (d) {
                const msg = JSON.parse(d.body);
                const timestamp = msg.timestamp || Date.now();
                const agentId = msg.agent_id || "";
                const agentGeopose = msg.geopose || new GeoPose();
                const agentName = msg.avatar.name || "";
                const agentColor = [msg.avatar.color.r, msg.avatar.color.g, msg.avatar.color.b] || [1.0, 1.0, 1.0];

                throttleCounter1 = throttleCounter1 + 1;
                if (throttleCounter1 > 10) {  // TODO: what is a sensible number here?
                    throttleCounter1 = 0;
                    if (updateFunction) {
                        const data = {
                            'agent_geopose_updated': {
                                'agent_id': agentId,
                                'agent_name': agentName,
                                'geopose': agentGeopose,
                                'color': agentColor,
                                'timestamp': timestamp
                            }
                        };
                        updateFunction(data);
                    }
                }
            });

            rmqClient.subscribe(waypoint_topic, function (d) {
                const msg = JSON.parse(d.body);
                console.log(msg);
                let waypointGeopose = msg.geopose || null;
                if (waypointGeopose == null) {
                    return;
                }
                let agent_id = msg.agent_id || "unknown"; // target agent
                let creator_id = msg.creator || "unknown";
                let timestamp = msg.timestamp || 0;
                const data = {
                    'waypoint_set': {
                        'agent_id': agent_id,
                        'creator_id': creator_id,
                        'geopose': waypointGeopose,
                        'color': [1.0, 1.0, 0.0],
                        'timestamp': timestamp
                    }
                };
                updateFunction(data);
            });

            rmqClient.subscribe(chair_reservation_topic, function (d) {
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

        let on_error = function () {
            console.log('error');
        };

        rmqClient.connect(rmquser, rmqpassword, on_connect, on_error, '/');
    });
}


export function send(data) {
    // Note: Stomp SEND to a destination of the form /exchange/<name>[/<routing-key>] sends to exchange <name> with the routing key <routing-key>.
    rmqClient.send(rmq_topic_geopose_update, {}, JSON.stringify(data));
}
