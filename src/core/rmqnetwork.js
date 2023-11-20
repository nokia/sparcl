import { myAgentName } from '@src/stateStore';
import { get } from 'svelte/store';
// TODO: remove these from the git history
/*
const config = require('./cfg/config.json');
const rmquser = config.user;
const rmqpassword = config.password;
const hostname = config.hostname;
const rmqport = config.rmqport;
*/
const rmquser = 'rmquser';
const rmqpassword = 'rmqpassword';

// localhost
//const hostname = "127.0.0.1";
//const rmqport = 5672; // deafult on localhost
// Gabor's server
//const hostname = "camloc.xyz";
//const rmqport = 15674; // WebSockets Web-STOMP (ws://)
//const rmqport = 15673; // Secure WebSockets Web-STOMP (wss://)
// office server
const hostname = 'nloc.duckdns.org';
const rmqport = '8024'; // Secure WebSockets Web-STOMP (wss://)

const rmq_topic_geopose_update = '/exchange/esoptron/geopose_update.#';
const rmq_topic_waypoint = '/exchange/esoptron/waypoint';
const rmq_topic_robot_path = '/exchange/esoptron/robot_path';
const rmq_topic_chair_reservation = '/exchange/esoptron/chair_reservation';

let throttleCounter1 = 0;

let stomp = undefined;
let rmqClient = null;
let updateFunction = undefined;
export function connectWithReceiveCallback(onReceiveCallback) {
    updateFunction = onReceiveCallback;

    // We use STOMP.js for RabbitMQ connection
    // See https://www.rabbitmq.com/stomp.html
    import('stompjs').then((stompModule) => {
        stomp = stompModule.default;
        const rmq_url = 'wss://' + hostname + ':' + rmqport + '/ws';
        console.log('Connecting to RMQ ' + rmq_url);
        rmqClient = stomp.client(rmq_url);
        rmqClient.debug = function (str) {
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

            console.log('Subscribing to topic ' + rmq_topic_geopose_update);
            rmqClient.subscribe(rmq_topic_geopose_update, function (d) {
                const msg = JSON.parse(d.body);
                //console.log(msg);

                const agentId = msg.agent_id || '';
                if (agentId == '' || agentId == get(myAgentName)) {
                    return; // HACK. TODO: do this properly
                }

                const timestamp = msg.timestamp || Date.now();
                const agentGeopose = msg.geopose;
                const agentName = msg.avatar.name || '';
                throttleCounter1 = throttleCounter1 + 1; // TODO: use lodash throttle instead of this custom solution
                if (throttleCounter1 > 10) {
                    // TODO: what is a sensible number here?
                    throttleCounter1 = 0;
                    if (updateFunction) {
                        const data = {
                            agent_geopose_updated: {
                                agent_id: agentId,
                                agent_name: agentName,
                                geopose: agentGeopose,
                                color: msg.avatar.color,
                                timestamp: timestamp,
                            },
                        };
                        updateFunction(data);
                    }
                }
            });

            console.log('Subscribing to topic ' + rmq_topic_waypoint);
            rmqClient.subscribe(rmq_topic_waypoint, function (d) {
                const msg = JSON.parse(d.body);
                const waypointGeopose = msg.geopose || null;
                if (waypointGeopose == null) {
                    return;
                }
                const agent_id = msg.agent_id || 'unknown'; // target agent
                const creator_id = msg.creator_id || 'unknown';
                const timestamp = msg.timestamp || 0;
                const color = msg.color || [1.0, 1.0, 0.0];
                const data = {
                    waypoint_set: {
                        agent_id: agent_id,
                        creator_id: creator_id,
                        geopose: waypointGeopose,
                        color: color,
                        timestamp: timestamp,
                    },
                };
                updateFunction(data);
            });

            console.log('Subscribing to topic ' + rmq_topic_robot_path);
            rmqClient.subscribe(rmq_topic_robot_path, function (d) {
                const msg = JSON.parse(d.body);
                const waypointGeoposes = msg.geoposes || null;
                const agent_id = msg.agent_id || 'unknown'; // target agent
                const creator_id = msg.creator_id || 'unknown';
                const timestamp = msg.timestamp || 0;
                const color = msg.color || [1.0, 1.0, 0.0];
                const data = {
                    robot_path: {
                        agent_id: agent_id,
                        creator_id: creator_id,
                        geoposes: waypointGeoposes,
                        color: color,
                        timestamp: timestamp,
                    },
                };
                updateFunction(data);
            });

            console.log('Subscribing to topic ' + rmq_topic_chair_reservation);
            rmqClient.subscribe(rmq_topic_chair_reservation, function (d) {
                const msg = JSON.parse(d.body);
                console.log(msg);
                const data = {
                    reservation_status_changed: {
                        chair_id: msg.chair_id,
                        reserved: msg.reserved,
                    },
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

export function send(routing_key, data) {
    // Note: Stomp SEND to a destination of the form /exchange/<name>[/<routing-key>] sends to exchange <name> with the routing key <routing-key>.
    rmqClient.send(routing_key, {}, JSON.stringify(data));
}
