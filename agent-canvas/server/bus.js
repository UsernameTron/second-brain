'use strict';
// In-process event bus decoupling the orchestrator from the WebSocket hub.
// Every emitted event carries a canvasId so the hub can route it to the right
// canvas channel.
const { EventEmitter } = require('node:events');
const bus = new EventEmitter();
bus.setMaxListeners(50);
module.exports = bus;
