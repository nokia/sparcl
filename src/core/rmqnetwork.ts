import { get } from 'svelte/store';
import { myAgentId } from '@src/stateStore';
import throttle from 'lodash/throttle';
import stomp, { type Client, type Frame } from 'stompjs';

const rmq_topic_geopose_update = '/exchange/esoptron/geopose_update.#';
const rmq_topic_waypoint = '/exchange/esoptron/waypoint';
const rmq_topic_robot_path = '/exchange/esoptron/robot_path';
const rmq_topic_chair_reservation = '/exchange/esoptron/chair_reservation';

let rmqClient: Client | null = null;

export async function testRmqConnection({ url, username, password }: { url: string; username: string; password: string }) {
    return await new Promise<boolean>((resolve, reject) => {
        const rmq = stomp.client(url);
        rmq.debug = () => {};
        const onConnect = () => {
            rmq.disconnect(() => {});
            resolve(true);
        };
        const onError = (err: Frame | string) => {
            rmq.disconnect(() => {});
            console.log('err', err);
            reject(err);
        };
        rmq.connect(username, password, onConnect, onError, '/');
    });
}

export function connectWithReceiveCallback({ updateFunction, url, username, password }: { updateFunction: (data: any) => void; url: string; username: string; password: string }) {
    const throttledUpdateFunction = throttle((data) => {
        if (updateFunction) {
            updateFunction(data);
        }
    }, 0);

    // We use STOMP.js for RabbitMQ connection
    // See https://www.rabbitmq.com/stomp.html
    console.log('Connecting to RMQ ' + url);
    console.log('url', url)
    rmqClient = stomp.client(url);
    rmqClient.debug = function (str) {
        // for debugging, we can print all received messages to the console (or even to a separate HTML view)
        //console.log(str + "\n");
    };
    const on_connect = function (x: any) {
        console.log('RMQ connection successful!');

        // now we subscribe to topics
        // Note: Stomp subscribe for a destination of the form /exchange/<name>[/<pattern>] does 3 things:
        // 1. creates an exclusive, auto-delete queue on <name> exchange;
        // 2. if <pattern> is supplied, binds the queue to <name> exchange using <pattern>; and
        // 3. registers a subscription against the queue, for the current STOMP session.

        console.log('Subscribing to topic ' + rmq_topic_geopose_update);
        rmqClient?.subscribe(rmq_topic_geopose_update, function (d) {
            const msg = JSON.parse(d.body);
            //console.log(msg);

            const agentId = msg.agent_id || '';
            if (agentId == '' || agentId == get(myAgentId)) {
                return;
            }

            const timestamp = msg.timestamp || Date.now();
            const agentGeopose = msg.geopose;
            const agentName = msg.avatar.name || '';
            const data = {
                agent_geopose_updated: {
                    agent_id: agentId,
                    agent_name: agentName,
                    geopose: agentGeopose,
                    color: msg.avatar.color,
                    timestamp: timestamp,
                },
            };
            throttledUpdateFunction(data);
        });

        console.log('Subscribing to topic ' + rmq_topic_waypoint);
        rmqClient?.subscribe(rmq_topic_waypoint, function (d) {
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
        rmqClient?.subscribe(rmq_topic_robot_path, function (d) {
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
        rmqClient?.subscribe(rmq_topic_chair_reservation, function (d) {
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

    const on_error = function (err: Frame | string) {
        console.log(`Error: rabbitmq connection disconnected, reason: ${err}. Trying to reconnect.`);
        setTimeout(rmqClient?.connect(username, password, on_connect, on_error, '/'), 1000);
    };

    rmqClient.connect(username, password, on_connect, on_error, '/');
}

export const rmqDisconnect = () => {
    rmqClient?.disconnect(() => {});
};

export function send(routing_key: string, data: any) {
    // Note: Stomp SEND to a destination of the form /exchange/<name>[/<routing-key>] sends to exchange <name> with the routing key <routing-key>.
    rmqClient?.send(routing_key, {}, JSON.stringify(data));
}